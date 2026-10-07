import "server-only";

import type { PaymentMethod, PaymentStatus } from "@/generated/prisma/enums";
import { requireHouseholdMember } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { fromDbCents } from "@/lib/money";

/**
 * Read models for payments.
 *
 * Status is read from the `payment_states` view rather than reconstructed here:
 * `payments` carries no status column (§9/§10), and deriving it in two places
 * would eventually disagree.
 */

export interface PaymentListItem {
  id: string;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amountCents: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: Date;
  note: string | null;
  /** True when the signed-in user may confirm it (§9, §8a). */
  youCanConfirm: boolean;
}

interface PaymentStateRow {
  id: string;
  status: PaymentStatus;
}

async function decorate(
  householdId: string,
  viewerUserId: string,
  where: object,
  take: number,
): Promise<PaymentListItem[]> {
  const payments = await prisma.payment.findMany({
    where: { householdId, ...where },
    select: {
      id: true,
      fromUserId: true,
      toUserId: true,
      amountCents: true,
      currency: true,
      method: true,
      paidAt: true,
      note: true,
      fromUser: { select: { name: true, email: true } },
      toUser: {
        select: { name: true, email: true, isPlaceholder: true, managedByUserId: true },
      },
    },
    orderBy: { paidAt: "desc" },
    take,
  });

  if (payments.length === 0) {
    return [];
  }

  const states = await prisma.$queryRaw<PaymentStateRow[]>`
    SELECT id, status FROM "payment_states"
     WHERE household_id = ${householdId}::uuid
  `;
  const statusById = new Map(states.map((row) => [row.id, row.status]));

  return payments.map((payment) => {
    const status = statusById.get(payment.id) ?? "PENDING_CONFIRMATION";
    // §9 only the recipient confirms; §8a their manager may act for them.
    const isRecipient = payment.toUserId === viewerUserId;
    const managesRecipient =
      payment.toUser.isPlaceholder && payment.toUser.managedByUserId === viewerUserId;

    return {
      id: payment.id,
      fromUserId: payment.fromUserId,
      fromName: payment.fromUser.name ?? payment.fromUser.email,
      toUserId: payment.toUserId,
      toName: payment.toUser.name ?? payment.toUser.email,
      amountCents: fromDbCents(payment.amountCents, "payment amount"),
      currency: payment.currency,
      method: payment.method,
      status,
      paidAt: payment.paidAt,
      note: payment.note,
      youCanConfirm:
        status === "PENDING_CONFIRMATION" && (isRecipient || managesRecipient),
    };
  });
}

/** Payments waiting on the signed-in user to confirm them (§40 step 6). */
export async function listPaymentsAwaitingYou(
  householdId: string,
): Promise<PaymentListItem[]> {
  const membership = await requireHouseholdMember(householdId);

  const managed = await prisma.user.findMany({
    where: { isPlaceholder: true, managedByUserId: membership.userId },
    select: { id: true },
  });

  return (
    await decorate(
      householdId,
      membership.userId,
      {
        toUserId: { in: [membership.userId, ...managed.map((user) => user.id)] },
        confirmation: { is: null },
        reversedBy: { is: null },
        // A reversal row is itself a correction, not something to confirm.
        reversesPaymentId: null,
      },
      50,
    )
  ).filter((payment) => payment.status === "PENDING_CONFIRMATION");
}

export async function listPayments(
  householdId: string,
  limit = 25,
): Promise<PaymentListItem[]> {
  const membership = await requireHouseholdMember(householdId);
  return decorate(householdId, membership.userId, {}, limit);
}
