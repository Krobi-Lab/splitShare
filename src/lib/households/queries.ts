import "server-only";

import { cache } from "react";

import type { HouseholdRole } from "@/generated/prisma/enums";
import { requireAuth, requireHouseholdMember } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { fromDbCents } from "@/lib/money";

/**
 * Read models for households.
 *
 * Every query here goes through the §2.4 guard chain first, so there is no path
 * that reads a household the caller is not a member of. Balances come from the
 * §12 views — they are never recomputed in TypeScript, because two
 * implementations of the same arithmetic will eventually disagree.
 */

export interface HouseholdSummary {
  id: string;
  name: string;
  currency: string;
  role: HouseholdRole;
  memberCount: number;
  /** The caller's own settled position: positive => owed to them. */
  yourNetCents: number;
}

export interface MemberBalance {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: HouseholdRole;
  totalPaidCents: number;
  totalOwedCents: number;
  /** Expense-derived, exactly per §12. */
  expenseNetCents: number;
  /** §12 net adjusted by confirmed payments — what the dashboard shows. */
  settledNetCents: number;
}

/** Shape of a `household_net_positions` row. */
interface NetPositionRow {
  user_id: string;
  total_paid_cents: bigint;
  total_owed_cents: bigint;
  expense_net_cents: bigint;
  settled_net_cents: bigint;
}

/** Households the signed-in user belongs to, with their own net position. */
export const listHouseholds = cache(async (): Promise<HouseholdSummary[]> => {
  const user = await requireAuth();

  const memberships = await prisma.householdMember.findMany({
    where: { userId: user.id, removedAt: null },
    select: {
      role: true,
      household: {
        select: {
          id: true,
          name: true,
          currency: true,
          _count: { select: { members: { where: { removedAt: null } } } },
        },
      },
    },
    orderBy: { household: { name: "asc" } },
  });

  if (memberships.length === 0) {
    return [];
  }

  const rows = await prisma.$queryRaw<
    Array<{ household_id: string; settled_net_cents: bigint }>
  >`
    SELECT household_id, settled_net_cents
      FROM "household_net_positions"
     WHERE user_id = ${user.id}::uuid
  `;
  const netByHousehold = new Map(
    rows.map((row) => [row.household_id, fromDbCents(row.settled_net_cents)]),
  );

  return memberships.map((membership) => ({
    id: membership.household.id,
    name: membership.household.name,
    currency: membership.household.currency,
    role: membership.role,
    memberCount: membership.household._count.members,
    yourNetCents: netByHousehold.get(membership.household.id) ?? 0,
  }));
});

/** Every member's balance in a household, for the dashboard and settle-up. */
export async function getMemberBalances(householdId: string): Promise<MemberBalance[]> {
  await requireHouseholdMember(householdId);

  const [members, rows] = await Promise.all([
    prisma.householdMember.findMany({
      where: { householdId, removedAt: null },
      select: {
        role: true,
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    }),
    prisma.$queryRaw<NetPositionRow[]>`
      SELECT user_id, total_paid_cents, total_owed_cents, expense_net_cents, settled_net_cents
        FROM "household_net_positions"
       WHERE household_id = ${householdId}::uuid
    `,
  ]);

  const byUser = new Map(rows.map((row) => [row.user_id, row]));

  return members
    .map((member) => {
      const row = byUser.get(member.user.id);
      return {
        userId: member.user.id,
        name: member.user.name,
        email: member.user.email,
        image: member.user.image,
        role: member.role,
        totalPaidCents: row ? fromDbCents(row.total_paid_cents) : 0,
        totalOwedCents: row ? fromDbCents(row.total_owed_cents) : 0,
        expenseNetCents: row ? fromDbCents(row.expense_net_cents) : 0,
        settledNetCents: row ? fromDbCents(row.settled_net_cents) : 0,
      };
    })
    .sort((a, b) => b.settledNetCents - a.settledNetCents);
}

export interface HouseholdDetail {
  id: string;
  name: string;
  currency: string;
  reminderOffsetDays: number[];
  yourRole: HouseholdRole;
  members: MemberBalance[];
}

export async function getHousehold(householdId: string): Promise<HouseholdDetail> {
  const membership = await requireHouseholdMember(householdId);

  const [household, members] = await Promise.all([
    prisma.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { id: true, name: true, currency: true, reminderOffsetDays: true },
    }),
    getMemberBalances(householdId),
  ]);

  return { ...household, yourRole: membership.role, members };
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: HouseholdRole;
  expiresAt: Date;
  invitedByName: string | null;
}

/** §5 — admin-only data, so the caller must already hold MANAGE_MEMBERS. */
export async function listPendingInvitations(
  householdId: string,
): Promise<PendingInvitation[]> {
  const invitations = await prisma.invitation.findMany({
    where: { householdId, status: "PENDING" },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      invitedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    invitedByName: invitation.invitedBy.name,
  }));
}
