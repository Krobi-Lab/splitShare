import { describe, expect, it } from "vitest";

import {
  minimizeTransfers,
  SettlementError,
  type NetPosition,
} from "@/lib/settlements/minimize";

const ANN = "ann";
const BOB = "bob";
const CAL = "cal";

describe("minimizeTransfers — the §12 worked example", () => {
  // Household of 3, all splits equal and accepted.
  // Ann pays 9000 (3000 each), Bob pays 6000 (2000 each), Cal pays 0.
  const positions: NetPosition[] = [
    { userId: ANN, netCents: 4000 },
    { userId: BOB, netCents: 1000 },
    { userId: CAL, netCents: -5000 },
  ];

  it("produces exactly the transfers the spec names", () => {
    expect(minimizeTransfers(positions)).toEqual([
      { fromUserId: CAL, toUserId: ANN, amountCents: 4000 },
      { fromUserId: CAL, toUserId: BOB, amountCents: 1000 },
    ]);
  });

  it("zeroes every position out", () => {
    const settled = new Map(positions.map((p) => [p.userId, p.netCents]));
    for (const transfer of minimizeTransfers(positions)) {
      settled.set(transfer.fromUserId, settled.get(transfer.fromUserId)! + transfer.amountCents);
      settled.set(transfer.toUserId, settled.get(transfer.toUserId)! - transfer.amountCents);
    }
    expect([...settled.values()]).toEqual([0, 0, 0]);
  });
});

describe("minimizeTransfers", () => {
  it("returns nothing when everyone is settled", () => {
    expect(
      minimizeTransfers([
        { userId: ANN, netCents: 0 },
        { userId: BOB, netCents: 0 },
      ]),
    ).toEqual([]);
  });

  it("returns nothing for an empty household", () => {
    expect(minimizeTransfers([])).toEqual([]);
  });

  it("handles a simple two-person debt", () => {
    expect(
      minimizeTransfers([
        { userId: ANN, netCents: 4500 },
        { userId: BOB, netCents: -4500 },
      ]),
    ).toEqual([{ fromUserId: BOB, toUserId: ANN, amountCents: 4500 }]);
  });

  it("splits one debtor across several creditors, largest first", () => {
    expect(
      minimizeTransfers([
        { userId: ANN, netCents: 100 },
        { userId: BOB, netCents: 900 },
        { userId: CAL, netCents: -1000 },
      ]),
    ).toEqual([
      { fromUserId: CAL, toUserId: BOB, amountCents: 900 },
      { fromUserId: CAL, toUserId: ANN, amountCents: 100 },
    ]);
  });

  it("breaks ties on equal amounts by userId", () => {
    expect(
      minimizeTransfers([
        { userId: BOB, netCents: 500 },
        { userId: ANN, netCents: 500 },
        { userId: CAL, netCents: -1000 },
      ]),
    ).toEqual([
      { fromUserId: CAL, toUserId: ANN, amountCents: 500 },
      { fromUserId: CAL, toUserId: BOB, amountCents: 500 },
    ]);
  });

  it("breaks ties the same way regardless of input order", () => {
    // Same balances as above, creditors listed the other way round: the
    // comparator must still put Ann first.
    expect(
      minimizeTransfers([
        { userId: ANN, netCents: 500 },
        { userId: BOB, netCents: 500 },
        { userId: CAL, netCents: -1000 },
      ]),
    ).toEqual([
      { fromUserId: CAL, toUserId: ANN, amountCents: 500 },
      { fromUserId: CAL, toUserId: BOB, amountCents: 500 },
    ]);
  });

  it("never needs more than n-1 transfers", () => {
    const positions: NetPosition[] = [
      { userId: "a", netCents: -700 },
      { userId: "b", netCents: 300 },
      { userId: "c", netCents: -200 },
      { userId: "d", netCents: 450 },
      { userId: "e", netCents: 150 },
    ];
    const transfers = minimizeTransfers(positions);
    expect(transfers.length).toBeLessThanOrEqual(positions.length - 1);
    expect(transfers.reduce((sum, t) => sum + t.amountCents, 0)).toBe(900);
  });

  it("rejects balances that do not sum to zero", () => {
    expect(() =>
      minimizeTransfers([
        { userId: ANN, netCents: 4000 },
        { userId: BOB, netCents: -3000 },
      ]),
    ).toThrow(SettlementError);
  });

  it("rejects a fractional balance", () => {
    expect(() => minimizeTransfers([{ userId: ANN, netCents: 0.5 }])).toThrow(/integer cents/);
  });
});
