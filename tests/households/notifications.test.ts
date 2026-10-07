import { describe, expect, it } from "vitest";

import type { NotificationType } from "@/generated/prisma/enums";
import { notificationCopy } from "@/lib/notifications/messages";

const ALL_TYPES: NotificationType[] = [
  "EXPENSE_CREATED",
  "SPLIT_ACCEPTED",
  "SPLIT_REJECTED",
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_REMINDER",
  "MEMBER_JOINED",
  "EXPENSE_LOCKED",
];

const context = {
  actorName: "Ann",
  householdName: "Flat 3",
  amountCents: 4500,
  currency: "NZD",
  description: "Groceries",
};

describe("notificationCopy", () => {
  it("has copy for every notification type", () => {
    for (const type of ALL_TYPES) {
      const copy = notificationCopy(type, context);
      expect(copy.title, type).toBeTruthy();
      expect(copy.body, type).toBeTruthy();
    }
  });

  it("renders money through formatMoney, never raw cents", () => {
    for (const type of ALL_TYPES) {
      const copy = notificationCopy(type, context);
      expect(`${copy.title} ${copy.body}`, type).not.toMatch(/\b4500\b/);
    }
  });

  it("names the actor where the actor matters", () => {
    expect(notificationCopy("EXPENSE_CREATED", context).title).toContain("Ann");
    expect(notificationCopy("MEMBER_JOINED", context).title).toContain("Flat 3");
  });

  it("degrades gracefully when there is no amount to show", () => {
    const copy = notificationCopy("PAYMENT_REMINDER", {
      actorName: "Ann",
      householdName: "Flat 3",
    });
    expect(copy.title).toBeTruthy();
    expect(copy.title).not.toContain("undefined");
    expect(copy.title).not.toContain("NaN");
  });

  it("falls back to a generic noun when there is no description", () => {
    const copy = notificationCopy("SPLIT_ACCEPTED", {
      actorName: "Ann",
      householdName: "Flat 3",
    });
    expect(copy.body).toContain("an expense");
  });

  it("titles the §40 expense-created notification with the share to accept", () => {
    expect(notificationCopy("EXPENSE_CREATED", context).body).toContain("$45.00");
  });
});
