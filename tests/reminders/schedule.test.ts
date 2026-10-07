import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDER_OFFSET_DAYS,
  reminderKey,
  remindersDue,
  remindersToCreate,
  type UnpaidSplit,
} from "@/lib/reminders/schedule";

const HOUSEHOLD = "household-1";
const USER = "user-1";

function split(expenseSplitId: string, date: string): UnpaidSplit {
  return {
    expenseSplitId,
    householdId: HOUSEHOLD,
    userId: USER,
    expenseDate: new Date(date),
  };
}

const day = (date: string) => new Date(date);

describe("remindersDue", () => {
  it("defaults to 3 and 7 days after the expense (§18)", () => {
    expect([...DEFAULT_REMINDER_OFFSET_DAYS]).toEqual([3, 7]);
  });

  it("produces nothing before the first offset falls due", () => {
    const due = remindersDue(
      [split("s1", "2026-10-01T00:00:00Z")],
      day("2026-10-03T12:00:00Z"),
    );
    expect(due).toHaveLength(0);
  });

  it("produces the 3-day reminder on the day it falls due", () => {
    const due = remindersDue(
      [split("s1", "2026-10-01T00:00:00Z")],
      day("2026-10-04T00:00:00Z"),
    );
    expect(due.map((reminder) => reminder.offsetDays)).toEqual([3]);
    expect(due[0].dueDate.toISOString()).toBe("2026-10-04T00:00:00.000Z");
  });

  it("produces both once the second offset has passed", () => {
    const due = remindersDue(
      [split("s1", "2026-10-01T00:00:00Z")],
      day("2026-10-20T00:00:00Z"),
    );
    expect(due.map((reminder) => reminder.offsetDays)).toEqual([3, 7]);
  });

  it("still catches up after a missed run, rather than skipping forever", () => {
    // The cron did not run for a fortnight — a deploy, an outage. Both
    // reminders are still owed.
    const due = remindersDue(
      [split("s1", "2026-09-01T00:00:00Z")],
      day("2026-10-01T00:00:00Z"),
    );
    expect(due).toHaveLength(2);
  });

  it("ignores the time of day, comparing whole UTC days", () => {
    const early = remindersDue(
      [split("s1", "2026-10-01T23:59:00Z")],
      day("2026-10-04T00:00:01Z"),
    );
    expect(early.map((reminder) => reminder.offsetDays)).toEqual([3]);
  });

  it("crosses month and year boundaries", () => {
    const due = remindersDue(
      [split("s1", "2026-12-30T00:00:00Z")],
      day("2027-01-06T00:00:00Z"),
    );
    expect(due.map((reminder) => reminder.dueDate.toISOString())).toEqual([
      "2027-01-02T00:00:00.000Z",
      "2027-01-06T00:00:00.000Z",
    ]);
  });

  it("honours a household's own offsets", () => {
    const due = remindersDue(
      [split("s1", "2026-10-01T00:00:00Z")],
      day("2026-10-15T00:00:00Z"),
      [1, 14],
    );
    expect(due.map((reminder) => reminder.offsetDays)).toEqual([1, 14]);
  });

  it("deduplicates and sorts offsets, so [7,3,3] cannot collide on the unique key", () => {
    const due = remindersDue(
      [split("s1", "2026-10-01T00:00:00Z")],
      day("2026-10-20T00:00:00Z"),
      [7, 3, 3],
    );
    expect(due.map((reminder) => reminder.offsetDays)).toEqual([3, 7]);
  });

  it("discards offsets that are not sensible whole days", () => {
    const due = remindersDue(
      [split("s1", "2026-10-01T00:00:00Z")],
      day("2026-10-20T00:00:00Z"),
      [-1, 1.5, Number.NaN, 3],
    );
    expect(due.map((reminder) => reminder.offsetDays)).toEqual([3]);
  });

  it("accepts a zero offset, meaning a reminder on the day itself", () => {
    const due = remindersDue(
      [split("s1", "2026-10-01T00:00:00Z")],
      day("2026-10-01T00:00:00Z"),
      [0],
    );
    expect(due).toHaveLength(1);
  });

  it("handles several splits at once and carries their ids through", () => {
    const due = remindersDue(
      [split("s1", "2026-10-01T00:00:00Z"), split("s2", "2026-10-02T00:00:00Z")],
      day("2026-10-05T00:00:00Z"),
    );
    expect(
      due.map((reminder) => `${reminder.expenseSplitId}:${reminder.offsetDays}`),
    ).toEqual(["s1:3", "s2:3"]);
  });

  it("returns nothing for no splits", () => {
    expect(remindersDue([], day("2026-10-20T00:00:00Z"))).toEqual([]);
  });
});

describe("remindersToCreate", () => {
  const due = remindersDue(
    [split("s1", "2026-10-01T00:00:00Z")],
    day("2026-10-20T00:00:00Z"),
  );

  it("creates everything when nothing has been recorded", () => {
    expect(remindersToCreate(due, new Set())).toHaveLength(2);
  });

  it("skips what has already been recorded — this is what makes a replay safe", () => {
    const existing = new Set([reminderKey("s1", 3)]);
    const fresh = remindersToCreate(due, existing);
    expect(fresh.map((reminder) => reminder.offsetDays)).toEqual([7]);
  });

  it("creates nothing on a replay with everything recorded", () => {
    const existing = new Set([reminderKey("s1", 3), reminderKey("s1", 7)]);
    expect(remindersToCreate(due, existing)).toEqual([]);
  });

  it("deduplicates within a single batch, not just against stored rows", () => {
    // A single run must not violate the unique key either.
    const doubled = [...due, ...due];
    expect(remindersToCreate(doubled, new Set())).toHaveLength(2);
  });

  it("keys on the split and offset together", () => {
    expect(reminderKey("s1", 3)).toBe("s1:3");
    expect(reminderKey("s1", 3)).not.toBe(reminderKey("s1", 7));
    expect(reminderKey("s1", 3)).not.toBe(reminderKey("s2", 3));
  });
});
