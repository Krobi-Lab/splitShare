import { describe, expect, it } from "vitest";

import { toAuditJson } from "@/lib/audit/json";

describe("toAuditJson", () => {
  it("converts money bigints to numbers, which is why it exists", () => {
    expect(toAuditJson({ amountCents: 9000n })).toEqual({ amountCents: 9000 });
    expect(toAuditJson({ amountCents: -4500n })).toEqual({ amountCents: -4500 });
  });

  it("degrades a bigint beyond safe integers to a string rather than throwing", () => {
    expect(toAuditJson(9_007_199_254_740_993n)).toBe("9007199254740993");
  });

  it("renders dates as ISO 8601", () => {
    expect(toAuditJson(new Date("2026-10-07T12:00:00.000Z"))).toBe(
      "2026-10-07T12:00:00.000Z",
    );
  });

  it("passes primitives through", () => {
    expect(toAuditJson("Groceries")).toBe("Groceries");
    expect(toAuditJson(42)).toBe(42);
    expect(toAuditJson(true)).toBe(true);
    expect(toAuditJson(null)).toBeNull();
    expect(toAuditJson(undefined)).toBeNull();
  });

  it("stringifies non-finite numbers, which JSON cannot hold", () => {
    expect(toAuditJson(Number.NaN)).toBe("NaN");
    expect(toAuditJson(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });

  it("drops functions and symbols", () => {
    expect(toAuditJson({ fn: () => 1, sym: Symbol("s"), keep: 1 })).toEqual({
      fn: null,
      sym: null,
      keep: 1,
    });
  });

  it("omits undefined keys, as JSON.stringify would", () => {
    expect(toAuditJson({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it("recurses through arrays and nested objects", () => {
    expect(
      toAuditJson({
        expense: { amountCents: 9000n, date: new Date("2026-01-01T00:00:00.000Z") },
        splits: [{ amountCents: 4500n }, { amountCents: 4500n }],
      }),
    ).toEqual({
      expense: { amountCents: 9000, date: "2026-01-01T00:00:00.000Z" },
      splits: [{ amountCents: 4500 }, { amountCents: 4500 }],
    });
  });

  it("flattens Maps and Sets", () => {
    expect(toAuditJson(new Map([["a", 1n]]))).toEqual({ a: 1 });
    expect(toAuditJson(new Set([1n, 2n]))).toEqual([1, 2]);
  });

  it("produces something JSON.stringify accepts, which the raw input does not", () => {
    const snapshot = { amountCents: 9000n, createdAt: new Date(0) };
    expect(() => JSON.stringify(snapshot)).toThrow(TypeError);
    expect(() => JSON.stringify(toAuditJson(snapshot))).not.toThrow();
  });
});
