import { describe, expect, it, vi } from "vitest";

import {
  assertCents,
  DEFAULT_MONEY_LOCALE,
  formatMoney,
  formatSignedMoney,
  fromDbCents,
  minorUnitDigits,
  MoneyError,
  parseMoneyInput,
  toMoneyInput,
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
  it("does not vary with the host's locale", () => {
    // Server-rendered money ends up in emails and stored notification text, so
    // the same amount must read the same way whatever locale the instance has.
    expect(formatMoney(4500, "NZD")).toBe(formatMoney(4500, "NZD", DEFAULT_MONEY_LOCALE));
    expect(formatMoney(4500, "NZD")).toBe("$45.00");
    expect(formatMoney(4500, "USD")).toBe("US$45.00");
  });

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

describe("parseMoneyInput", () => {
  it("parses on the string, not through a float (§2.1)", () => {
    // parseFloat("59.41") * 100 is 5940.999999999999.
    expect(parseMoneyInput("59.41", "NZD")).toBe(5941);
    expect(parseMoneyInput("0.07", "NZD")).toBe(7);
    expect(parseMoneyInput("1.10", "NZD")).toBe(110);
  });

  it("accepts what people actually type", () => {
    expect(parseMoneyInput("$59.41", "NZD")).toBe(5941);
    expect(parseMoneyInput("1,234.56", "NZD")).toBe(123456);
    expect(parseMoneyInput("1 234.56", "NZD")).toBe(123456);
    expect(parseMoneyInput("  12.30  ", "NZD")).toBe(1230);
    expect(parseMoneyInput("-12.30", "NZD")).toBe(-1230);
  });

  it("treats a bare number as whole units", () => {
    expect(parseMoneyInput("1234", "NZD")).toBe(123400);
    expect(parseMoneyInput("5", "NZD")).toBe(500);
  });

  it("treats a comma as a thousands separator, never a decimal mark", () => {
    // "1.234" is genuinely ambiguous between conventions; guessing would turn
    // 1234 into 1.234. The app pins one locale instead.
    expect(parseMoneyInput("1,234", "NZD")).toBe(123400);
  });

  it("fills a short fractional part out to the currency's precision", () => {
    expect(parseMoneyInput("12.3", "NZD")).toBe(1230);
    expect(parseMoneyInput(".5", "NZD")).toBe(50);
  });

  it("rejects more precision than the currency has, rather than rounding it away", () => {
    expect(parseMoneyInput("59.413", "NZD")).toBeNull();
    expect(parseMoneyInput("12.5", "JPY")).toBeNull();
  });

  it("respects currencies that are not two-decimal", () => {
    expect(parseMoneyInput("1234", "JPY")).toBe(1234);
    expect(parseMoneyInput("1.234", "KWD")).toBe(1234);
  });

  it("returns null for anything it cannot read exactly", () => {
    for (const input of ["", "   ", "abc", ".", "12.3.4", "-", "$"]) {
      expect(parseMoneyInput(input, "NZD"), JSON.stringify(input)).toBeNull();
    }
  });

  it("refuses an amount beyond safe integers", () => {
    expect(parseMoneyInput("99999999999999999999", "NZD")).toBeNull();
  });
});

describe("toMoneyInput", () => {
  it("round-trips through parseMoneyInput", () => {
    for (const cents of [0, 5, 50, 1230, 5941, -4500, 123456]) {
      expect(parseMoneyInput(toMoneyInput(cents, "NZD"), "NZD"), String(cents)).toBe(
        cents,
      );
    }
  });

  it("emits a plain editable value, with no symbol or grouping", () => {
    expect(toMoneyInput(5941, "NZD")).toBe("59.41");
    expect(toMoneyInput(5, "NZD")).toBe("0.05");
    expect(toMoneyInput(-4500, "NZD")).toBe("-45.00");
    expect(toMoneyInput(123456, "NZD")).toBe("1234.56");
  });

  it("omits the decimal point for a zero-decimal currency", () => {
    expect(toMoneyInput(9000, "JPY")).toBe("9000");
  });

  it("rejects a non-integer amount", () => {
    expect(() => toMoneyInput(59.41, "NZD")).toThrow(MoneyError);
  });
});
