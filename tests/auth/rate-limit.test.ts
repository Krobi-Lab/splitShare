import { describe, expect, it } from "vitest";

import { RateLimitedError } from "@/lib/auth/errors";
import {
  consumeRateLimit,
  MemoryRateLimitStore,
  RATE_LIMITS,
} from "@/lib/rate-limit";

/** A controllable clock, so nothing has to wait on real time. */
function clockAt(start = 1_000_000): { store: MemoryRateLimitStore; advance: (ms: number) => void } {
  let now = start;
  const store = new MemoryRateLimitStore(() => now);
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("MemoryRateLimitStore", () => {
  const rule = { limit: 3, windowMs: 1000 };

  it("allows up to the limit and reports the remaining allowance", () => {
    const { store } = clockAt();
    expect(store.consume("k", rule)).toMatchObject({ allowed: true, remaining: 2 });
    expect(store.consume("k", rule)).toMatchObject({ allowed: true, remaining: 1 });
    expect(store.consume("k", rule)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("denies past the limit and says how long to wait", () => {
    const { store, advance } = clockAt();
    for (let i = 0; i < rule.limit; i += 1) {
      store.consume("k", rule);
    }
    advance(400);
    const denied = store.consume("k", rule);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    // The first hit was 400ms ago, so a slot frees in 600ms.
    expect(denied.retryAfterMs).toBe(600);
  });

  it("lets the window slide rather than resetting in fixed blocks", () => {
    const { store, advance } = clockAt();
    store.consume("k", rule);
    advance(600);
    store.consume("k", rule);
    store.consume("k", rule);
    expect(store.consume("k", rule).allowed).toBe(false);

    // 500ms later the first hit has aged out, freeing exactly one slot.
    advance(500);
    expect(store.consume("k", rule).allowed).toBe(true);
    expect(store.consume("k", rule).allowed).toBe(false);
  });

  it("keys separately, so one user cannot exhaust another's allowance", () => {
    const { store } = clockAt();
    for (let i = 0; i < rule.limit; i += 1) {
      store.consume("ann", rule);
    }
    expect(store.consume("ann", rule).allowed).toBe(false);
    expect(store.consume("bob", rule).allowed).toBe(true);
  });

  it("always reports a positive retry delay", () => {
    const { store, advance } = clockAt();
    for (let i = 0; i < rule.limit; i += 1) {
      store.consume("k", rule);
    }
    advance(rule.windowMs - 1);
    expect(store.consume("k", rule).retryAfterMs).toBeGreaterThan(0);
  });

  it("prunes expired windows so the map cannot grow forever", () => {
    const { store, advance } = clockAt();
    store.consume("gone", rule);
    store.consume("kept", rule);
    advance(rule.windowMs + 1);
    store.consume("kept", rule);
    store.prune(rule.windowMs);
    // "gone" was dropped entirely, so it starts from a full allowance.
    expect(store.consume("gone", rule)).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("can be reset", () => {
    const { store } = clockAt();
    for (let i = 0; i < rule.limit; i += 1) {
      store.consume("k", rule);
    }
    store.reset();
    expect(store.consume("k", rule).allowed).toBe(true);
  });
});

describe("consumeRateLimit", () => {
  it("throws RateLimitedError with a retry delay once exhausted", () => {
    const { store } = clockAt();
    for (let i = 0; i < RATE_LIMITS.INVITE_MEMBER.limit; i += 1) {
      consumeRateLimit("INVITE_MEMBER", "ann", store);
    }
    try {
      consumeRateLimit("INVITE_MEMBER", "ann", store);
      throw new Error("expected a RateLimitedError");
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitedError);
      expect((error as RateLimitedError).reason).toBe("RATE_LIMITED");
      expect((error as RateLimitedError).retryAfterMs).toBeGreaterThan(0);
      expect((error as RateLimitedError).message).toMatch(/invitations/);
    }
  });

  it("namespaces actions, so invites and expenses have separate allowances", () => {
    const { store } = clockAt();
    for (let i = 0; i < RATE_LIMITS.INVITE_MEMBER.limit; i += 1) {
      consumeRateLimit("INVITE_MEMBER", "ann", store);
    }
    expect(() => consumeRateLimit("CREATE_EXPENSE", "ann", store)).not.toThrow();
  });

  it("reports expenses, not invitations, in the CREATE_EXPENSE message", () => {
    const { store } = clockAt();
    for (let i = 0; i < RATE_LIMITS.CREATE_EXPENSE.limit; i += 1) {
      consumeRateLimit("CREATE_EXPENSE", "ann", store);
    }
    expect(() => consumeRateLimit("CREATE_EXPENSE", "ann", store)).toThrow(/expenses/);
  });
});
