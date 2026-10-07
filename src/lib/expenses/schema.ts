/**
 * The §6 expense-creation input contract, as Zod 4 schemas.
 *
 * This validates SHAPE. It deliberately does not validate split arithmetic:
 * `@/lib/splits/engine` owns that (§2.5) and produces better messages, and
 * duplicating the rules would let the two drift. The division of labour is:
 *
 *   schema  — is each field the right type, in range, and internally consistent
 *   engine  — do the numbers add up, and what is each person's exact share
 *   action  — does this user have the right, and do these ids belong together
 */

import { z } from "zod";

/** ISO 4217: three letters, stored upper case. */
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, { error: "Currency must be a 3-letter ISO 4217 code" });

/**
 * Integer cents. `z.number().int()` already rejects unsafe integers in Zod 4
 * (its format is "safeint"), which is the same bound `assertCents` enforces.
 */
export const centsSchema = z
  .number()
  .int({ error: "Amount must be a whole number of cents" });

export const splitMethodSchema = z.enum(["EQUAL", "EXACT", "PERCENTAGE", "SHARES"]);

export const participantSchema = z.object({
  userId: z.uuid(),
  /** EXACT only. May be 0 — a participant can legitimately owe nothing. */
  amountCents: centsSchema.optional(),
  /** PERCENTAGE only. Basis points; 10000 = 100%. */
  percentBps: z
    .number()
    .int()
    .positive({ error: "Percentage must be greater than zero" })
    .max(10_000, { error: "Percentage cannot exceed 100%" })
    .optional(),
  /** SHARES only. */
  shares: z
    .number()
    .int()
    .positive({ error: "Shares must be a positive whole number" })
    .max(1_000_000)
    .optional(),
});

export type ParticipantInput = z.infer<typeof participantSchema>;

const baseCreateExpenseSchema = z.object({
  householdId: z.uuid(),
  paidByUserId: z.uuid(),
  categoryId: z.uuid().nullable(),
  description: z
    .string()
    .trim()
    .min(1, { error: "Give the expense a description" })
    .max(200, { error: "Description cannot exceed 200 characters" }),
  amountCents: centsSchema.refine((cents) => cents !== 0, {
    error: "Amount cannot be zero",
  }),
  currency: currencySchema,
  date: z.date({ error: "Give the expense a date" }),
  notes: z.string().trim().max(2000).optional(),
  receiptFileId: z.uuid().optional(),
  splitMethod: splitMethodSchema,
  participants: z
    .array(participantSchema)
    .min(1, { error: "An expense needs at least one participant" })
    .max(50),
});

/**
 * Cross-field rules.
 *
 * Each issue is attached to the exact path that caused it, so the form can show
 * it against the right row rather than as a banner.
 */
export const createExpenseSchema = baseCreateExpenseSchema.superRefine((value, ctx) => {
  const seen = new Set<string>();
  value.participants.forEach((participant, index) => {
    if (seen.has(participant.userId)) {
      ctx.addIssue({
        code: "custom",
        path: ["participants", index, "userId"],
        message: "This person is already a participant",
      });
    }
    seen.add(participant.userId);
  });

  // The per-method field each participant must carry. The engine re-checks
  // these; doing it here is what turns a thrown error into a field-level one.
  value.participants.forEach((participant, index) => {
    if (value.splitMethod === "EXACT" && participant.amountCents === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["participants", index, "amountCents"],
        message: "Enter an amount for this person",
      });
    }
    if (value.splitMethod === "PERCENTAGE" && participant.percentBps === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["participants", index, "percentBps"],
        message: "Enter a percentage for this person",
      });
    }
    if (value.splitMethod === "SHARES" && participant.shares === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["participants", index, "shares"],
        message: "Enter a share count for this person",
      });
    }
  });

  // A reversal must be negative throughout, so EXACT amounts cannot mix signs
  // with the total. The engine proves the sum; this catches the obvious case
  // early with a clearer message.
  if (value.splitMethod === "EXACT") {
    const wrongSign = value.participants.findIndex(
      (participant) =>
        participant.amountCents !== undefined &&
        participant.amountCents !== 0 &&
        Math.sign(participant.amountCents) !== Math.sign(value.amountCents),
    );
    if (wrongSign >= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["participants", wrongSign, "amountCents"],
        message: "This amount has the opposite sign to the expense total",
      });
    }
  }
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

/** §8 — a user may only transition their own split. */
export const respondToSplitSchema = z.object({
  householdId: z.uuid(),
  expenseId: z.uuid(),
  decision: z.enum(["ACCEPTED", "REJECTED"]),
  rejectionReason: z.string().trim().max(500).optional(),
});

export type RespondToSplitInput = z.infer<typeof respondToSplitSchema>;

/** §9 — the payer records; only the recipient may confirm. */
export const recordPaymentSchema = z.object({
  householdId: z.uuid(),
  toUserId: z.uuid(),
  amountCents: centsSchema.positive({ error: "A payment must be greater than zero" }),
  currency: currencySchema,
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]).default("OTHER"),
  expenseSplitId: z.uuid().optional(),
  reference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const confirmPaymentSchema = z.object({
  householdId: z.uuid(),
  paymentId: z.uuid(),
});

/** §7 — a correction is a new expense pointing at the one it reverses. */
export const reverseExpenseSchema = z.object({
  householdId: z.uuid(),
  expenseId: z.uuid(),
  reason: z.string().trim().min(1, { error: "Say why this is being reversed" }).max(500),
});
