/**
 * The §5 role matrix, as data.
 *
 * Pure and dependency-free so it can be exhaustively tested: the matrix is the
 * authorization policy, and a wrong cell is a security bug. `guards.ts` is the
 * only thing that should consult it at runtime.
 */

import type { HouseholdRole } from "@/generated/prisma/enums";

export type Capability =
  | "VIEW_HOUSEHOLD"
  | "CREATE_EXPENSE"
  | "ACCEPT_OWN_SPLIT"
  | "RECORD_OWN_PAYMENT"
  | "CONFIRM_PAYMENT_RECEIVED"
  | "MANAGE_MEMBERS"
  | "MANAGE_SETTINGS"
  | "LOCK_EXPENSE"
  | "VIEW_AUDIT_LOGS";

/** Exactly the §5 table. ADMIN is not implicitly allowed everything. */
const MATRIX: Record<Capability, readonly HouseholdRole[]> = {
  VIEW_HOUSEHOLD: ["ADMIN", "MEMBER", "VIEWER"],
  CREATE_EXPENSE: ["ADMIN", "MEMBER"],
  ACCEPT_OWN_SPLIT: ["ADMIN", "MEMBER"],
  RECORD_OWN_PAYMENT: ["ADMIN", "MEMBER"],
  CONFIRM_PAYMENT_RECEIVED: ["ADMIN", "MEMBER"],
  MANAGE_MEMBERS: ["ADMIN"],
  MANAGE_SETTINGS: ["ADMIN"],
  LOCK_EXPENSE: ["ADMIN"],
  VIEW_AUDIT_LOGS: ["ADMIN"],
};

/** Human wording for denial messages and tooltips. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  VIEW_HOUSEHOLD: "view this household",
  CREATE_EXPENSE: "create an expense",
  ACCEPT_OWN_SPLIT: "accept or reject a split",
  RECORD_OWN_PAYMENT: "record a payment",
  CONFIRM_PAYMENT_RECEIVED: "confirm a payment was received",
  MANAGE_MEMBERS: "invite, remove, or change the role of a member",
  MANAGE_SETTINGS: "manage categories and settings",
  LOCK_EXPENSE: "lock an expense",
  VIEW_AUDIT_LOGS: "view the audit log",
};

export function can(role: HouseholdRole, capability: Capability): boolean {
  return MATRIX[capability].includes(role);
}

/** Every capability a role has, for rendering UI affordances. */
export function capabilitiesFor(role: HouseholdRole): Capability[] {
  return (Object.keys(MATRIX) as Capability[]).filter((capability) =>
    can(role, capability),
  );
}

/** The capability list, for tests and admin screens. */
export const ALL_CAPABILITIES = Object.keys(MATRIX) as readonly Capability[];
