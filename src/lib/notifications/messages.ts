/**
 * §17 — in-app notification copy.
 *
 * Pure, so the wording is testable and lives in one place rather than being
 * assembled at each call site.
 */

import type { NotificationType } from "@/generated/prisma/enums";
import { formatMoney } from "@/lib/money";

export interface NotificationCopy {
  title: string;
  body: string;
}

export interface NotificationContext {
  actorName: string;
  householdName: string;
  amountCents?: number;
  currency?: string;
  description?: string;
}

function money(context: NotificationContext): string {
  if (context.amountCents === undefined || context.currency === undefined) {
    return "";
  }
  return formatMoney(context.amountCents, context.currency);
}

export function notificationCopy(
  type: NotificationType,
  context: NotificationContext,
): NotificationCopy {
  const what = context.description ?? "an expense";

  switch (type) {
    case "EXPENSE_CREATED":
      return {
        title: `${context.actorName} added ${what}`,
        body: `Your share is ${money(context)}. Accept it to confirm.`,
      };
    case "SPLIT_ACCEPTED":
      return {
        title: `${context.actorName} accepted their share`,
        body: `${what} is one step closer to settled.`,
      };
    case "SPLIT_REJECTED":
      return {
        title: `${context.actorName} rejected their share`,
        body: `${what} is disputed and needs sorting out.`,
      };
    case "PAYMENT_RECEIVED":
      return {
        title: `${context.actorName} says they paid you ${money(context)}`,
        body: "Confirm it once the money has arrived.",
      };
    case "PAYMENT_CONFIRMED":
      return {
        title: `${context.actorName} confirmed your ${money(context)} payment`,
        body: "Your balance has been updated.",
      };
    case "PAYMENT_REMINDER":
      return {
        title: `${money(context)} still outstanding`,
        body: `You have not yet paid your share of ${what}.`,
      };
    case "MEMBER_JOINED":
      return {
        title: `${context.actorName} joined ${context.householdName}`,
        body: "They can now be included in expenses.",
      };
    case "EXPENSE_LOCKED":
      return {
        title: `${context.actorName} locked ${what}`,
        body: "It can no longer be changed. A correction needs a reversing expense.",
      };
  }
}
