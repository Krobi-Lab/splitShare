import { describe, expect, it } from "vitest";

import {
  computeSplits,
  SplitError,
  type ComputeSplitsInput,
  type SplitMethod,
} from "@/lib/splits/engine";

/** Amounts in input order — what callers actually persist. */
function amounts(input: ComputeSplitsInput): number[] {
  return computeSplits(input).map((split) => split.amountCents);
}

function expectSplitError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SplitError);
    expect((error as SplitError).code).toBe(code);
    return;
  }
  throw new Error(`expected a SplitError with code ${code}, but nothing was thrown`);
}

const ann = "a-ann";
const bob = "b-bob";
const cal = "c-cal";

describe("computeSplits — the sum invariant", () => {
  const cases: ComputeSplitsInput[] = [
    {
      method: "EQUAL",
      totalCents: 9000,
      participants: [{ userId: ann }, { userId: bob }],
    },
    {
      method: "EQUAL",
      totalCents: 10_000,
      participants: [{ userId: ann }, { userId: bob }, { userId: cal }],
    },
    {
      method: "EXACT",
      totalCents: 5000,
      participants: [
        { userId: ann, amountCents: 1234 },
        { userId: bob, amountCents: 3766 },
      ],
    },
    {
      method: "PERCENTAGE",
      totalCents: 9999,
      participants: [
        { userId: ann, percentBps: 3333 },
        { userId: bob, percentBps: 3333 },
        { userId: cal, percentBps: 3334 },
      ],
    },
    {
      method: "SHARES",
      totalCents: 7777,
      participants: [
        { userId: ann, shares: 1 },
        { userId: bob, shares: 2 },
        { userId: cal, shares: 4 },
      ],
    },
  ];

  it.each(cases)("$method over $totalCents sums exactly to the total", (input) => {
    const total = amounts(input).reduce((sum, cents) => sum + cents, 0);
    expect(total).toBe(input.totalCents);
  });

  it("holds for every total from 1..200 cents across 1..7 participants", () => {
    for (let people = 1; people <= 7; people += 1) {
      const participants = Array.from({ length: people }, (_, i) => ({
        userId: `user-${String(i).padStart(2, "0")}`,
      }));
      for (let totalCents = 1; totalCents <= 200; totalCents += 1) {
        const split = amounts({ method: "EQUAL", totalCents, participants });
        expect(split.reduce((sum, cents) => sum + cents, 0)).toBe(totalCents);
        // Nobody absorbs more than one leftover cent.
        expect(Math.max(...split) - Math.min(...split)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("computeSplits — EQUAL", () => {
  it("splits the §40 acceptance expense evenly", () => {
    expect(
      amounts({
        method: "EQUAL",
        totalCents: 9000,
        participants: [{ userId: ann }, { userId: bob }],
      }),
    ).toEqual([4500, 4500]);
  });

  it("gives leftover pennies out in userId order when amounts tie (§2.6)", () => {
    // 10000 / 3 = 3333 each, 1 cent left over -> lowest userId takes it.
    expect(
      amounts({
        method: "EQUAL",
        totalCents: 10_000,
        participants: [{ userId: cal }, { userId: ann }, { userId: bob }],
      }),
    ).toEqual([3333, 3334, 3333]);
  });

  it("hands out one cent each, never two, when the remainder is large", () => {
    // 10 / 4 = 2 each, remainder 2 -> the two lowest userIds get 1 cent each.
    expect(
      amounts({
        method: "EQUAL",
        totalCents: 10,
        participants: [
          { userId: ann },
          { userId: bob },
          { userId: cal },
          { userId: "d-dee" },
        ],
      }),
    ).toEqual([3, 3, 2, 2]);
  });

  it("allocates nothing to the tail when the total is smaller than the group", () => {
    expect(
      amounts({
        method: "EQUAL",
        totalCents: 1,
        participants: [{ userId: ann }, { userId: bob }],
      }),
    ).toEqual([1, 0]);
  });

  it("returns the whole total to a sole participant", () => {
    expect(
      amounts({ method: "EQUAL", totalCents: 4321, participants: [{ userId: ann }] }),
    ).toEqual([4321]);
  });

  it("reports no percentBps or shares for an EQUAL split", () => {
    expect(
      computeSplits({
        method: "EQUAL",
        totalCents: 100,
        participants: [{ userId: ann }],
      }),
    ).toEqual([{ userId: ann, amountCents: 100, percentBps: null, shares: null }]);
  });
});

describe("computeSplits — reversals (negative totals)", () => {
  it("negates the original split exactly, rather than re-rounding it", () => {
    const participants = [{ userId: cal }, { userId: ann }, { userId: bob }];
    const original = amounts({ method: "EQUAL", totalCents: 10_001, participants });
    const reversal = amounts({ method: "EQUAL", totalCents: -10_001, participants });
    expect(reversal).toEqual(original.map((cents) => -cents));
    expect(reversal.reduce((sum, cents) => sum + cents, 0)).toBe(-10_001);
  });

  it("negates a SHARES split exactly", () => {
    const participants = [
      { userId: ann, shares: 1 },
      { userId: bob, shares: 2 },
    ];
    const original = amounts({ method: "SHARES", totalCents: 1001, participants });
    expect(amounts({ method: "SHARES", totalCents: -1001, participants })).toEqual(
      original.map((cents) => -cents),
    );
  });

  it("negates a PERCENTAGE split exactly", () => {
    const participants = [
      { userId: ann, percentBps: 5000 },
      { userId: bob, percentBps: 5000 },
    ];
    const original = amounts({ method: "PERCENTAGE", totalCents: 333, participants });
    expect(amounts({ method: "PERCENTAGE", totalCents: -333, participants })).toEqual(
      original.map((cents) => -cents),
    );
  });

  it("accepts an EXACT reversal whose amounts already carry the sign", () => {
    expect(
      amounts({
        method: "EXACT",
        totalCents: -9000,
        participants: [
          { userId: ann, amountCents: -4500 },
          { userId: bob, amountCents: -4500 },
        ],
      }),
    ).toEqual([-4500, -4500]);
  });
});

describe("computeSplits — EXACT", () => {
  it("passes validated client amounts through untouched", () => {
    expect(
      computeSplits({
        method: "EXACT",
        totalCents: 3000,
        participants: [
          { userId: ann, amountCents: 1000 },
          { userId: bob, amountCents: 2000 },
        ],
      }),
    ).toEqual([
      { userId: ann, amountCents: 1000, percentBps: null, shares: null },
      { userId: bob, amountCents: 2000, percentBps: null, shares: null },
    ]);
  });

  it("allows a zero amount for one participant", () => {
    expect(
      amounts({
        method: "EXACT",
        totalCents: 3000,
        participants: [
          { userId: ann, amountCents: 3000 },
          { userId: bob, amountCents: 0 },
        ],
      }),
    ).toEqual([3000, 0]);
  });

  it("rejects a missing amount", () => {
    expectSplitError(
      () =>
        computeSplits({
          method: "EXACT",
          totalCents: 3000,
          participants: [{ userId: ann, amountCents: 3000 }, { userId: bob }],
        }),
      "MISSING_EXACT_AMOUNT",
    );
  });

  it("rejects a fractional amount", () => {
    expectSplitError(
      () =>
        computeSplits({
          method: "EXACT",
          totalCents: 3000,
          participants: [
            { userId: ann, amountCents: 1500.5 },
            { userId: bob, amountCents: 1499.5 },
          ],
        }),
      "MISSING_EXACT_AMOUNT",
    );
  });

  it("rejects amounts that do not sum to the total", () => {
    expectSplitError(
      () =>
        computeSplits({
          method: "EXACT",
          totalCents: 3000,
          participants: [
            { userId: ann, amountCents: 1000 },
            { userId: bob, amountCents: 1000 },
          ],
        }),
      "EXACT_SUM_MISMATCH",
    );
  });
});

describe("computeSplits — PERCENTAGE", () => {
  it("allocates by basis points and retains them", () => {
    expect(
      computeSplits({
        method: "PERCENTAGE",
        totalCents: 10_000,
        participants: [
          { userId: ann, percentBps: 2500 },
          { userId: bob, percentBps: 7500 },
        ],
      }),
    ).toEqual([
      { userId: ann, amountCents: 2500, percentBps: 2500, shares: null },
      { userId: bob, amountCents: 7500, percentBps: 7500, shares: null },
    ]);
  });

  it("gives the leftover cent to the larger share first (§2.6 amount desc)", () => {
    // 101 cents at 1/3 : 2/3 -> floors 33 and 67, remainder 1 -> larger wins.
    expect(
      amounts({
        method: "PERCENTAGE",
        totalCents: 101,
        participants: [
          { userId: ann, percentBps: 3333 },
          { userId: bob, percentBps: 6667 },
        ],
      }),
    ).toEqual([33, 68]);
  });

  it("rejects a missing percentage", () => {
    expectSplitError(
      () =>
        computeSplits({
          method: "PERCENTAGE",
          totalCents: 100,
          participants: [{ userId: ann, percentBps: 10_000 }, { userId: bob }],
        }),
      "MISSING_PERCENT",
    );
  });

  it("rejects a non-positive percentage", () => {
    expectSplitError(
      () =>
        computeSplits({
          method: "PERCENTAGE",
          totalCents: 100,
          participants: [
            { userId: ann, percentBps: 10_000 },
            { userId: bob, percentBps: 0 },
          ],
        }),
      "MISSING_PERCENT",
    );
  });

  it("rejects percentages that do not sum to 100%", () => {
    expectSplitError(
      () =>
        computeSplits({
          method: "PERCENTAGE",
          totalCents: 100,
          participants: [
            { userId: ann, percentBps: 5000 },
            { userId: bob, percentBps: 4000 },
          ],
        }),
      "PERCENT_SUM_MISMATCH",
    );
  });
});

describe("computeSplits — SHARES", () => {
  it("allocates proportionally and retains the share counts", () => {
    expect(
      computeSplits({
        method: "SHARES",
        totalCents: 6000,
        participants: [
          { userId: ann, shares: 1 },
          { userId: bob, shares: 2 },
        ],
      }),
    ).toEqual([
      { userId: ann, amountCents: 2000, percentBps: null, shares: 1 },
      { userId: bob, amountCents: 4000, percentBps: null, shares: 2 },
    ]);
  });

  it("gives the leftover cent to the larger share first", () => {
    // 100 at 1:2 -> floors 33, 66; remainder 1 -> the 2-share participant.
    expect(
      amounts({
        method: "SHARES",
        totalCents: 100,
        participants: [
          { userId: ann, shares: 1 },
          { userId: bob, shares: 2 },
        ],
      }),
    ).toEqual([33, 67]);
  });

  it("rejects missing shares", () => {
    expectSplitError(
      () =>
        computeSplits({
          method: "SHARES",
          totalCents: 100,
          participants: [{ userId: ann, shares: 1 }, { userId: bob }],
        }),
      "MISSING_SHARES",
    );
  });

  it("rejects non-positive shares", () => {
    expectSplitError(
      () =>
        computeSplits({
          method: "SHARES",
          totalCents: 100,
          participants: [
            { userId: ann, shares: 1 },
            { userId: bob, shares: -2 },
          ],
        }),
      "MISSING_SHARES",
    );
  });
});

describe("computeSplits — input guards", () => {
  it("rejects an empty participant list", () => {
    expectSplitError(
      () => computeSplits({ method: "EQUAL", totalCents: 100, participants: [] }),
      "NO_PARTICIPANTS",
    );
  });

  it("rejects a repeated participant", () => {
    expectSplitError(
      () =>
        computeSplits({
          method: "EQUAL",
          totalCents: 100,
          participants: [{ userId: ann }, { userId: ann }],
        }),
      "DUPLICATE_PARTICIPANT",
    );
  });

  it("rejects a zero total", () => {
    expectSplitError(
      () =>
        computeSplits({
          method: "EQUAL",
          totalCents: 0,
          participants: [{ userId: ann }],
        }),
      "INVALID_TOTAL",
    );
  });

  it("rejects a fractional total", () => {
    expectSplitError(
      () =>
        computeSplits({
          method: "EQUAL",
          totalCents: 10.5,
          participants: [{ userId: ann }],
        }),
      "INVALID_TOTAL",
    );
  });

  it("rejects a total beyond safe integers", () => {
    expectSplitError(
      () =>
        computeSplits({
          method: "EQUAL",
          totalCents: Number.MAX_SAFE_INTEGER + 2,
          participants: [{ userId: ann }],
        }),
      "INVALID_TOTAL",
    );
  });

  it("rejects a method that never passed validation", () => {
    expectSplitError(
      () =>
        computeSplits({
          method: "WEIGHTED_BY_VIBES" as SplitMethod,
          totalCents: 100,
          participants: [{ userId: ann }],
        }),
      "UNSUPPORTED_METHOD",
    );
  });
});
