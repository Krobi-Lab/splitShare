"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, toActionResult, type ActionResult } from "@/lib/actions/result";
import { writeAuditLog } from "@/lib/audit/write";
import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import {
  hashInvitationToken,
  rejectionReason,
  REJECTION_MESSAGES,
} from "@/lib/invitations/token";
import { createNotifications } from "@/lib/notifications/create";

import { acceptInvitationSchema } from "./schema";

/**
 * Accepts an invitation from an emailed link (§40 step 2).
 *
 * Lookup is by the token's hash, so the raw token never has to be stored or
 * compared. The invitation is NOT required to match the signed-in user's email:
 * people are invited at one address and sign in with another often enough that
 * refusing would be a support burden, and possession of the token is already
 * the proof of authorisation. The address it was sent to is recorded in the
 * audit trail, so the discrepancy is visible.
 *
 * Expiry is evaluated against the clock rather than trusted from the stored
 * status, since nothing sweeps PENDING rows into EXPIRED.
 */
export async function acceptInvitation(
  input: unknown,
): Promise<ActionResult<{ householdId: string }>> {
  try {
    const user = await requireAuth();
    const data = acceptInvitationSchema.parse(input);

    const invitation = await prisma.invitation.findUnique({
      where: { tokenHash: hashInvitationToken(data.token) },
      select: {
        id: true,
        householdId: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        household: { select: { name: true } },
      },
    });

    // An unknown token and a withdrawn one are reported the same way, so the
    // endpoint cannot be used to test whether a token ever existed.
    if (!invitation) {
      return fail("WRONG_HOUSEHOLD", "That invitation link is not valid.");
    }

    const now = new Date();
    const rejection = rejectionReason(invitation, now);
    if (rejection) {
      return fail("CONFLICT", REJECTION_MESSAGES[rejection]);
    }

    const existing = await prisma.householdMember.findUnique({
      where: {
        householdId_userId: { householdId: invitation.householdId, userId: user.id },
      },
      select: { id: true, removedAt: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: "ACCEPTED", acceptedAt: now, acceptedByUserId: user.id },
      });

      // A previously removed member rejoining reuses their row, so their
      // expense history stays attached to them.
      if (existing) {
        await tx.householdMember.update({
          where: { id: existing.id },
          data: { role: invitation.role, removedAt: null, joinedAt: now },
        });
      } else {
        await tx.householdMember.create({
          data: {
            householdId: invitation.householdId,
            userId: user.id,
            role: invitation.role,
          },
        });
      }

      await writeAuditLog(tx, {
        householdId: invitation.householdId,
        actorUserId: user.id,
        action: "INVITATION_ACCEPTED",
        entityType: "invitation",
        entityId: invitation.id,
        before: { status: invitation.status },
        after: {
          status: "ACCEPTED",
          role: invitation.role,
          invitedEmail: invitation.email,
          acceptedByEmail: user.email,
        },
      });

      // §17 — tell the existing members, in the same transaction.
      const others = await tx.householdMember.findMany({
        where: {
          householdId: invitation.householdId,
          removedAt: null,
          userId: { not: user.id },
        },
        select: { userId: true },
      });

      await createNotifications(tx, {
        householdId: invitation.householdId,
        context: {
          actorName: user.name ?? user.email ?? "A new member",
          householdName: invitation.household.name,
        },
        targets: others.map((member) => ({
          userId: member.userId,
          type: "MEMBER_JOINED" as const,
          entityType: "household",
          entityId: invitation.householdId,
        })),
      });
    });

    revalidatePath("/households");
    return ok({ householdId: invitation.householdId });
  } catch (error) {
    return toActionResult(error);
  }
}
