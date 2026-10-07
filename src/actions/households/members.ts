"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, toActionResult, type ActionResult } from "@/lib/actions/result";
import { writeAuditLog } from "@/lib/audit/write";
import { requireCapability } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";

import { changeRoleSchema, removeMemberSchema } from "./schema";

/**
 * Counts remaining admins, so a household can never be left without one.
 *
 * Both actions below depend on this: an admin who demotes or removes the last
 * admin would lock everyone out of settings, invitations and locking, with no
 * in-app way to recover.
 */
async function otherAdminExists(
  householdId: string,
  excludingUserId: string,
): Promise<boolean> {
  const count = await prisma.householdMember.count({
    where: {
      householdId,
      removedAt: null,
      role: "ADMIN",
      userId: { not: excludingUserId },
    },
  });
  return count > 0;
}

/**
 * Removes a member (§5 ADMIN only).
 *
 * This is a soft removal: `removed_at` is set and the row stays. Their expenses,
 * splits and payments are financial facts (§2.2) and must keep pointing at a
 * real membership, so deleting the row is not an option. The guard chain treats
 * a removed member as a non-member, so access ends immediately.
 */
export async function removeMember(input: unknown): Promise<ActionResult<null>> {
  try {
    const data = removeMemberSchema.parse(input);
    const membership = await requireCapability(data.householdId, "MANAGE_MEMBERS");

    const target = await prisma.householdMember.findUnique({
      where: {
        householdId_userId: { householdId: data.householdId, userId: data.userId },
      },
      select: { id: true, role: true, removedAt: true },
    });

    if (!target || target.removedAt !== null) {
      return fail("WRONG_HOUSEHOLD", "Not found");
    }
    if (
      target.role === "ADMIN" &&
      !(await otherAdminExists(data.householdId, data.userId))
    ) {
      return fail(
        "CONFLICT",
        "That is the only admin. Promote someone else before removing them.",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.householdMember.update({
        where: { id: target.id },
        data: { removedAt: new Date() },
      });
      await writeAuditLog(tx, {
        householdId: data.householdId,
        actorUserId: membership.userId,
        action: "MEMBER_REMOVED",
        entityType: "household_member",
        entityId: target.id,
        before: { userId: data.userId, role: target.role, removedAt: null },
        after: { userId: data.userId, removedAt: new Date().toISOString() },
      });
    });

    revalidatePath(`/households/${data.householdId}/members`);
    return ok(null);
  } catch (error) {
    return toActionResult(error);
  }
}

/** Changes a member's role (§5 ADMIN only). */
export async function changeRole(input: unknown): Promise<ActionResult<null>> {
  try {
    const data = changeRoleSchema.parse(input);
    const membership = await requireCapability(data.householdId, "MANAGE_MEMBERS");

    const target = await prisma.householdMember.findUnique({
      where: {
        householdId_userId: { householdId: data.householdId, userId: data.userId },
      },
      select: { id: true, role: true, removedAt: true },
    });

    if (!target || target.removedAt !== null) {
      return fail("WRONG_HOUSEHOLD", "Not found");
    }
    if (target.role === data.role) {
      return ok(null);
    }
    if (
      target.role === "ADMIN" &&
      data.role !== "ADMIN" &&
      !(await otherAdminExists(data.householdId, data.userId))
    ) {
      return fail(
        "CONFLICT",
        "That is the only admin. Promote someone else before changing this role.",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.householdMember.update({
        where: { id: target.id },
        data: { role: data.role },
      });
      await writeAuditLog(tx, {
        householdId: data.householdId,
        actorUserId: membership.userId,
        action: "ROLE_CHANGED",
        entityType: "household_member",
        entityId: target.id,
        before: { userId: data.userId, role: target.role },
        after: { userId: data.userId, role: data.role },
      });
    });

    revalidatePath(`/households/${data.householdId}/members`);
    return ok(null);
  } catch (error) {
    return toActionResult(error);
  }
}
