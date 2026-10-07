/**
 * The §7 expense state machine — the application half of §10's two-layer
 * immutability enforcement.
 *
 * Pure and dependency-free, so every edge can be tested without a database.
 * The adjacency table below is the single source of truth: a transition that is
 * not listed cannot happen, and `assertTransition` is what every server action
 * calls before it writes a new status.
 */

import type { ExpenseStatus } from "@/generated/prisma/enums";

export type ExpenseStateErrorCode =
  "ILLEGAL_TRANSITION" | "LOCKED" | "IMMUTABLE" | "WRONG_PHASE";

export class ExpenseStateError extends Error {
  readonly code: ExpenseStateErrorCode;

  constructor(code: ExpenseStateErrorCode, message: string) {
    super(message);
    this.name = "ExpenseStateError";
    this.code = code;
  }
}

/**
 * Legal onward transitions, transcribed from the §7 diagram.
 *
 * Notes on the edges that are NOT in the diagram's happy path:
 *   * ACCEPTED -> PAID directly, because a single confirmed payment can settle
 *     every outstanding split at once. §40 is exactly that case: Ann paid, so
 *     only Bob owes, and his one payment takes the expense straight to PAID.
 *   * DISPUTED -> PARTIALLY_ACCEPTED, because resolving a dispute in a group of
 *     three leaves the expense partly accepted rather than fully accepted.
 *   * Almost anything -> REVERSED, because a correction is always available
 *     (§7) — except from LOCKED, which rejects every mutation.
 *   * ACCEPTED has no edge back to DISPUTED: §2.2 forbids updating a split once
 *     accepted, so a participant cannot un-accept.
 *   * LOCKED and REVERSED are sinks.
 */
const TRANSITIONS: Record<ExpenseStatus, readonly ExpenseStatus[]> = {
  PENDING_ACCEPTANCE: ["PARTIALLY_ACCEPTED", "ACCEPTED", "DISPUTED", "REVERSED"],
  PARTIALLY_ACCEPTED: ["ACCEPTED", "DISPUTED", "REVERSED"],
  DISPUTED: ["ACCEPTED", "PARTIALLY_ACCEPTED", "REVERSED"],
  ACCEPTED: ["PARTIALLY_PAID", "PAID", "REVERSED"],
  PARTIALLY_PAID: ["PAID", "REVERSED"],
  PAID: ["LOCKED", "REVERSED"],
  LOCKED: [],
  REVERSED: [],
};

/** §7 — no further edits, though PAID may still be locked or reversed. */
const TERMINAL_FOR_EDITS: readonly ExpenseStatus[] = ["PAID", "LOCKED", "REVERSED"];

/**
 * Whether `from -> to` is legal.
 *
 * `from === to` is allowed as a no-op: status is recomputed from the current
 * acceptance and payment rows after every change, and a recompute that lands on
 * the same status must not be an error. Callers skip the write in that case.
 */
export function canTransition(from: ExpenseStatus, to: ExpenseStatus): boolean {
  if (from === to) {
    return true;
  }
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ExpenseStatus, to: ExpenseStatus): void {
  if (from === "LOCKED" && to !== "LOCKED") {
    throw new ExpenseStateError(
      "LOCKED",
      "This expense is locked. Record a reversing expense instead.",
    );
  }
  if (!canTransition(from, to)) {
    throw new ExpenseStateError(
      "ILLEGAL_TRANSITION",
      `An expense cannot go from ${from} to ${to}`,
    );
  }
}

export function isTerminalForEdits(status: ExpenseStatus): boolean {
  return TERMINAL_FOR_EDITS.includes(status);
}

/** The statuses from which onward movement is still possible at all. */
export function onwardStatuses(status: ExpenseStatus): readonly ExpenseStatus[] {
  return TRANSITIONS[status];
}

/**
 * §7 — LOCKED rejects every mutation, and PAID/REVERSED reject edits.
 *
 * Call this before changing anything about an expense other than its status.
 */
export function assertMutable(status: ExpenseStatus, what = "change this expense"): void {
  if (status === "LOCKED") {
    throw new ExpenseStateError(
      "LOCKED",
      `This expense is locked, so you cannot ${what}. Record a reversing expense instead.`,
    );
  }
  if (isTerminalForEdits(status)) {
    throw new ExpenseStateError(
      "IMMUTABLE",
      `This expense is ${status.toLowerCase()}, so you cannot ${what}. ` +
        "Record a reversing expense instead.",
    );
  }
}

export interface AcceptanceCounts {
  /** Number of splits on the expense. */
  total: number;
  accepted: number;
  rejected: number;
}

/**
 * The acceptance-phase status implied by the split rows (§8).
 *
 * Deriving it rather than stepping it is what makes dispute resolution fall out
 * for free: once the rejecting participant accepts, `rejected` drops to 0 and
 * this returns ACCEPTED or PARTIALLY_ACCEPTED without a special case.
 */
export function deriveAcceptanceStatus(counts: AcceptanceCounts): ExpenseStatus {
  const { total, accepted, rejected } = counts;
  if (total <= 0) {
    throw new ExpenseStateError("WRONG_PHASE", "An expense must have at least one split");
  }
  if (accepted + rejected > total) {
    throw new ExpenseStateError(
      "WRONG_PHASE",
      `Counted ${accepted + rejected} decisions across ${total} splits`,
    );
  }
  // §8 — any rejection disputes the whole expense.
  if (rejected > 0) {
    return "DISPUTED";
  }
  if (accepted === total) {
    return "ACCEPTED";
  }
  if (accepted > 0) {
    return "PARTIALLY_ACCEPTED";
  }
  return "PENDING_ACCEPTANCE";
}

/** Statuses in which acceptance can still move. */
const ACCEPTANCE_PHASE: readonly ExpenseStatus[] = [
  "PENDING_ACCEPTANCE",
  "PARTIALLY_ACCEPTED",
  "ACCEPTED",
  "DISPUTED",
];

/**
 * The status after a participant accepts or rejects their split.
 *
 * Refuses to act once money has moved: an expense that is PARTIALLY_PAID or
 * beyond must not be dragged back into the acceptance phase, which would
 * silently remove it from the §12 balance view and change everyone's balance.
 */
export function statusAfterAcceptanceChange(
  current: ExpenseStatus,
  counts: AcceptanceCounts,
): ExpenseStatus {
  if (!ACCEPTANCE_PHASE.includes(current)) {
    throw new ExpenseStateError(
      "WRONG_PHASE",
      `Acceptance cannot change while the expense is ${current}`,
    );
  }
  const next = deriveAcceptanceStatus(counts);
  assertTransition(current, next);
  return next;
}

/**
 * The status after a payment is confirmed (§9 — only confirmed payments count).
 *
 * `allSplitsSettled` is computed from the payment rows, not guessed, so an
 * expense reaches PAID exactly when nothing is outstanding.
 */
export function statusAfterPaymentConfirmed(
  current: ExpenseStatus,
  options: { allSplitsSettled: boolean },
): ExpenseStatus {
  if (current !== "ACCEPTED" && current !== "PARTIALLY_PAID") {
    throw new ExpenseStateError(
      "WRONG_PHASE",
      `A payment cannot be applied to an expense that is ${current}`,
    );
  }
  const next: ExpenseStatus = options.allSplitsSettled ? "PAID" : "PARTIALLY_PAID";
  assertTransition(current, next);
  return next;
}

/** §5 — admin only, and only once the expense is fully paid. */
export function statusAfterLock(current: ExpenseStatus): ExpenseStatus {
  assertTransition(current, "LOCKED");
  return "LOCKED";
}

/** §7 — the original is marked REVERSED when a correcting expense is created. */
export function statusAfterReversal(current: ExpenseStatus): ExpenseStatus {
  assertTransition(current, "REVERSED");
  return "REVERSED";
}
