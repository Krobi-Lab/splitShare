"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, toActionResult, type ActionResult } from "@/lib/actions/result";
import { writeAuditLog } from "@/lib/audit/write";
import { requireAuth, requireCanActFor, requireCapability } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { sendPaymentConfirmedEmail } from "@/lib/email/send";
import { confirmPaymentSchema } from "@/lib/expenses/schema";
import { statusAfterPaymentConfirmed } from "@/lib/expenses/state";
import { fromDbCents } from "@/lib/money";
import { createNotifications } from "@/lib/notifications/create";

/**
 * Confirms a payment was received (§9, §40 step 6).
 *
 * Only the recipient may confirm — or, for a placeholder recipient, whoever
 * manages it (§8a). This is the moment money actually moves in the balances,
 * because a payment counts only once a `payment_confirmations` row exists.
 *
 * Confirming INSERTs that row rather than updating the payment, since
 * `payments` is append-only (§9/§10) and a trigger rejects any UPDATE.
 */
export async function confirmPayment(
  input: unknown,
): Promise<ActionResult<{ expenseStatus: string | null }>> {
  try {
    const data = confirmPaymentSchema.parse(input);
    await requireCapability(data.householdId, "CONFIRM_PAYMENT_RECEIVED");
    const actor = await requireAuth();

    const payment = await prisma.payment.findUnique({
      where: { id: data.paymentId },
      select: {
        id: true,
        householdId: true,
        fromUserId: true,
        toUserId: true,
        amountCents: true,
        currency: true,
        expenseSplitId: true,
        reversesPaymentId: true,
        confirmation: { select: { id: true } },
        reversedBy: { select: { id: true } },
        fromUser: { select: { name: true, email: true, isPlaceholder: true } },
      },
    });

    // §2.4(d) — another household's payment id reads as missing.
    if (!payment || payment.householdId !== data.householdId) {
      return fail("WRONG_HOUSEHOLD", "Not found");
    }

    // §9 — only the recipient, or a placeholder recipient's manager.
    await requireCanActFor(actor.id, payment.toUserId, "the person who was paid");

    if (payment.confirmation) {
      return fail("CONFLICT", "That payment has already been confirmed.");
    }
    if (payment.reversedBy) {
      return fail("CONFLICT", "That payment was reversed.");
    }

    const now = new Date();

    const expenseStatus = await prisma.$transaction(async (tx) => {
      await tx.paymentConfirmation.create({
        data: {
          paymentId: payment.id,
          confirmedByUserId: actor.id,
          confirmedAt: now,
        },
      });

      let nextStatus: string | null = null;

      // A payment aimed at a specific share can settle it and move the parent
      // expense along the §7 machine.
      if (payment.expenseSplitId) {
        const split = await tx.expenseSplit.findUniqueOrThrow({
          where: { id: payment.expenseSplitId },
          select: {
            id: true,
            amountCents: true,
            settledAt: true,
            expense: {
              select: {
                id: true,
                status: true,
                splits: { select: { id: true, settledAt: true } },
              },
            },
          },
        });

        // Settled when confirmed payments cover the share. Summed from the rows
        // rather than assumed from this one, so part-payments work.
        const confirmedTotal = await tx.payment.aggregate({
          where: { expenseSplitId: split.id, confirmation: { isNot: null } },
          _sum: { amountCents: true },
        });
        const paidCents = fromDbCents(
          confirmedTotal._sum.amountCents ?? 0n,
          "confirmed total",
        );
        const owedCents = fromDbCents(split.amountCents, "split amount");
        const nowSettled = paidCents >= owedCents;

        if (nowSettled && split.settledAt === null) {
          await tx.expenseSplit.update({
            where: { id: split.id },
            data: { settledAt: now },
          });
        }

        const allSettled = split.expense.splits.every((candidate) =>
          candidate.id === split.id ? nowSettled : candidate.settledAt !== null,
        );

        const target = statusAfterPaymentConfirmed(split.expense.status, {
          allSplitsSettled: allSettled,
        });
        if (target !== split.expense.status) {
          await tx.expense.update({
            where: { id: split.expense.id },
            data: { status: target },
          });
        }
        nextStatus = target;
      }

      await writeAuditLog(tx, {
        householdId: data.householdId,
        actorUserId: actor.id,
        action: "PAYMENT_CONFIRMED",
        entityType: "payment",
        entityId: payment.id,
        after: {
          confirmedByUserId: actor.id,
          // Recorded so confirming for a placeholder is visible in the trail.
          recipientUserId: payment.toUserId,
          amountCents: payment.amountCents,
          expenseStatus: nextStatus,
        },
      });

      if (!payment.fromUser.isPlaceholder) {
        const household = await tx.household.findUniqueOrThrow({
          where: { id: data.householdId },
          select: { name: true },
        });
        await createNotifications(tx, {
          householdId: data.householdId,
          context: {
            actorName: actor.name ?? actor.email ?? "Someone",
            householdName: household.name,
            amountCents: fromDbCents(payment.amountCents, "payment amount"),
            currency: payment.currency,
          },
          targets: [
            {
              userId: payment.fromUserId,
              type: "PAYMENT_CONFIRMED",
              entityType: "payment",
              entityId: payment.id,
            },
          ],
        });
      }

      return nextStatus;
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    if (!payment.fromUser.isPlaceholder) {
      const household = await prisma.household.findUniqueOrThrow({
        where: { id: data.householdId },
        select: { name: true },
      });
      await sendPaymentConfirmedEmail(
        { email: payment.fromUser.email, name: payment.fromUser.name },
        {
          householdName: household.name,
          fromName: actor.name ?? actor.email ?? "They",
          amountCents: fromDbCents(payment.amountCents, "payment amount"),
          currency: payment.currency,
          url: `${appUrl}/households/${data.householdId}`,
        },
      );
    }

    revalidatePath(`/households/${data.householdId}`);
    return ok({ expenseStatus });
  } catch (error) {
    return toActionResult(error);
  }
}
