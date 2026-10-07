import { describe, expect, it } from "vitest";

import type { ExpenseStatus } from "@/generated/prisma/enums";
import {
  assertMutable,
  assertTransition,
  canTransition,
  deriveAcceptanceStatus,
  ExpenseStateError,
  isTerminalForEdits,
  onwardStatuses,
  statusAfterAcceptanceChange,
  statusAfterLock,
  statusAfterPaymentConfirmed,
  statusAfterReversal,
} from "@/lib/expenses/state";

const ALL: ExpenseStatus[] = [
  "PENDING_ACCEPTANCE",
  "PARTIALLY_ACCEPTED",
  "ACCEPTED",
  "DISPUTED",
  "PARTIALLY_PAID",
  "PAID",
  "LOCKED",
  "REVERSED",
];

/**
 * The §7 adjacency, transcribed from the diagram independently of the
 * implementation. Every pair in ALL x ALL is then checked against it, so an
 * accidentally-added edge fails just as loudly as a missing one.
 */
const LEGAL: Record<ExpenseStatus, ExpenseStatus[]> = {
  PENDING_ACCEPTANCE: ["PARTIALLY_ACCEPTED", "ACCEPTED", "DISPUTED", "REVERSED"],
  PARTIALLY_ACCEPTED: ["ACCEPTED", "DISPUTED", "REVERSED"],
  DISPUTED: ["ACCEPTED", "PARTIALLY_ACCEPTED", "REVERSED"],
  ACCEPTED: ["PARTIALLY_PAID", "PAID", "REVERSED"],
  PARTIALLY_PAID: ["PAID", "REVERSED"],
  PAID: ["LOCKED", "REVERSED"],
  LOCKED: [],
  REVERSED: [],
};

describe("§7 transition table", () => {
  it("permits exactly the edges the diagram shows, and no others", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const expected = from === to || LEGAL[from].includes(to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it("treats a recompute that lands on the same status as a no-op", () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(true);
      expect(() => assertTransition(status, status)).not.toThrow();
    }
  });

  it("makes LOCKED and REVERSED sinks", () => {
    expect(onwardStatuses("LOCKED")).toEqual([]);
    expect(onwardStatuses("REVERSED")).toEqual([]);
  });

  it("rejects every mutation of a LOCKED expense with a LOCKED code", () => {
    for (const to of ALL.filter((status) => status !== "LOCKED")) {
      try {
        assertTransition("LOCKED", to);
        throw new Error(`expected LOCKED -> ${to} to throw`);
      } catch (error) {
        expect(error).toBeInstanceOf(ExpenseStateError);
        expect((error as ExpenseStateError).code).toBe("LOCKED");
      }
    }
  });

  it("reports an illegal transition distinctly from a locked one", () => {
    try {
      assertTransition("PAID", "ACCEPTED");
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as ExpenseStateError).code).toBe("ILLEGAL_TRANSITION");
      expect((error as Error).message).toMatch(/cannot go from PAID to ACCEPTED/);
    }
  });

  it("allows a reversal from anywhere except LOCKED", () => {
    // REVERSED is excluded because REVERSED -> REVERSED is the identity no-op,
    // not a second reversal; that it has no real onward edge is asserted above.
    for (const from of ALL.filter((status) => status !== "REVERSED")) {
      expect(canTransition(from, "REVERSED"), from).toBe(from !== "LOCKED");
    }
  });

  it("does not let an accepted expense fall back into dispute", () => {
    // §2.2 forbids updating a split once accepted, so nobody can un-accept.
    expect(canTransition("ACCEPTED", "DISPUTED")).toBe(false);
  });
});

describe("edit immutability", () => {
  it("treats PAID, LOCKED and REVERSED as terminal for edits", () => {
    for (const status of ALL) {
      const terminal = ["PAID", "LOCKED", "REVERSED"].includes(status);
      expect(isTerminalForEdits(status), status).toBe(terminal);
    }
  });

  it("allows edits in the acceptance and part-paid phases", () => {
    for (const status of [
      "PENDING_ACCEPTANCE",
      "PARTIALLY_ACCEPTED",
      "ACCEPTED",
      "DISPUTED",
      "PARTIALLY_PAID",
    ] as ExpenseStatus[]) {
      expect(() => assertMutable(status)).not.toThrow();
    }
  });

  it("distinguishes a locked expense from a merely immutable one", () => {
    try {
      assertMutable("LOCKED", "attach a receipt");
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as ExpenseStateError).code).toBe("LOCKED");
      expect((error as Error).message).toMatch(/attach a receipt/);
    }
    try {
      assertMutable("PAID");
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as ExpenseStateError).code).toBe("IMMUTABLE");
      expect((error as Error).message).toMatch(/reversing expense/);
    }
  });
});

describe("§8 acceptance derivation", () => {
  it("is PENDING until somebody decides", () => {
    expect(deriveAcceptanceStatus({ total: 3, accepted: 0, rejected: 0 })).toBe(
      "PENDING_ACCEPTANCE",
    );
  });

  it("is PARTIALLY_ACCEPTED once some but not all have accepted", () => {
    expect(deriveAcceptanceStatus({ total: 3, accepted: 2, rejected: 0 })).toBe(
      "PARTIALLY_ACCEPTED",
    );
  });

  it("is ACCEPTED once everyone has", () => {
    expect(deriveAcceptanceStatus({ total: 2, accepted: 2, rejected: 0 })).toBe(
      "ACCEPTED",
    );
  });

  it("is DISPUTED if anyone rejects, however many have accepted", () => {
    expect(deriveAcceptanceStatus({ total: 3, accepted: 0, rejected: 1 })).toBe(
      "DISPUTED",
    );
    expect(deriveAcceptanceStatus({ total: 3, accepted: 2, rejected: 1 })).toBe(
      "DISPUTED",
    );
  });

  it("rejects impossible counts", () => {
    expect(() => deriveAcceptanceStatus({ total: 0, accepted: 0, rejected: 0 })).toThrow(
      /at least one split/,
    );
    expect(() => deriveAcceptanceStatus({ total: 2, accepted: 2, rejected: 1 })).toThrow(
      /3 decisions across 2 splits/,
    );
  });
});

describe("statusAfterAcceptanceChange", () => {
  it("walks the §40 scenario: Ann auto-accepts, then Bob accepts", () => {
    const afterAnn = statusAfterAcceptanceChange("PENDING_ACCEPTANCE", {
      total: 2,
      accepted: 1,
      rejected: 0,
    });
    expect(afterAnn).toBe("PARTIALLY_ACCEPTED");
    expect(
      statusAfterAcceptanceChange(afterAnn, { total: 2, accepted: 2, rejected: 0 }),
    ).toBe("ACCEPTED");
  });

  it("resolves a dispute without a special case once the rejection is withdrawn", () => {
    expect(
      statusAfterAcceptanceChange("DISPUTED", { total: 3, accepted: 3, rejected: 0 }),
    ).toBe("ACCEPTED");
    expect(
      statusAfterAcceptanceChange("DISPUTED", { total: 3, accepted: 2, rejected: 0 }),
    ).toBe("PARTIALLY_ACCEPTED");
  });

  it("refuses to drag a part-paid expense back into the acceptance phase", () => {
    // Doing so would silently drop it out of the §12 balance view and change
    // everyone's balance.
    for (const status of [
      "PARTIALLY_PAID",
      "PAID",
      "LOCKED",
      "REVERSED",
    ] as ExpenseStatus[]) {
      try {
        statusAfterAcceptanceChange(status, { total: 2, accepted: 2, rejected: 0 });
        throw new Error(`expected ${status} to throw`);
      } catch (error) {
        expect((error as ExpenseStateError).code).toBe("WRONG_PHASE");
      }
    }
  });
});

describe("§9 statusAfterPaymentConfirmed", () => {
  it("goes straight to PAID when one payment settles everything (§40 step 6)", () => {
    expect(statusAfterPaymentConfirmed("ACCEPTED", { allSplitsSettled: true })).toBe(
      "PAID",
    );
  });

  it("goes to PARTIALLY_PAID while anything is outstanding", () => {
    expect(statusAfterPaymentConfirmed("ACCEPTED", { allSplitsSettled: false })).toBe(
      "PARTIALLY_PAID",
    );
    expect(
      statusAfterPaymentConfirmed("PARTIALLY_PAID", { allSplitsSettled: false }),
    ).toBe("PARTIALLY_PAID");
  });

  it("completes a part-paid expense", () => {
    expect(
      statusAfterPaymentConfirmed("PARTIALLY_PAID", { allSplitsSettled: true }),
    ).toBe("PAID");
  });

  it("refuses a payment against an expense nobody has accepted", () => {
    for (const status of [
      "PENDING_ACCEPTANCE",
      "PARTIALLY_ACCEPTED",
      "DISPUTED",
      "PAID",
      "LOCKED",
      "REVERSED",
    ] as ExpenseStatus[]) {
      try {
        statusAfterPaymentConfirmed(status, { allSplitsSettled: true });
        throw new Error(`expected ${status} to throw`);
      } catch (error) {
        expect((error as ExpenseStateError).code).toBe("WRONG_PHASE");
      }
    }
  });
});

describe("lock and reverse", () => {
  it("locks a paid expense (§40 step 8)", () => {
    expect(statusAfterLock("PAID")).toBe("LOCKED");
  });

  it("will not lock an expense that is not fully paid", () => {
    for (const status of [
      "PENDING_ACCEPTANCE",
      "PARTIALLY_ACCEPTED",
      "ACCEPTED",
      "DISPUTED",
      "PARTIALLY_PAID",
      "REVERSED",
    ] as ExpenseStatus[]) {
      expect(() => statusAfterLock(status), status).toThrow(ExpenseStateError);
    }
  });

  it("is idempotent for an already-locked expense", () => {
    expect(statusAfterLock("LOCKED")).toBe("LOCKED");
  });

  it("reverses from any live status", () => {
    for (const status of [
      "PENDING_ACCEPTANCE",
      "PARTIALLY_ACCEPTED",
      "ACCEPTED",
      "DISPUTED",
      "PARTIALLY_PAID",
      "PAID",
    ] as ExpenseStatus[]) {
      expect(statusAfterReversal(status), status).toBe("REVERSED");
    }
  });

  it("will not reverse a locked expense", () => {
    expect(() => statusAfterReversal("LOCKED")).toThrow(/locked/i);
  });
});
