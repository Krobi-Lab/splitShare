"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, toActionResult, type ActionResult } from "@/lib/actions/result";
import { writeAuditLog } from "@/lib/audit/write";
import { requireAuth, requireCanActFor, requireCapability } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { statusAfterAcceptanceChange } from "@/lib/expenses/state";
import { createNotifications } from "@/lib/notifications/create";

import { respondOnBehalfSchema } from "./schema";

/**
 * Accepts or rejects a split (§8, §40 step 4).
 *
 * A user transitions their own split, or a placeholder's if they manage it
 * (§8a). `onBehalfOfUserId` names whose split is being decided; omitting it
 * means your own.
 *
 * Rejecting puts the whole expense into DISPUTED and tells the creator, which is
 * the point: a disputed expense drops out of the §12 balances until it is
 * resolved, so nobody is quietly charged for something they object to.
 */
export async function respondToSplit(
  input: unknown,
): Promise<ActionResult<{ status: string }>> {
  try {
    const data = respondOnBehalfSchema.parse(input);
    const membership = await requireCapability(data.householdId, "ACCEPT_OWN_SPLIT");
    const actor = await requireAuth();

    const subjectUserId = data.onBehalfOfUserId ?? membership.userId;
    await requireCanActFor(
      actor.id,
      subjectUserId,
      "that person or whoever manages them",
    );

    const expense = await prisma.expense.findUnique({
      where: { id: data.expenseId },
      select: {
        id: true,
        householdId: true,
        status: true,
        description: true,
        createdByUserId: true,
        splits: {
          select: { id: true, userId: true, acceptance: true },
        },
      },
    });

    // §2.4(d) — another household's expense id reads as missing.
    if (!expense || expense.householdId !== data.householdId) {
      return fail("WRONG_HOUSEHOLD", "Not found");
    }

    const split = expense.splits.find((candidate) => candidate.userId === subjectUserId);
    if (!split) {
      return fail("WRONG_HOUSEHOLD", "Not found");
    }

    // §2.2 — a split is immutable once decided. Re-deciding would rewrite a
    // financial fact, and the database forbids it for accepted rows anyway.
    if (split.acceptance !== "PENDING") {
      return fail(
        "CONFLICT",
        split.acceptance === "ACCEPTED"
          ? "That share has already been accepted."
          : "That share has already been rejected.",
      );
    }

    const now = new Date();
    const accepted = data.decision === "ACCEPTED";

    // Recomputed from the rows as they will be, not incremented.
    const decided = expense.splits.map((candidate) =>
      candidate.id === split.id ? { ...candidate, acceptance: data.decision } : candidate,
    );
    const nextStatus = statusAfterAcceptanceChange(expense.status, {
      total: decided.length,
      accepted: decided.filter((candidate) => candidate.acceptance === "ACCEPTED").length,
      rejected: decided.filter((candidate) => candidate.acceptance === "REJECTED").length,
    });

    await prisma.$transaction(async (tx) => {
      await tx.expenseSplit.update({
        where: { id: split.id },
        data: {
          acceptance: data.decision,
          acceptedAt: accepted ? now : null,
          rejectedAt: accepted ? null : now,
          rejectionReason: accepted ? null : (data.rejectionReason ?? null),
        },
      });

      if (nextStatus !== expense.status) {
        await tx.expense.update({
          where: { id: expense.id },
          data: { status: nextStatus },
        });
      }

      await writeAuditLog(tx, {
        householdId: data.householdId,
        actorUserId: actor.id,
        action: accepted ? "EXPENSE_ACCEPTED" : "EXPENSE_REJECTED",
        entityType: "expense_split",
        entityId: split.id,
        before: { acceptance: "PENDING", expenseStatus: expense.status },
        after: {
          acceptance: data.decision,
          expenseStatus: nextStatus,
          // Recorded so acting for a placeholder is visible in the trail.
          subjectUserId,
          rejectionReason: accepted ? null : (data.rejectionReason ?? null),
        },
      });

      // §8 — rejecting notifies the creator, unless they did it themselves.
      if (!accepted && expense.createdByUserId !== actor.id) {
        const household = await tx.household.findUniqueOrThrow({
          where: { id: data.householdId },
          select: { name: true },
        });
        await createNotifications(tx, {
          householdId: data.householdId,
          context: {
            actorName: actor.name ?? actor.email ?? "Someone",
            householdName: household.name,
            description: expense.description,
          },
          targets: [
            {
              userId: expense.createdByUserId,
              type: "SPLIT_REJECTED",
              entityType: "expense",
              entityId: expense.id,
            },
          ],
        });
      }
    });

    revalidatePath(`/households/${data.householdId}`);
    return ok({ status: nextStatus });
  } catch (error) {
    return toActionResult(error);
  }
}
