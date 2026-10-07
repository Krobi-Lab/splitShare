/**
 * §18 — which reminders should exist.
 *
 * Pure: given the unpaid splits and today's date, it returns the reminders that
 * *ought* to exist. It does not know what has already been sent. The cron route
 * inserts only the ones missing, and the `(expense_split_id, offset_days)`
 * unique key makes that idempotent — a replay inserts nothing and so sends
 * nothing twice.
 *
 * Being a pure function of (splits, today) is what makes the whole thing
 * testable: the awkward cases are all about dates, and none of them need a
 * database or a clock.
 */

export const DEFAULT_REMINDER_OFFSET_DAYS: readonly number[] = [3, 7];

export interface UnpaidSplit {
  expenseSplitId: string;
  householdId: string;
  userId: string;
  /** The expense's date, which the offsets count from. */
  expenseDate: Date;
}

export interface DueReminder {
  expenseSplitId: string;
  householdId: string;
  userId: string;
  offsetDays: number;
  /** The date this reminder became due, at UTC midnight. */
  dueDate: Date;
}

/** Midnight UTC on the day the given instant falls on. */
function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
}

function addDays(date: Date, days: number): Date {
  const result = startOfUtcDay(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Every reminder that is due on or before `today`.
 *
 * Returns past-due reminders too, not just ones due exactly today. If the cron
 * misses a run — a deploy, an outage, a suspended project — the next run still
 * catches up rather than skipping those reminders forever.
 *
 * Offsets are deduplicated and sorted, so a household configured with [3, 3, 7]
 * does not produce two identical reminders that would then collide on the
 * unique key.
 */
export function remindersDue(
  splits: readonly UnpaidSplit[],
  today: Date,
  offsetDays: readonly number[] = DEFAULT_REMINDER_OFFSET_DAYS,
): DueReminder[] {
  const offsets = [...new Set(offsetDays)]
    .filter((offset) => Number.isInteger(offset) && offset >= 0)
    .sort((a, b) => a - b);

  const cutoff = startOfUtcDay(today);
  const due: DueReminder[] = [];

  for (const split of splits) {
    for (const offset of offsets) {
      const dueDate = addDays(split.expenseDate, offset);
      if (dueDate.getTime() <= cutoff.getTime()) {
        due.push({
          expenseSplitId: split.expenseSplitId,
          householdId: split.householdId,
          userId: split.userId,
          offsetDays: offset,
          dueDate,
        });
      }
    }
  }

  return due;
}

/**
 * The subset of `due` that has not been recorded yet.
 *
 * `existing` is the set of `${expenseSplitId}:${offsetDays}` keys already in the
 * `reminders` table. Keeping this separate from `remindersDue` means the "what
 * should exist" rule stays a pure function of dates, and the deduplication
 * against stored state is its own small, equally testable step.
 */
export function remindersToCreate(
  due: readonly DueReminder[],
  existing: ReadonlySet<string>,
): DueReminder[] {
  const seen = new Set(existing);
  const fresh: DueReminder[] = [];

  for (const reminder of due) {
    const key = reminderKey(reminder.expenseSplitId, reminder.offsetDays);
    if (seen.has(key)) {
      continue;
    }
    // Guards against duplicates within one batch as well as against stored
    // ones, so a single run cannot violate the unique key either.
    seen.add(key);
    fresh.push(reminder);
  }

  return fresh;
}

export function reminderKey(expenseSplitId: string, offsetDays: number): string {
  return `${expenseSplitId}:${offsetDays}`;
}
