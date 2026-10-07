/**
 * Settling up: turning net balances into transfers (§12).
 *
 * Pure and dependency-free, like the split engine. Input is the derived net
 * position per member (positive = the household owes them); output is the list
 * of payments that would zero everyone out.
 */

import { assertCents, sumCents } from "@/lib/money";

export interface NetPosition {
  userId: string;
  /** Positive => owed to them. Negative => they owe. Must sum to 0 (§12). */
  netCents: number;
}

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

export class SettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementError";
  }
}

/** (amount desc, userId asc) — the same deterministic ordering as §2.6. */
function byAmountThenUser(
  a: { amountCents: number; userId: string },
  b: { amountCents: number; userId: string },
): number {
  return b.amountCents - a.amountCents || (a.userId < b.userId ? -1 : 1);
}

/**
 * Greedily matches the largest debtor against the largest creditor.
 *
 * This yields at most n-1 transfers, which is the practical meaning of
 * "minimal" here: finding the true minimum-cardinality set is NP-hard
 * (it subsumes partition), and a household settling up wants a short, stable,
 * explainable list rather than an optimal one. The ordering above makes the
 * output deterministic, so the same balances always produce the same plan.
 *
 * @throws SettlementError if the positions do not sum to zero, which would mean
 * the §12 invariant has been violated upstream.
 */
export function minimizeTransfers(positions: readonly NetPosition[]): Transfer[] {
  const total = sumCents(
    positions.map((position) => assertCents(position.netCents, "net balance")),
    "net balance",
  );
  if (total !== 0) {
    throw new SettlementError(
      `Net balances must sum to 0 (§12), but they sum to ${total}`,
    );
  }

  const creditors = positions
    .filter((position) => position.netCents > 0)
    .map((position) => ({ userId: position.userId, amountCents: position.netCents }))
    .sort(byAmountThenUser);

  const debtors = positions
    .filter((position) => position.netCents < 0)
    .map((position) => ({ userId: position.userId, amountCents: -position.netCents }))
    .sort(byAmountThenUser);

  const transfers: Transfer[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amountCents = Math.min(creditor.amountCents, debtor.amountCents);

    transfers.push({
      fromUserId: debtor.userId,
      toUserId: creditor.userId,
      amountCents,
    });

    creditor.amountCents -= amountCents;
    debtor.amountCents -= amountCents;
    if (creditor.amountCents === 0) {
      creditorIndex += 1;
    }
    if (debtor.amountCents === 0) {
      debtorIndex += 1;
    }
  }

  return transfers;
}
