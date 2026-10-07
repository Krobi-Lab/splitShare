import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createExpenseSchema,
  currencySchema,
  recordPaymentSchema,
  respondToSplitSchema,
  reverseExpenseSchema,
} from "@/lib/expenses/schema";

const ANN = "00000000-0000-4000-8000-000000000001";
const BOB = "00000000-0000-4000-8000-000000000002";
const HOUSEHOLD = "00000000-0000-4000-8000-0000000000aa";

function validExpense(overrides: Record<string, unknown> = {}) {
  return {
    householdId: HOUSEHOLD,
    paidByUserId: ANN,
    categoryId: null,
    description: "Groceries",
    amountCents: 9000,
    currency: "NZD",
    date: new Date("2026-10-07T00:00:00.000Z"),
    splitMethod: "EQUAL",
    participants: [{ userId: ANN }, { userId: BOB }],
    ...overrides,
  };
}

/** The field path of the first issue, for asserting form-level error placement. */
function firstIssuePath(result: z.ZodSafeParseResult<unknown>): string {
  return result.error!.issues[0].path.join(".");
}

describe("currencySchema", () => {
  it("normalises to upper case", () => {
    expect(currencySchema.parse("nzd")).toBe("NZD");
    expect(currencySchema.parse("  usd  ")).toBe("USD");
  });

  it("rejects anything that is not three letters", () => {
    for (const bad of ["NZ", "NZDD", "N1D", ""]) {
      expect(currencySchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("§6 createExpenseSchema", () => {
  it("accepts the §40 acceptance-scenario expense", () => {
    const result = createExpenseSchema.safeParse(validExpense());
    expect(result.success).toBe(true);
    expect(result.data?.description).toBe("Groceries");
  });

  it("trims the description and rejects an empty one", () => {
    expect(
      createExpenseSchema.parse(validExpense({ description: "  Rent  " })).description,
    ).toBe("Rent");
    expect(
      createExpenseSchema.safeParse(validExpense({ description: "   " })).success,
    ).toBe(false);
  });

  it("caps the description at 200 and notes at 2000 characters", () => {
    expect(
      createExpenseSchema.safeParse(validExpense({ description: "x".repeat(201) }))
        .success,
    ).toBe(false);
    expect(
      createExpenseSchema.safeParse(validExpense({ notes: "x".repeat(2001) })).success,
    ).toBe(false);
    expect(
      createExpenseSchema.safeParse(validExpense({ notes: "x".repeat(2000) })).success,
    ).toBe(true);
  });

  it("rejects a zero amount but accepts a negative one, for reversals", () => {
    expect(createExpenseSchema.safeParse(validExpense({ amountCents: 0 })).success).toBe(
      false,
    );
    expect(
      createExpenseSchema.safeParse(validExpense({ amountCents: -9000 })).success,
    ).toBe(true);
  });

  it("rejects fractional cents — money is never a float (§2.1)", () => {
    const result = createExpenseSchema.safeParse(validExpense({ amountCents: 90.5 }));
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe("amountCents");
  });

  it("rejects an amount beyond safe integers", () => {
    expect(
      createExpenseSchema.safeParse(
        validExpense({ amountCents: Number.MAX_SAFE_INTEGER + 2 }),
      ).success,
    ).toBe(false);
  });

  it("requires at least one participant", () => {
    expect(
      createExpenseSchema.safeParse(validExpense({ participants: [] })).success,
    ).toBe(false);
  });

  it("flags a repeated participant against that row", () => {
    const result = createExpenseSchema.safeParse(
      validExpense({ participants: [{ userId: ANN }, { userId: ANN }] }),
    );
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe("participants.1.userId");
  });

  it("rejects ids that are not uuids", () => {
    expect(
      createExpenseSchema.safeParse(validExpense({ householdId: "nope" })).success,
    ).toBe(false);
    expect(
      createExpenseSchema.safeParse(validExpense({ participants: [{ userId: "nope" }] }))
        .success,
    ).toBe(false);
  });

  describe("per-method required fields", () => {
    it("requires an amount from every participant in EXACT mode", () => {
      const result = createExpenseSchema.safeParse(
        validExpense({
          splitMethod: "EXACT",
          participants: [{ userId: ANN, amountCents: 9000 }, { userId: BOB }],
        }),
      );
      expect(result.success).toBe(false);
      expect(firstIssuePath(result)).toBe("participants.1.amountCents");
    });

    it("allows a zero amount in EXACT mode — owing nothing is legitimate", () => {
      expect(
        createExpenseSchema.safeParse(
          validExpense({
            splitMethod: "EXACT",
            participants: [
              { userId: ANN, amountCents: 9000 },
              { userId: BOB, amountCents: 0 },
            ],
          }),
        ).success,
      ).toBe(true);
    });

    it("requires a percentage from every participant in PERCENTAGE mode", () => {
      const result = createExpenseSchema.safeParse(
        validExpense({
          splitMethod: "PERCENTAGE",
          participants: [{ userId: ANN, percentBps: 10_000 }, { userId: BOB }],
        }),
      );
      expect(result.success).toBe(false);
      expect(firstIssuePath(result)).toBe("participants.1.percentBps");
    });

    it("rejects a percentage over 100% or at zero", () => {
      for (const percentBps of [0, 10_001, -1]) {
        expect(
          createExpenseSchema.safeParse(
            validExpense({
              splitMethod: "PERCENTAGE",
              participants: [{ userId: ANN, percentBps }],
            }),
          ).success,
          String(percentBps),
        ).toBe(false);
      }
    });

    it("requires shares from every participant in SHARES mode", () => {
      const result = createExpenseSchema.safeParse(
        validExpense({
          splitMethod: "SHARES",
          participants: [{ userId: ANN, shares: 2 }, { userId: BOB }],
        }),
      );
      expect(result.success).toBe(false);
      expect(firstIssuePath(result)).toBe("participants.1.shares");
    });

    it("rejects non-positive or fractional shares", () => {
      for (const shares of [0, -1, 1.5]) {
        expect(
          createExpenseSchema.safeParse(
            validExpense({
              splitMethod: "SHARES",
              participants: [{ userId: ANN, shares }],
            }),
          ).success,
          String(shares),
        ).toBe(false);
      }
    });

    it("ignores the per-method fields that do not apply", () => {
      // EQUAL ignores a stray percentBps rather than rejecting the whole form.
      expect(
        createExpenseSchema.safeParse(
          validExpense({ participants: [{ userId: ANN, percentBps: 5000 }] }),
        ).success,
      ).toBe(true);
    });
  });

  it("flags an EXACT amount whose sign opposes the total", () => {
    const result = createExpenseSchema.safeParse(
      validExpense({
        splitMethod: "EXACT",
        amountCents: -9000,
        participants: [
          { userId: ANN, amountCents: -9500 },
          { userId: BOB, amountCents: 500 },
        ],
      }),
    );
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe("participants.1.amountCents");
  });

  it("leaves split arithmetic to the engine, not the schema", () => {
    // 1000 + 1000 != 9000, but that is the engine's EXACT_SUM_MISMATCH to
    // report (§2.5); the schema only checks shape.
    expect(
      createExpenseSchema.safeParse(
        validExpense({
          splitMethod: "EXACT",
          participants: [
            { userId: ANN, amountCents: 1000 },
            { userId: BOB, amountCents: 1000 },
          ],
        }),
      ).success,
    ).toBe(true);
  });
});

describe("§8 respondToSplitSchema", () => {
  it("accepts a decision either way", () => {
    for (const decision of ["ACCEPTED", "REJECTED"]) {
      expect(
        respondToSplitSchema.safeParse({
          householdId: HOUSEHOLD,
          expenseId: ANN,
          decision,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects PENDING — a user decides, they do not un-decide", () => {
    expect(
      respondToSplitSchema.safeParse({
        householdId: HOUSEHOLD,
        expenseId: ANN,
        decision: "PENDING",
      }).success,
    ).toBe(false);
  });
});

describe("§9 recordPaymentSchema", () => {
  it("accepts a payment and defaults the method", () => {
    const result = recordPaymentSchema.safeParse({
      householdId: HOUSEHOLD,
      toUserId: ANN,
      amountCents: 4500,
      currency: "nzd",
    });
    expect(result.success).toBe(true);
    expect(result.data?.method).toBe("OTHER");
    expect(result.data?.currency).toBe("NZD");
  });

  it("rejects a zero or negative payment — a reversal is a separate action", () => {
    for (const amountCents of [0, -4500]) {
      expect(
        recordPaymentSchema.safeParse({
          householdId: HOUSEHOLD,
          toUserId: ANN,
          amountCents,
          currency: "NZD",
        }).success,
        String(amountCents),
      ).toBe(false);
    }
  });
});

describe("§7 reverseExpenseSchema", () => {
  it("requires a reason", () => {
    expect(
      reverseExpenseSchema.safeParse({
        householdId: HOUSEHOLD,
        expenseId: ANN,
        reason: "",
      }).success,
    ).toBe(false);
    expect(
      reverseExpenseSchema.safeParse({
        householdId: HOUSEHOLD,
        expenseId: ANN,
        reason: "Wrong amount",
      }).success,
    ).toBe(true);
  });
});
