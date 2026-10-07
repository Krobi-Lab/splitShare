/**
 * Input contracts for the expense actions that need more than §6 provides.
 */

import { z } from "zod";

import { respondToSplitSchema } from "@/lib/expenses/schema";

/**
 * §8 + §8a — accepting or rejecting a share, optionally on behalf of a
 * placeholder you manage. Omitting `onBehalfOfUserId` means your own share.
 */
export const respondOnBehalfSchema = respondToSplitSchema.extend({
  onBehalfOfUserId: z.uuid().optional(),
});

export const lockExpenseSchema = z.object({
  householdId: z.uuid(),
  expenseId: z.uuid(),
});
