/**
 * The split engine (§2.5, §2.6).
 *
 * Pure and dependency-free: no database, no clock, no randomness. The server
 * recomputes every per-person amount here from Zod-validated input, so the
 * client's split UI can only ever be a suggestion.
 *
 * Two guarantees hold for every method:
 *   1. The returned amounts sum to EXACTLY `totalCents`.
 *   2. Leftover minor units are handed out deterministically (§2.6): sort by
 *      (amount desc, userId asc) and give 1 cent each until the sum matches.
 */

import { assertCents } from "@/lib/money";

export type SplitMethod = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

export type SplitErrorCode =
  | "NO_PARTICIPANTS"
  | "DUPLICATE_PARTICIPANT"
  | "INVALID_TOTAL"
  | "MISSING_EXACT_AMOUNT"
  | "EXACT_SUM_MISMATCH"
  | "MISSING_PERCENT"
  | "PERCENT_SUM_MISMATCH"
  | "MISSING_SHARES"
  | "UNSUPPORTED_METHOD";

/** Every rejection from this module is a `SplitError` with a stable code. */
export class SplitError extends Error {
  readonly code: SplitErrorCode;

  constructor(code: SplitErrorCode, message: string) {
    super(message);
    this.name = "SplitError";
    this.code = code;
  }
}

export interface SplitParticipantInput {
  userId: string;
  /** EXACT only. Ignored by every other method. */
  amountCents?: number;
  /** PERCENTAGE only. Basis points, 10000 = 100%. */
  percentBps?: number;
  /** SHARES only. Positive integer. */
  shares?: number;
}

export interface ComputeSplitsInput {
  method: SplitMethod;
  /** Integer cents, non-zero. Negative for a reversal expense (§7). */
  totalCents: number;
  participants: readonly SplitParticipantInput[];
}

export interface ComputedSplit {
  userId: string;
  amountCents: number;
  /** The retained input, so the split can be re-derived and audited. */
  percentBps: number | null;
  shares: number | null;
}

/**
 * Hands out `remainder` single cents over `base`, in (amount desc, userId asc)
 * order (§2.6).
 *
 * `remainder` is always strictly less than the participant count: each entry of
 * `base` is a floor that loses under one cent, so no participant can ever
 * receive more than one extra cent.
 */
function distributeRemainder(
  base: number[],
  userIds: readonly string[],
  remainder: number,
): void {
  if (remainder === 0) {
    return;
  }
  const order = base
    .map((amountCents, index) => ({ amountCents, index }))
    .sort(
      (a, b) =>
        b.amountCents - a.amountCents || (userIds[a.index] < userIds[b.index] ? -1 : 1),
    );
  for (let i = 0; i < remainder; i += 1) {
    base[order[i].index] += 1;
  }
}

/** Proportional allocation by integer weight, with §2.6 penny distribution. */
function allocateByWeight(
  magnitude: number,
  weights: readonly number[],
  userIds: readonly string[],
): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const base = weights.map((weight) => Math.floor((magnitude * weight) / totalWeight));
  const allocated = base.reduce((sum, amountCents) => sum + amountCents, 0);
  distributeRemainder(base, userIds, magnitude - allocated);
  return base;
}

function requireInt(
  value: number | undefined,
  code: SplitErrorCode,
  message: string,
): number {
  if (value === undefined || !Number.isInteger(value)) {
    throw new SplitError(code, message);
  }
  return value;
}

/**
 * Computes the authoritative per-participant amounts.
 *
 * Amounts come back in input order, so the caller can zip them against its own
 * participant list; the §2.6 ordering only governs who absorbs the remainder.
 */
export function computeSplits(input: ComputeSplitsInput): ComputedSplit[] {
  const { method, totalCents, participants } = input;

  if (participants.length === 0) {
    throw new SplitError("NO_PARTICIPANTS", "An expense needs at least one participant");
  }

  const userIds = participants.map((participant) => participant.userId);
  if (new Set(userIds).size !== userIds.length) {
    throw new SplitError(
      "DUPLICATE_PARTICIPANT",
      "Each participant may appear only once",
    );
  }

  if (!Number.isSafeInteger(totalCents) || totalCents === 0) {
    throw new SplitError(
      "INVALID_TOTAL",
      `Expense total must be non-zero integer cents, received ${totalCents}`,
    );
  }

  // A reversal carries a negative total. Allocating over the magnitude and
  // re-applying the sign makes a reversal the exact negation of the original
  // split, rather than a separately-rounded approximation of it.
  const sign = totalCents < 0 ? -1 : 1;
  const magnitude = Math.abs(totalCents);

  switch (method) {
    case "EQUAL": {
      const amounts = allocateByWeight(
        magnitude,
        participants.map(() => 1),
        userIds,
      );
      return participants.map((participant, index) => ({
        userId: participant.userId,
        amountCents: sign * amounts[index],
        percentBps: null,
        shares: null,
      }));
    }

    case "EXACT": {
      // The one method that trusts client amounts — and only after the sum is
      // proven to match the total exactly.
      const amounts = participants.map((participant) =>
        requireInt(
          participant.amountCents,
          "MISSING_EXACT_AMOUNT",
          `Participant ${participant.userId} needs an integer amountCents for an EXACT split`,
        ),
      );
      const sum = amounts.reduce((total, amountCents) => total + amountCents, 0);
      if (sum !== totalCents) {
        throw new SplitError(
          "EXACT_SUM_MISMATCH",
          `EXACT split amounts sum to ${sum} but the expense total is ${totalCents}`,
        );
      }
      return participants.map((participant, index) => ({
        userId: participant.userId,
        amountCents: assertCents(amounts[index], "split amount"),
        percentBps: null,
        shares: null,
      }));
    }

    case "PERCENTAGE": {
      const weights = participants.map((participant) => {
        const percentBps = requireInt(
          participant.percentBps,
          "MISSING_PERCENT",
          `Participant ${participant.userId} needs an integer percentBps for a PERCENTAGE split`,
        );
        if (percentBps <= 0) {
          throw new SplitError(
            "MISSING_PERCENT",
            `Participant ${participant.userId} needs a positive percentBps, received ${percentBps}`,
          );
        }
        return percentBps;
      });
      const totalBps = weights.reduce((sum, bps) => sum + bps, 0);
      if (totalBps !== 10_000) {
        throw new SplitError(
          "PERCENT_SUM_MISMATCH",
          `Percentages must sum to 10000 basis points, received ${totalBps}`,
        );
      }
      const amounts = allocateByWeight(magnitude, weights, userIds);
      return participants.map((participant, index) => ({
        userId: participant.userId,
        amountCents: sign * amounts[index],
        percentBps: weights[index],
        shares: null,
      }));
    }

    case "SHARES": {
      const weights = participants.map((participant) => {
        const shares = requireInt(
          participant.shares,
          "MISSING_SHARES",
          `Participant ${participant.userId} needs an integer shares for a SHARES split`,
        );
        if (shares <= 0) {
          throw new SplitError(
            "MISSING_SHARES",
            `Participant ${participant.userId} needs positive shares, received ${shares}`,
          );
        }
        return shares;
      });
      const amounts = allocateByWeight(magnitude, weights, userIds);
      return participants.map((participant, index) => ({
        userId: participant.userId,
        amountCents: sign * amounts[index],
        percentBps: null,
        shares: weights[index],
      }));
    }

    default:
      // Unreachable for typed callers; reached if an unvalidated string ever
      // arrives from the wire.
      throw new SplitError(
        "UNSUPPORTED_METHOD",
        `Unknown split method: ${String(method)}`,
      );
  }
}
