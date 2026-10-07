"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, toActionResult, type ActionResult } from "@/lib/actions/result";
import { writeAuditLog } from "@/lib/audit/write";
import { requireAuth, requireCapability } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { statusAfterLock } from "@/lib/expenses/state";
import { createNotifications } from "@/lib/notifications/create";

import { lockExpenseSchema } from "./schema";

/**
 * Locks a paid expense (§5 ADMIN only, §40 step 8).
 *
 * LOCKED is a sink in the §7 machine: it rejects every mutation thereafter, and
 * `assertTransition` enforces that. The only route to a correction afterwards is
 * a reversing expense.
 */
export async function lockExpense(input: unknown): Promise<ActionResult<null>> {
  try {
    const data = lockExpenseSchema.parse(input);
    const membership = await requireCapability(data.householdId, "LOCK_EXPENSE");
    const actor = await requireAuth();

    const expense = await prisma.expense.findUnique({
      where: { id: data.expenseId },
      select: {
        id: true,
        householdId: true,
        status: true,
        description: true,
        splits: { select: { userId: true } },
      },
    });

    if (!expense || expense.householdId !== data.householdId) {
      return fail("WRONG_HOUSEHOLD", "Not found");
    }
    if (expense.status === "LOCKED") {
      return ok(null);
    }

    // Throws unless the expense is PAID — the state machine, not this action,
    // decides that only a settled expense can be closed.
    const nextStatus = statusAfterLock(expense.status);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id: expense.id },
        data: { status: nextStatus, lockedAt: now, lockedByUserId: membership.userId },
      });

      await writeAuditLog(tx, {
        householdId: data.householdId,
        actorUserId: actor.id,
        action: "EXPENSE_LOCKED",
        entityType: "expense",
        entityId: expense.id,
        before: { status: expense.status },
        after: { status: nextStatus, lockedByUserId: membership.userId },
      });

      const others = await tx.householdMember.findMany({
        where: {
          householdId: data.householdId,
          removedAt: null,
          userId: { not: actor.id },
          user: { isPlaceholder: false },
        },
        select: { userId: true },
      });
      const household = await tx.household.findUniqueOrThrow({
        where: { id: data.householdId },
        select: { name: true },
      });

      await createNotifications(tx, {
        householdId: data.householdId,
        context: {
          actorName: actor.name ?? actor.email ?? "An admin",
          householdName: household.name,
          description: expense.description,
        },
        targets: others.map((member) => ({
          userId: member.userId,
          type: "EXPENSE_LOCKED" as const,
          entityType: "expense",
          entityId: expense.id,
        })),
      });
    });

    revalidatePath(`/households/${data.householdId}`);
    return ok(null);
  } catch (error) {
    return toActionResult(error);
  }
}
