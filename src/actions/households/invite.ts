"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, toActionResult, type ActionResult } from "@/lib/actions/result";
import { writeAuditLog } from "@/lib/audit/write";
import { requireAuth, requireCapability } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { sendInvitationEmail } from "@/lib/email/send";
import {
  buildInvitationUrl,
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiresAt,
} from "@/lib/invitations/token";
import { consumeRateLimit } from "@/lib/rate-limit";

import { inviteMemberSchema, revokeInvitationSchema } from "./schema";

/**
 * Invites someone by email (§5 ADMIN only, §21 rate limited).
 *
 * The emailed token is generated here and never stored — only its SHA-256 goes
 * into the row — so a leak of the `invitations` table cannot be used to join.
 * The email is sent after the transaction commits, deliberately: a provider
 * outage must not roll back a successfully created invitation, which an admin
 * can always resend.
 */
export async function inviteMember(
  input: unknown,
): Promise<ActionResult<{ invitationId: string }>> {
  try {
    const data = inviteMemberSchema.parse(input);
    const membership = await requireCapability(data.householdId, "MANAGE_MEMBERS");
    // Cached by the guard chain, so this costs no extra query.
    const inviter = await requireAuth();
    consumeRateLimit("INVITE_MEMBER", membership.userId);

    // Already a member? Inviting again would be confusing rather than harmful.
    const existing = await prisma.householdMember.findFirst({
      where: {
        householdId: data.householdId,
        removedAt: null,
        user: { email: data.email },
      },
      select: { id: true },
    });
    if (existing) {
      return fail("CONFLICT", "That person is already a member of this household.");
    }

    const token = generateInvitationToken();
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // Supersede any outstanding invitation to the same address, so an admin
      // re-inviting does not leave two live tokens for one seat.
      await tx.invitation.updateMany({
        where: { householdId: data.householdId, email: data.email, status: "PENDING" },
        data: { status: "REVOKED", revokedAt: now },
      });

      const invitation = await tx.invitation.create({
        data: {
          householdId: data.householdId,
          email: data.email,
          role: data.role,
          tokenHash: hashInvitationToken(token),
          invitedByUserId: membership.userId,
          expiresAt: invitationExpiresAt(now),
        },
        select: { id: true, email: true, role: true, expiresAt: true },
      });

      await writeAuditLog(tx, {
        householdId: data.householdId,
        actorUserId: membership.userId,
        action: "MEMBER_INVITED",
        entityType: "invitation",
        entityId: invitation.id,
        // The token hash is deliberately not recorded here.
        after: { email: invitation.email, role: invitation.role },
      });

      const household = await tx.household.findUniqueOrThrow({
        where: { id: data.householdId },
        select: { name: true },
      });

      return { invitation, householdName: household.name };
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    await sendInvitationEmail(
      { email: data.email },
      {
        householdName: result.householdName,
        inviterName: inviter.name ?? inviter.email ?? "An admin",
        acceptUrl: buildInvitationUrl(appUrl, token),
        expiresAt: result.invitation.expiresAt,
      },
    );

    revalidatePath(`/households/${data.householdId}/members`);
    return ok({ invitationId: result.invitation.id });
  } catch (error) {
    return toActionResult(error);
  }
}

/** §5 ADMIN only. Revoking is a status change, not a delete — §11 keeps the trail. */
export async function revokeInvitation(input: unknown): Promise<ActionResult<null>> {
  try {
    const data = revokeInvitationSchema.parse(input);
    const membership = await requireCapability(data.householdId, "MANAGE_MEMBERS");

    const invitation = await prisma.invitation.findUnique({
      where: { id: data.invitationId },
      select: { id: true, householdId: true, status: true, email: true },
    });

    // §2.4(d) — reports "not found" for another household's id as well as a
    // missing one, so other households cannot be probed.
    if (!invitation || invitation.householdId !== data.householdId) {
      return fail("WRONG_HOUSEHOLD", "Not found");
    }
    if (invitation.status !== "PENDING") {
      return fail("CONFLICT", "That invitation is no longer pending.");
    }

    await prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
      await writeAuditLog(tx, {
        householdId: data.householdId,
        actorUserId: membership.userId,
        action: "INVITATION_REVOKED",
        entityType: "invitation",
        entityId: invitation.id,
        before: { status: invitation.status, email: invitation.email },
        after: { status: "REVOKED" },
      });
    });

    revalidatePath(`/households/${data.householdId}/members`);
    return ok(null);
  } catch (error) {
    return toActionResult(error);
  }
}
