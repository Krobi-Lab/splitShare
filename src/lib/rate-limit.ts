/**
 * Rate limiting for the actions §21 names: inviting a member and creating an
 * expense.
 *
 * Sliding-window counter behind a small `RateLimitStore` interface. The default
 * store is in-memory, which on Vercel means PER INSTANCE: it reliably stops a
 * runaway client or a stuck retry loop, but it is not a distributed guarantee,
 * because a burst spread across cold starts gets a fresh window each time. A
 * Redis or Postgres store can be dropped in behind the same interface when a
 * hard guarantee is needed; nothing above this module has to change.
 *
 * The clock is injectable so the behaviour is testable without waiting.
 */

import { RateLimitedError } from "@/lib/auth/errors";

export interface RateLimitRule {
  /** Permitted events per window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export const RATE_LIMITS = {
  CREATE_EXPENSE: { limit: 30, windowMs: 60_000 },
  INVITE_MEMBER: { limit: 10, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitedAction = keyof typeof RATE_LIMITS;

export interface RateLimitStore {
  consume(key: string, rule: RateLimitRule): RateLimitResult;
}

/** Sliding window over retained event timestamps. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  consume(key: string, rule: RateLimitRule): RateLimitResult {
    const now = this.now();
    const windowStart = now - rule.windowMs;
    const retained = (this.hits.get(key) ?? []).filter(
      (timestamp) => timestamp > windowStart,
    );

    if (retained.length >= rule.limit) {
      this.hits.set(key, retained);
      // The oldest retained hit is the one whose expiry frees a slot.
      const retryAfterMs = retained[0] + rule.windowMs - now;
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(retryAfterMs, 1) };
    }

    retained.push(now);
    this.hits.set(key, retained);
    return {
      allowed: true,
      remaining: rule.limit - retained.length,
      retryAfterMs: 0,
    };
  }

  /** Drops windows that have fully expired, so the map cannot grow forever. */
  prune(maxWindowMs: number): void {
    const cutoff = this.now() - maxWindowMs;
    for (const [key, timestamps] of this.hits) {
      const retained = timestamps.filter((timestamp) => timestamp > cutoff);
      if (retained.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, retained);
      }
    }
  }

  /** Test seam. */
  reset(): void {
    this.hits.clear();
  }
}

const defaultStore = new MemoryRateLimitStore();

/**
 * Consumes one unit of the caller's allowance.
 *
 * @throws RateLimitedError when the window is exhausted.
 */
export function consumeRateLimit(
  action: RateLimitedAction,
  identifier: string,
  store: RateLimitStore = defaultStore,
): RateLimitResult {
  const rule = RATE_LIMITS[action];
  const result = store.consume(`${action}:${identifier}`, rule);
  if (!result.allowed) {
    throw new RateLimitedError(
      result.retryAfterMs,
      `Too many ${action === "INVITE_MEMBER" ? "invitations" : "expenses"} in a short time. ` +
        `Try again in ${Math.ceil(result.retryAfterMs / 1000)}s.`,
    );
  }
  return result;
}
