import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { NotificationType } from "@/generated/prisma/enums";

import { notificationCopy, type NotificationContext } from "./messages";

/**
 * §17 — notification rows are created inside the same transaction as the
 * financial change that triggered them.
 *
 * Like `writeAuditLog`, this takes a `Prisma.TransactionClient` rather than the
 * top-level client, so it cannot be called outside a transaction by accident:
 * a rolled-back expense must not leave behind a notification telling someone
 * about an expense that does not exist.
 */

export interface NotificationTarget {
  userId: string;
  type: NotificationType;
  entityType?: string;
  entityId?: string;
  /**
   * Fields that differ per recipient, merged over the shared context.
   *
   * EXPENSE_CREATED reads "your share is X", and X is a different number for
   * every participant, so the amount cannot live in the shared context.
   */
  context?: Partial<NotificationContext>;
}

export async function createNotifications(
  tx: Prisma.TransactionClient,
  options: {
    householdId: string;
    context: NotificationContext;
    /** Recipients. The actor is normally excluded by the caller. */
    targets: readonly NotificationTarget[];
  },
): Promise<void> {
  if (options.targets.length === 0) {
    return;
  }

  await tx.notification.createMany({
    data: options.targets.map((target) => {
      const copy = notificationCopy(target.type, {
        ...options.context,
        ...target.context,
      });
      return {
        householdId: options.householdId,
        userId: target.userId,
        type: target.type,
        title: copy.title,
        body: copy.body,
        entityType: target.entityType ?? null,
        entityId: target.entityId ?? null,
      };
    }),
  });
}
