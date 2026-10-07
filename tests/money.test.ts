import { describe, expect, it, vi } from "vitest";

import {
  assertCents,
  formatMoney,
  formatSignedMoney,
  fromDbCents,
  minorUnitDigits,
  MoneyError,
  sumCents,
  toDbCents,
} from "@/lib/money";

describe("assertCents", () => {
  it("accepts integers, including negatives and zero", () => {
    expect(assertCents(0)).toBe(0);
    expect(assertCents(-4500)).toBe(-4500);
    expect(assertCents(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects a float before it can reach the database", () => {
    expect(() => assertCents(45.005)).toThrow(MoneyError);
    expect(() => assertCents(45.005, "split amount")).toThrow(/split amount/);
  });

  it("rejects values past the exact-integer range", () => {
    expect(() => assertCents(Number.MAX_SAFE_INTEGER + 2)).toThrow(/safe integer range/);
  });
});

describe("BIGINT round trip", () => {
  it("survives a round trip unchanged", () => {
    expect(fromDbCents(toDbCents(123_456_789))).toBe(123_456_789);
    expect(toDbCents(-4500)).toBe(-4500n);
  });

  it("refuses a BIGINT too large to represent exactly", () => {
    expect(() => fromDbCents(9_007_199_254_740_993n)).toThrow(/exceeds safe integers/);
  });
});

describe("sumCents", () => {
  it("adds cents", () => {
    expect(sumCents([4500, 4500])).toBe(9000);
    expect(sumCents([])).toBe(0);
  });

  it("rejects a non-integer member", () => {
    expect(() => sumCents([4500, 0.5])).toThrow(MoneyError);
  });
});

describe("minorUnitDigits", () => {
  it("knows the common exponents", () => {
    expect(minorUnitDigits("NZD")).toBe(2);
    expect(minorUnitDigits("JPY")).toBe(0);
    expect(minorUnitDigits("KWD")).toBe(3);
  });

  it("is case insensitive and cached", () => {
    expect(minorUnitDigits("nzd")).toBe(2);
    expect(minorUnitDigits("NZD")).toBe(2);
  });

  it("falls back to 2 digits for an unknown code", () => {
    expect(minorUnitDigits("ZZZ")).toBe(2);
  });

  it("falls back to 2 digits when Intl omits maximumFractionDigits", () => {
    const spy = vi
      .spyOn(Intl.NumberFormat.prototype, "resolvedOptions")
      // A conforming runtime always reports it for style: "currency", but the
      // type says optional, so the fallback has to actually work.
      .mockReturnValue({ maximumFractionDigits: undefined } as unknown as ReturnType<
        Intl.NumberFormat["resolvedOptions"]
      >);
    try {
      // A code not already in the module-level cache.
      expect(minorUnitDigits("AUD")).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("formatMoney", () => {
  it("renders cents as the household currency", () => {
    expect(formatMoney(9000, "NZD", "en-NZ")).toBe("$90.00");
    expect(formatMoney(4500, "USD", "en-US")).toBe("$45.00");
  });

  it("respects zero-decimal currencies", () => {
    expect(formatMoney(9000, "JPY", "en-US")).toBe("¥9,000");
  });

  it("respects three-decimal currencies", () => {
    expect(formatMoney(9000, "KWD", "en-US")).toContain("9.000");
  });

  it("renders negative amounts", () => {
    expect(formatMoney(-4500, "USD", "en-US")).toBe("-$45.00");
  });

  it("falls back to a plain rendering for an unknown currency code", () => {
    expect(formatMoney(9000, "ZZ", "en-US")).toBe("ZZ 90.00");
  });

  it("rejects a float amount", () => {
    expect(() => formatMoney(90.5, "NZD")).toThrow(MoneyError);
  });
});

describe("formatSignedMoney", () => {
  it("signs non-zero balances and leaves zero bare", () => {
    expect(formatSignedMoney(4000, "NZD", "en-NZ")).toBe("+$40.00");
    expect(formatSignedMoney(-5000, "NZD", "en-NZ")).toBe("-$50.00");
    expect(formatSignedMoney(0, "NZD", "en-NZ")).toBe("$0.00");
  });
});
