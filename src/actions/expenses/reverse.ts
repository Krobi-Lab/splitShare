"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, toActionResult, type ActionResult } from "@/lib/actions/result";
import { writeAuditLog } from "@/lib/audit/write";
import { requireAuth, requireCapability } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { reverseExpenseSchema } from "@/lib/expenses/schema";
import { statusAfterReversal } from "@/lib/expenses/state";

/**
 * Reverses an expense (§2.2, §7).
 *
 * Nothing is edited or deleted. A new expense is created carrying the exact
 * negation of the original's amount and of every split, with
 * `reversesExpenseId` pointing back at it, and the original moves to REVERSED.
 * The two then cancel out in the §12 balances while both remain on the record.
 *
 * Splits are negated one by one rather than recomputed, so the reversal is
 * exactly the inverse of what was charged — recomputing could round a penny
 * differently and leave a cent behind.
 */
export async function reverseExpense(
  input: unknown,
): Promise<ActionResult<{ reversalExpenseId: string }>> {
  try {
    const data = reverseExpenseSchema.parse(input);
    const membership = await requireCapability(data.householdId, "CREATE_EXPENSE");
    const actor = await requireAuth();

    const expense = await prisma.expense.findUnique({
      where: { id: data.expenseId },
      select: {
        id: true,
        householdId: true,
        status: true,
        description: true,
        amountCents: true,
        currency: true,
        categoryId: true,
        paidByUserId: true,
        splitMethod: true,
        reversedBy: { select: { id: true } },
        splits: {
          select: { userId: true, amountCents: true, percentBps: true, shares: true },
        },
      },
    });

    if (!expense || expense.householdId !== data.householdId) {
      return fail("WRONG_HOUSEHOLD", "Not found");
    }
    if (expense.reversedBy) {
      return fail("CONFLICT", "That expense has already been reversed.");
    }

    // Throws for a LOCKED expense, which rejects every mutation (§7).
    const originalNextStatus = statusAfterReversal(expense.status);
    const now = new Date();

    const reversalExpenseId = await prisma.$transaction(async (tx) => {
      const reversal = await tx.expense.create({
        data: {
          householdId: data.householdId,
          paidByUserId: expense.paidByUserId,
          createdByUserId: membership.userId,
          categoryId: expense.categoryId,
          description: `Reversal: ${expense.description}`.slice(0, 200),
          amountCents: -expense.amountCents,
          currency: expense.currency,
          date: now,
          notes: data.reason,
          splitMethod: expense.splitMethod,
          reversesExpenseId: expense.id,
          // A reversal is not up for debate: it cancels something already
          // agreed, so it lands ACCEPTED and takes effect at once.
          status: "ACCEPTED",
          splits: {
            create: expense.splits.map((split) => ({
              userId: split.userId,
              amountCents: -split.amountCents,
              percentBps: split.percentBps,
              shares: split.shares,
              acceptance: "ACCEPTED",
              acceptedAt: now,
            })),
          },
        },
        select: { id: true, amountCents: true },
      });

      await tx.expense.update({
        where: { id: expense.id },
        data: { status: originalNextStatus },
      });

      await writeAuditLog(tx, {
        householdId: data.householdId,
        actorUserId: actor.id,
        action: "EXPENSE_REVERSED",
        entityType: "expense",
        entityId: expense.id,
        before: { status: expense.status, amountCents: expense.amountCents },
        after: {
          status: originalNextStatus,
          reversalExpenseId: reversal.id,
          reversalAmountCents: reversal.amountCents,
          reason: data.reason,
        },
      });

      return reversal.id;
    });

    revalidatePath(`/households/${data.householdId}`);
    return ok({ reversalExpenseId });
  } catch (error) {
    return toActionResult(error);
  }
}
