import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { AuditAction } from "@/generated/prisma/enums";

import { toAuditJson } from "./json";

/**
 * §11 — every financial state transition writes one `audit_logs` row inside the
 * same transaction as the change itself.
 *
 * This takes a `Prisma.TransactionClient`, never the top-level client, so it is
 * impossible to call it outside a transaction by accident: if the change rolls
 * back, so does its audit row, and there is no window in which one exists
 * without the other.
 */

export interface AuditEntry {
  householdId: string;
  /** Null for system actors, e.g. the reminders cron. */
  actorUserId: string | null;
  action: AuditAction;
  /** The table or domain concept, e.g. "expense", "payment". */
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * A `Json?` column distinguishes "SQL NULL" from "the JSON value null", so
 * Prisma rejects a bare `null` here and wants `Prisma.JsonNull` instead.
 * `undefined` leaves the column untouched.
 */
function jsonInput(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) {
    return undefined;
  }
  const json = toAuditJson(value);
  return json === null ? Prisma.JsonNull : (json as Prisma.InputJsonValue);
}

export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      householdId: entry.householdId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeJson: jsonInput(entry.before),
      afterJson: jsonInput(entry.after),
    },
  });
}
