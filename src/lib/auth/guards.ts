import "server-only";

import { cache } from "react";

import type { HouseholdRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/client";

import { auth } from "./index";
import {
  InsufficientRoleError,
  NotAMemberError,
  UnauthenticatedError,
  WrongHouseholdError,
} from "./errors";
import { canActFor } from "@/lib/households/placeholders";

import { can, CAPABILITY_LABELS, type Capability } from "./permissions";

/**
 * The §2.4 guard chain.
 *
 * Every server action validates, in this order: (a) authenticated user,
 * (b) household membership, (c) role, (d) entity belongs to that household.
 * `requireCapability` collapses (a)-(c) into one call so an action cannot
 * accidentally skip a rung; (d) is `assertBelongsToHousehold`, which has to be
 * applied per entity the action touches.
 *
 * `cache` memoises per render pass / per request, so an action that calls these
 * several times still issues one session lookup and one membership query.
 */

export interface AuthenticatedUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

export interface Membership {
  householdId: string;
  userId: string;
  role: HouseholdRole;
  /** The household's ISO 4217 currency, needed by nearly every action. */
  currency: string;
}

/** (a) — throws rather than redirecting, so server actions can report it. */
export const requireAuth = cache(async (): Promise<AuthenticatedUser> => {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthenticatedError();
  }
  return {
    id: session.user.id,
    name: session.user.name ?? null,
    email: session.user.email ?? null,
    image: session.user.image ?? null,
  };
});

/** The signed-in user, or null — for pages that render differently either way. */
export const getOptionalUser = cache(async (): Promise<AuthenticatedUser | null> => {
  try {
    return await requireAuth();
  } catch {
    return null;
  }
});

/** (b) — membership in this specific household, and not a removed one. */
export const requireHouseholdMember = cache(
  async (householdId: string): Promise<Membership> => {
    const user = await requireAuth();

    const member = await prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId, userId: user.id } },
      select: {
        role: true,
        removedAt: true,
        household: { select: { currency: true } },
      },
    });

    // A removed member is treated as a non-member: their history survives, but
    // their access does not.
    if (!member || member.removedAt !== null) {
      throw new NotAMemberError();
    }

    return {
      householdId,
      userId: user.id,
      role: member.role,
      currency: member.household.currency,
    };
  },
);

/** (a) + (b) + (c) — the entry point every server action should use. */
export async function requireCapability(
  householdId: string,
  capability: Capability,
): Promise<Membership> {
  const membership = await requireHouseholdMember(householdId);
  if (!can(membership.role, capability)) {
    throw new InsufficientRoleError(
      `Your role in this household (${membership.role}) cannot ${CAPABILITY_LABELS[capability]}`,
    );
  }
  return membership;
}

/**
 * (d) — the entity must belong to the household the caller was authorised for.
 *
 * Without this, a member of household A could pass household A's id (passing
 * b and c) together with an expense id from household B.
 *
 * Reports "not found" for a cross-household id as well as a missing one, so the
 * existence of other households' records cannot be probed.
 */
export function assertBelongsToHousehold<T extends { householdId: string }>(
  entity: T | null | undefined,
  householdId: string,
): T {
  if (!entity || entity.householdId !== householdId) {
    throw new WrongHouseholdError();
  }
  return entity;
}

/**
 * §8 / §9 — a user may only transition their OWN split, and only the recipient
 * of a payment may confirm it. Role alone is not enough for these.
 */
export function assertIsSelf(
  actorUserId: string,
  subjectUserId: string,
  what: string,
): void {
  if (actorUserId !== subjectUserId) {
    throw new InsufficientRoleError(`Only ${what} can do that`);
  }
}

/**
 * §8a — the same check as `assertIsSelf`, widened to let a placeholder's manager
 * act for it.
 *
 * Used wherever §8/§9 require "the person themselves": a tracked member has no
 * account, so somebody has to accept and confirm on their behalf. The subject is
 * loaded here rather than taken from the caller, so an action cannot pass in a
 * flattering description of who it is acting for.
 */
export async function requireCanActFor(
  actorUserId: string,
  subjectUserId: string,
  what: string,
): Promise<void> {
  if (actorUserId === subjectUserId) {
    return;
  }

  const subject = await prisma.user.findUnique({
    where: { id: subjectUserId },
    select: { id: true, isPlaceholder: true, managedByUserId: true },
  });

  if (!subject || !canActFor(actorUserId, subject)) {
    throw new InsufficientRoleError(`Only ${what} can do that`);
  }
}
