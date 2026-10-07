/**
 * The failure taxonomy for the §2.4 guard chain.
 *
 * Each stage of the chain has its own error so a server action can map a
 * denial to the right HTTP-ish outcome, and so logs distinguish "not signed in"
 * from "signed in but not a member of that household" — which are very
 * different events from a security standpoint.
 */

export type AuthFailureReason =
  | "UNAUTHENTICATED"
  | "NOT_A_MEMBER"
  | "INSUFFICIENT_ROLE"
  | "WRONG_HOUSEHOLD"
  | "RATE_LIMITED";

export class AuthorizationError extends Error {
  readonly reason: AuthFailureReason;

  constructor(reason: AuthFailureReason, message: string) {
    super(message);
    this.name = "AuthorizationError";
    this.reason = reason;
  }
}

export class UnauthenticatedError extends AuthorizationError {
  constructor(message = "You must be signed in to do that") {
    super("UNAUTHENTICATED", message);
    this.name = "UnauthenticatedError";
  }
}

export class NotAMemberError extends AuthorizationError {
  constructor(message = "You are not a member of this household") {
    super("NOT_A_MEMBER", message);
    this.name = "NotAMemberError";
  }
}

export class InsufficientRoleError extends AuthorizationError {
  constructor(message: string) {
    super("INSUFFICIENT_ROLE", message);
    this.name = "InsufficientRoleError";
  }
}

/**
 * §2.4(d) — the requested entity exists but belongs to a different household.
 *
 * Deliberately worded the same as "not found": telling a caller that an id is
 * real but theirs-it-is-not leaks the existence of other households' data.
 */
export class WrongHouseholdError extends AuthorizationError {
  constructor(message = "Not found") {
    super("WRONG_HOUSEHOLD", message);
    this.name = "WrongHouseholdError";
  }
}

export class RateLimitedError extends AuthorizationError {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number, message = "Too many requests. Try again shortly.") {
    super("RATE_LIMITED", message);
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}
