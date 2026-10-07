import "server-only";

import { prisma } from "@/lib/db/client";
import { sendPaymentReminderEmail } from "@/lib/email/send";
import { fromDbCents } from "@/lib/money";
import { createNotifications } from "@/lib/notifications/create";

import {
  DEFAULT_REMINDER_OFFSET_DAYS,
  reminderKey,
  remindersDue,
  remindersToCreate,
  type UnpaidSplit,
} from "./schedule";

/**
 * §18 — the work the cron route does.
 *
 * Split out from the route so it can be driven directly, and so the route stays
 * nothing but authentication plus a call.
 *
 * Idempotent by construction: `remindersToCreate` filters against what is
 * already recorded, and the `(expense_split_id, offset_days)` unique key is the
 * backstop if two runs overlap. A replay therefore inserts nothing and sends
 * nothing twice.
 */

export interface ReminderRunResult {
  considered: number;
  created: number;
  notified: number;
}

export async function runReminders(today: Date = new Date()): Promise<ReminderRunResult> {
  // Unpaid, accepted shares on expenses that actually count toward balances.
  // A pending or disputed share is not owed yet, and a placeholder has nobody
  // to remind.
  const splits = await prisma.expenseSplit.findMany({
    where: {
      acceptance: "ACCEPTED",
      settledAt: null,
      user: { isPlaceholder: false },
      expense: {
        status: { in: ["ACCEPTED", "PARTIALLY_PAID"] },
        // Nobody owes themselves; the payer's share is settled at creation.
        NOT: { splits: { none: {} } },
      },
    },
    select: {
      id: true,
      userId: true,
      amountCents: true,
      expense: {
        select: {
          id: true,
          householdId: true,
          description: true,
          currency: true,
          date: true,
          household: { select: { name: true, reminderOffsetDays: true } },
        },
      },
      user: { select: { name: true, email: true } },
    },
  });

  if (splits.length === 0) {
    return { considered: 0, created: 0, notified: 0 };
  }

  const existing = await prisma.reminder.findMany({
    where: { expenseSplitId: { in: splits.map((split) => split.id) } },
    select: { expenseSplitId: true, offsetDays: true },
  });
  const recorded = new Set(
    existing.map((row) => reminderKey(row.expenseSplitId, row.offsetDays)),
  );

  const byId = new Map(splits.map((split) => [split.id, split]));

  // Offsets are per household (§18), so the pure scheduler is run per group
  // rather than once over everything.
  const groups = new Map<string, { offsets: readonly number[]; splits: UnpaidSplit[] }>();
  for (const split of splits) {
    const householdId = split.expense.householdId;
    const group = groups.get(householdId) ?? {
      offsets:
        split.expense.household.reminderOffsetDays.length > 0
          ? split.expense.household.reminderOffsetDays
          : DEFAULT_REMINDER_OFFSET_DAYS,
      splits: [],
    };
    group.splits.push({
      expenseSplitId: split.id,
      householdId,
      userId: split.userId,
      expenseDate: split.expense.date,
    });
    groups.set(householdId, group);
  }

  const toCreate = [...groups.values()].flatMap((group) =>
    remindersToCreate(remindersDue(group.splits, today, group.offsets), recorded),
  );

  if (toCreate.length === 0) {
    return { considered: splits.length, created: 0, notified: 0 };
  }

  let notified = 0;

  for (const reminder of toCreate) {
    const split = byId.get(reminder.expenseSplitId);
    if (!split) {
      continue;
    }

    const amountCents = fromDbCents(split.amountCents, "split amount");

    // One transaction per reminder, so a single failure cannot undo the ones
    // already recorded — and the unique key means a retry skips them.
    await prisma.$transaction(async (tx) => {
      await tx.reminder.create({
        data: {
          householdId: reminder.householdId,
          expenseSplitId: reminder.expenseSplitId,
          userId: reminder.userId,
          offsetDays: reminder.offsetDays,
          dueDate: reminder.dueDate,
          sentAt: new Date(),
        },
      });

      await createNotifications(tx, {
        householdId: reminder.householdId,
        context: {
          // The cron has no human actor (§11 allows a null actorUserId).
          actorName: "SplitHome",
          householdName: split.expense.household.name,
          description: split.expense.description,
          amountCents,
          currency: split.expense.currency,
        },
        targets: [
          {
            userId: reminder.userId,
            type: "PAYMENT_REMINDER",
            entityType: "expense",
            entityId: split.expense.id,
          },
        ],
      });
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    await sendPaymentReminderEmail(
      { email: split.user.email, name: split.user.name },
      {
        householdName: split.expense.household.name,
        description: split.expense.description,
        amountCents,
        currency: split.expense.currency,
        dueDate: reminder.dueDate,
        url: `${appUrl}/households/${reminder.householdId}`,
      },
    );
    notified += 1;
  }

  return { considered: splits.length, created: toCreate.length, notified };
}
