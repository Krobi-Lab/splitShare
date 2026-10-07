"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, toActionResult, type ActionResult } from "@/lib/actions/result";
import { writeAuditLog } from "@/lib/audit/write";
import {
  assertBelongsToHousehold,
  requireAuth,
  requireCapability,
} from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { sendExpenseCreatedEmail } from "@/lib/email/send";
import { createExpenseSchema } from "@/lib/expenses/schema";
import { deriveAcceptanceStatus } from "@/lib/expenses/state";
import { splitStartsAccepted } from "@/lib/households/placeholders";
import { toDbCents } from "@/lib/money";
import { createNotifications } from "@/lib/notifications/create";
import { consumeRateLimit } from "@/lib/rate-limit";
import { computeSplits } from "@/lib/splits/engine";

/**
 * Creates an expense (§6, §40 step 3).
 *
 * Every per-person amount is recomputed here with the split engine (§2.5). The
 * client's numbers are read only in EXACT mode, and even then only after the
 * engine has proved they sum to the total.
 */
export async function createExpense(
  input: unknown,
): Promise<ActionResult<{ expenseId: string; status: string }>> {
  try {
    const data = createExpenseSchema.parse(input);
    const membership = await requireCapability(data.householdId, "CREATE_EXPENSE");
    consumeRateLimit("CREATE_EXPENSE", membership.userId);

    // §12's view sums amount_cents without grouping by currency, so an expense
    // in a currency other than the household's would silently corrupt every
    // balance in it. Refused rather than converted: this app does not hold
    // exchange rates, and inventing one would be worse than saying no.
    if (data.currency !== membership.currency) {
      return fail(
        "VALIDATION",
        `This household is settled in ${membership.currency}, so expenses must be in ${membership.currency}.`,
        { fieldErrors: { currency: [`Must be ${membership.currency}`] } },
      );
    }

    // §2.4(d) for every id the input carries. Members are loaded in one query
    // and checked against the participant list, so a participant from another
    // household cannot be slipped in alongside this household's id.
    const participantIds = data.participants.map((participant) => participant.userId);
    const members = await prisma.householdMember.findMany({
      where: {
        householdId: data.householdId,
        removedAt: null,
        userId: { in: [...new Set([...participantIds, data.paidByUserId])] },
      },
      select: {
        userId: true,
        user: { select: { id: true, name: true, email: true, isPlaceholder: true } },
      },
    });

    const memberById = new Map(members.map((member) => [member.userId, member.user]));

    const stranger = participantIds.find((userId) => !memberById.has(userId));
    if (stranger !== undefined) {
      return fail(
        "WRONG_HOUSEHOLD",
        "One of those people is not a member of this household.",
      );
    }
    if (!memberById.has(data.paidByUserId)) {
      return fail("WRONG_HOUSEHOLD", "Whoever paid must be a member of this household.");
    }

    if (data.categoryId !== null) {
      const category = await prisma.category.findUnique({
        where: { id: data.categoryId },
        select: { householdId: true, archivedAt: true },
      });
      assertBelongsToHousehold(category, data.householdId);
      if (category?.archivedAt !== null) {
        return fail("VALIDATION", "That category has been archived.", {
          fieldErrors: { categoryId: ["Pick a different category"] },
        });
      }
    }

    if (data.receiptFileId !== undefined) {
      const file = await prisma.fileUpload.findUnique({
        where: { id: data.receiptFileId },
        select: { householdId: true },
      });
      assertBelongsToHousehold(file, data.householdId);
    }

    // The authoritative amounts (§2.5, §2.6).
    const computed = computeSplits({
      method: data.splitMethod,
      totalCents: data.amountCents,
      participants: data.participants,
    });

    const splits = computed.map((split) => {
      const participant = memberById.get(split.userId)!;
      const accepted = splitStartsAccepted({
        participantUserId: split.userId,
        paidByUserId: data.paidByUserId,
        createdByUserId: membership.userId,
        isPlaceholder: participant.isPlaceholder,
      });
      return { ...split, accepted, user: participant };
    });

    const status = deriveAcceptanceStatus({
      total: splits.length,
      accepted: splits.filter((split) => split.accepted).length,
      rejected: 0,
    });

    const now = new Date();

    // Needed for the notification copy, which is written inside the
    // transaction. Both are cheap and `requireAuth` is already cached.
    const [creator, household] = await Promise.all([
      requireAuth(),
      prisma.household.findUniqueOrThrow({
        where: { id: data.householdId },
        select: { name: true },
      }),
    ]);
    const creatorName = creator.name ?? creator.email ?? "Someone";

    const expenseId = await prisma.$transaction(async (tx) => {
      // One transaction, so the DEFERRABLE split-sum trigger (§10) sees a
      // balanced expense at COMMIT rather than an empty one mid-flight.
      const expense = await tx.expense.create({
        data: {
          householdId: data.householdId,
          paidByUserId: data.paidByUserId,
          createdByUserId: membership.userId,
          categoryId: data.categoryId,
          description: data.description,
          amountCents: toDbCents(data.amountCents, "expense total"),
          currency: data.currency,
          date: data.date,
          notes: data.notes ?? null,
          receiptFileId: data.receiptFileId ?? null,
          splitMethod: data.splitMethod,
          status,
          splits: {
            create: splits.map((split) => ({
              userId: split.userId,
              amountCents: toDbCents(split.amountCents, "split amount"),
              percentBps: split.percentBps,
              shares: split.shares,
              acceptance: split.accepted ? "ACCEPTED" : "PENDING",
              acceptedAt: split.accepted ? now : null,
            })),
          },
        },
        select: { id: true, status: true, description: true, amountCents: true },
      });

      await writeAuditLog(tx, {
        householdId: data.householdId,
        actorUserId: membership.userId,
        action: "EXPENSE_CREATED",
        entityType: "expense",
        entityId: expense.id,
        after: {
          description: expense.description,
          amountCents: expense.amountCents,
          currency: data.currency,
          splitMethod: data.splitMethod,
          status: expense.status,
          paidByUserId: data.paidByUserId,
          splits: splits.map((split) => ({
            userId: split.userId,
            amountCents: split.amountCents,
            acceptance: split.accepted ? "ACCEPTED" : "PENDING",
          })),
        },
      });

      // §17 — only the people who still have to do something, and never a
      // placeholder, which has nobody to read it.
      await createNotifications(tx, {
        householdId: data.householdId,
        context: {
          actorName: creatorName,
          householdName: household.name,
          description: data.description,
          currency: data.currency,
        },
        targets: splits
          .filter((split) => !split.accepted && !split.user.isPlaceholder)
          .map((split) => ({
            userId: split.userId,
            type: "EXPENSE_CREATED" as const,
            entityType: "expense",
            entityId: expense.id,
            context: { amountCents: split.amountCents },
          })),
      });

      return expense.id;
    });

    // After commit, best effort: a mail provider outage must not undo a
    // successfully recorded expense.
    const payer = await prisma.user.findUniqueOrThrow({
      where: { id: data.paidByUserId },
      select: { name: true, email: true },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    await Promise.all(
      splits
        .filter((split) => !split.accepted && !split.user.isPlaceholder)
        .map((split) =>
          sendExpenseCreatedEmail(
            { email: split.user.email, name: split.user.name },
            {
              householdName: household.name,
              description: data.description,
              paidByName: payer.name ?? payer.email,
              amountCents: data.amountCents,
              yourShareCents: split.amountCents,
              currency: data.currency,
              url: `${appUrl}/households/${data.householdId}/expenses/${expenseId}`,
            },
          ),
        ),
    );

    revalidatePath(`/households/${data.householdId}`);
    return ok({ expenseId, status });
  } catch (error) {
    return toActionResult(error);
  }
}
