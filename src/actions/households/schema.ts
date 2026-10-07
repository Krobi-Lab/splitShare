/**
 * Input contracts for the household actions (§5, §21).
 *
 * Shape only, same division of labour as the expense schemas: the action owns
 * authorization and cross-entity checks, the schema owns field validity.
 */

import { z } from "zod";

import { currencySchema } from "@/lib/expenses/schema";

export const roleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER"]);

export const createHouseholdSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "Give the household a name" })
    .max(100, { error: "Name cannot exceed 100 characters" }),
  currency: currencySchema,
});

export const inviteMemberSchema = z.object({
  householdId: z.uuid(),
  email: z.email({ error: "Enter a valid email address" }).trim().toLowerCase(),
  role: roleSchema.default("MEMBER"),
});

export const revokeInvitationSchema = z.object({
  householdId: z.uuid(),
  invitationId: z.uuid(),
});

export const acceptInvitationSchema = z.object({
  /** The raw token from the emailed link; only its hash is stored. */
  token: z.string().trim().min(1, { error: "That invitation link is incomplete" }),
});

export const removeMemberSchema = z.object({
  householdId: z.uuid(),
  userId: z.uuid(),
});

export const changeRoleSchema = z.object({
  householdId: z.uuid(),
  userId: z.uuid(),
  role: roleSchema,
});

export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/** §8a — adding a member who has no account of their own. */
export const addPlaceholderMemberSchema = z.object({
  householdId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1, { error: "Give them a name" })
    .max(60, { error: "Name cannot exceed 60 characters" }),
});

export const renamePlaceholderSchema = z.object({
  householdId: z.uuid(),
  userId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1, { error: "Give them a name" })
    .max(60, { error: "Name cannot exceed 60 characters" }),
});
