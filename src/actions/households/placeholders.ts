"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { fail, ok, toActionResult, type ActionResult } from "@/lib/actions/result";
import { writeAuditLog } from "@/lib/audit/write";
import { requireCapability } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { placeholderEmail } from "@/lib/households/placeholders";

import { addPlaceholderMemberSchema, renamePlaceholderSchema } from "./schema";

/**
 * Adds a member who has no account of their own (§8a).
 *
 * This is the flatmate who will never sign up but still owes for the groceries.
 * Their splits are written ACCEPTED, because there is nobody to accept them, and
 * the caller becomes their manager — the one person who may act on their behalf
 * for §8 acceptance and §9 payment confirmation.
 *
 * Requires MANAGE_MEMBERS, same as a real invitation: adding a participant
 * changes who household money can be apportioned to.
 *
 * The role is MEMBER, never ADMIN. A placeholder cannot sign in, so granting it
 * admin rights would create authority nobody can exercise — and if the account
 * model ever changed, a dormant admin.
 */
export async function addPlaceholderMember(
  input: unknown,
): Promise<ActionResult<{ userId: string }>> {
  try {
    const data = addPlaceholderMemberSchema.parse(input);
    const membership = await requireCapability(data.householdId, "MANAGE_MEMBERS");

    // Two members called "Bob" in one household is a support problem, not a
    // data-integrity one, so this is a friendly check rather than a constraint.
    const clash = await prisma.householdMember.findFirst({
      where: {
        householdId: data.householdId,
        removedAt: null,
        user: { name: data.name },
      },
      select: { id: true },
    });
    if (clash) {
      return fail(
        "CONFLICT",
        `Somebody in this household is already called ${data.name}.`,
      );
    }

    const userId = randomUUID();

    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          name: data.name,
          // Synthetic, under the reserved .invalid TLD, so it can never be
          // verified by a provider and never become a way to sign in.
          email: placeholderEmail(userId),
          isPlaceholder: true,
          managedByUserId: membership.userId,
        },
      });

      await tx.householdMember.create({
        data: { householdId: data.householdId, userId, role: "MEMBER" },
      });

      await writeAuditLog(tx, {
        householdId: data.householdId,
        actorUserId: membership.userId,
        action: "MEMBER_INVITED",
        entityType: "household_member",
        entityId: userId,
        after: {
          name: data.name,
          isPlaceholder: true,
          managedByUserId: membership.userId,
        },
      });
    });

    revalidatePath(`/households/${data.householdId}/members`);
    return ok({ userId });
  } catch (error) {
    return toActionResult(error);
  }
}

/** Renames a placeholder. Real accounts own their own name, so they are refused. */
export async function renamePlaceholder(input: unknown): Promise<ActionResult<null>> {
  try {
    const data = renamePlaceholderSchema.parse(input);
    const membership = await requireCapability(data.householdId, "MANAGE_MEMBERS");

    const member = await prisma.householdMember.findUnique({
      where: {
        householdId_userId: { householdId: data.householdId, userId: data.userId },
      },
      select: {
        removedAt: true,
        user: { select: { id: true, name: true, isPlaceholder: true } },
      },
    });

    // §2.4(d) — "not found" also covers another household's member id.
    if (!member || member.removedAt !== null) {
      return fail("WRONG_HOUSEHOLD", "Not found");
    }
    if (!member.user.isPlaceholder) {
      return fail(
        "INSUFFICIENT_ROLE",
        "That member has their own account and sets their own name.",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: data.userId }, data: { name: data.name } });
      await writeAuditLog(tx, {
        householdId: data.householdId,
        actorUserId: membership.userId,
        action: "ROLE_CHANGED",
        entityType: "household_member",
        entityId: data.userId,
        before: { name: member.user.name },
        after: { name: data.name },
      });
    });

    revalidatePath(`/households/${data.householdId}/members`);
    return ok(null);
  } catch (error) {
    return toActionResult(error);
  }
}
