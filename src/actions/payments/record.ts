"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, toActionResult, type ActionResult } from "@/lib/actions/result";
import { writeAuditLog } from "@/lib/audit/write";
import { requireAuth, requireCapability } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { recordPaymentSchema } from "@/lib/expenses/schema";
import { toDbCents } from "@/lib/money";
import { createNotifications } from "@/lib/notifications/create";

/**
 * Records a payment you have made (§9, §40 step 5).
 *
 * The row lands PENDING_CONFIRMATION — which, since `payments` carries no
 * status column, means simply that no `payment_confirmations` row exists yet.
 * Only CONFIRMED payments move balances, so recording one cannot change what
 * anybody owes; it only asks the recipient to agree that it happened.
 */
export async function recordPayment(
  input: unknown,
): Promise<ActionResult<{ paymentId: string }>> {
  try {
    const data = recordPaymentSchema.parse(input);
    const membership = await requireCapability(data.householdId, "RECORD_OWN_PAYMENT");
    const actor = await requireAuth();

    if (data.currency !== membership.currency) {
      return fail("VALIDATION", `This household is settled in ${membership.currency}.`, {
        fieldErrors: { currency: [`Must be ${membership.currency}`] },
      });
    }

    if (data.toUserId === membership.userId) {
      return fail("VALIDATION", "You cannot record a payment to yourself.", {
        fieldErrors: { toUserId: ["Pick somebody else"] },
      });
    }

    const recipient = await prisma.householdMember.findUnique({
      where: {
        householdId_userId: { householdId: data.householdId, userId: data.toUserId },
      },
      select: { removedAt: true, user: { select: { isPlaceholder: true } } },
    });
    if (!recipient || recipient.removedAt !== null) {
      return fail("WRONG_HOUSEHOLD", "Not found");
    }

    // §2.4(d) — a split id from another household must not be attachable.
    if (data.expenseSplitId !== undefined) {
      const split = await prisma.expenseSplit.findUnique({
        where: { id: data.expenseSplitId },
        select: { userId: true, expense: { select: { householdId: true } } },
      });
      if (!split || split.expense.householdId !== data.householdId) {
        return fail("WRONG_HOUSEHOLD", "Not found");
      }
      // Paying off somebody else's share would misattribute the settlement.
      if (split.userId !== membership.userId) {
        return fail("VALIDATION", "That share belongs to somebody else.");
      }
    }

    const paymentId = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          householdId: data.householdId,
          fromUserId: membership.userId,
          toUserId: data.toUserId,
          amountCents: toDbCents(data.amountCents, "payment amount"),
          currency: data.currency,
          method: data.method,
          expenseSplitId: data.expenseSplitId ?? null,
          reference: data.reference ?? null,
          note: data.note ?? null,
        },
        select: { id: true, amountCents: true, method: true },
      });

      await writeAuditLog(tx, {
        householdId: data.householdId,
        actorUserId: actor.id,
        action: "PAYMENT_CREATED",
        entityType: "payment",
        entityId: payment.id,
        after: {
          fromUserId: membership.userId,
          toUserId: data.toUserId,
          amountCents: payment.amountCents,
          currency: data.currency,
          method: payment.method,
          expenseSplitId: data.expenseSplitId ?? null,
        },
      });

      // A placeholder cannot read a notification, and its manager confirms on
      // its behalf, so there is nobody to tell.
      if (!recipient.user.isPlaceholder) {
        const household = await tx.household.findUniqueOrThrow({
          where: { id: data.householdId },
          select: { name: true },
        });
        await createNotifications(tx, {
          householdId: data.householdId,
          context: {
            actorName: actor.name ?? actor.email ?? "Someone",
            householdName: household.name,
            amountCents: data.amountCents,
            currency: data.currency,
          },
          targets: [
            {
              userId: data.toUserId,
              type: "PAYMENT_RECEIVED",
              entityType: "payment",
              entityId: payment.id,
            },
          ],
        });
      }

      return payment.id;
    });

    revalidatePath(`/households/${data.householdId}`);
    return ok({ paymentId });
  } catch (error) {
    return toActionResult(error);
  }
}
