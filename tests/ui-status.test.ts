import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_STATUS_TONES,
  balanceToneClass,
  EXPENSE_STATUS_TONES,
  PAYMENT_STATUS_TONES,
  ROLE_TONES,
} from "@/lib/ui/status";

/**
 * §13 — exhaustiveness is enforced at compile time by `Record<Enum, StatusTone>`,
 * so these tests cover the runtime behaviour and guard against an entry being
 * added with an empty label or class.
 */
describe("status tones", () => {
  const tables = {
    expense: EXPENSE_STATUS_TONES,
    acceptance: ACCEPTANCE_STATUS_TONES,
    payment: PAYMENT_STATUS_TONES,
    role: ROLE_TONES,
  };

  it.each(Object.entries(tables))("%s tones all carry a label and classes", (_name, table) => {
    for (const [status, tone] of Object.entries(table)) {
      expect(tone.label, status).not.toBe("");
      expect(tone.className, status).toContain("bg-");
      expect(tone.description, status).not.toBe("");
    }
  });

  it("covers every expense status in the §7 state machine", () => {
    expect(Object.keys(EXPENSE_STATUS_TONES).sort()).toEqual(
      [
        "ACCEPTED",
        "DISPUTED",
        "LOCKED",
        "PAID",
        "PARTIALLY_ACCEPTED",
        "PARTIALLY_PAID",
        "PENDING_ACCEPTANCE",
        "REVERSED",
      ].sort(),
    );
  });
});

describe("balanceToneClass", () => {
  it("distinguishes owed-to-you, owing, and settled", () => {
    expect(balanceToneClass(4000)).toContain("emerald");
    expect(balanceToneClass(-5000)).toContain("red");
    expect(balanceToneClass(0)).toContain("slate");
  });
});
