import "server-only";

import type { HouseholdRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/client";

import {
  hashInvitationToken,
  rejectionReason,
  REJECTION_MESSAGES,
  type InvitationRejection,
} from "./token";

/**
 * Reads an invitation for display, without accepting it.
 *
 * Deliberately requires no session: someone following an invite link may not
 * have an account yet, and they need to see what they are being invited to
 * before signing in. Possession of the token is the authorisation, and all this
 * discloses is the household name and role — which the email already said.
 */

export type InvitationPreview =
  | {
      state: "VALID";
      householdName: string;
      inviterName: string;
      role: HouseholdRole;
      email: string;
      expiresAt: Date;
    }
  | { state: "UNUSABLE"; reason: InvitationRejection; message: string }
  | { state: "NOT_FOUND" };

export async function previewInvitation(token: string): Promise<InvitationPreview> {
  if (token.trim() === "") {
    return { state: "NOT_FOUND" };
  }

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: {
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      household: { select: { name: true } },
      invitedBy: { select: { name: true, email: true } },
    },
  });

  if (!invitation) {
    return { state: "NOT_FOUND" };
  }

  const reason = rejectionReason(invitation, new Date());
  if (reason) {
    return { state: "UNUSABLE", reason, message: REJECTION_MESSAGES[reason] };
  }

  return {
    state: "VALID",
    householdName: invitation.household.name,
    inviterName: invitation.invitedBy.name ?? invitation.invitedBy.email,
    role: invitation.role,
    email: invitation.email,
    expiresAt: invitation.expiresAt,
  };
}
