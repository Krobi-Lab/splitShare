import { describe, expect, it } from "vitest";

import {
  AuthorizationError,
  InsufficientRoleError,
  NotAMemberError,
  RateLimitedError,
  UnauthenticatedError,
  WrongHouseholdError,
} from "@/lib/auth/errors";

describe("authorization error taxonomy", () => {
  it("tags each guard-chain stage with its own reason", () => {
    expect(new UnauthenticatedError().reason).toBe("UNAUTHENTICATED");
    expect(new NotAMemberError().reason).toBe("NOT_A_MEMBER");
    expect(new InsufficientRoleError("nope").reason).toBe("INSUFFICIENT_ROLE");
    expect(new WrongHouseholdError().reason).toBe("WRONG_HOUSEHOLD");
    expect(new RateLimitedError(5000).reason).toBe("RATE_LIMITED");
  });

  it("is catchable as a single base class", () => {
    for (const error of [
      new UnauthenticatedError(),
      new NotAMemberError(),
      new InsufficientRoleError("nope"),
      new WrongHouseholdError(),
      new RateLimitedError(1),
    ]) {
      expect(error).toBeInstanceOf(AuthorizationError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).not.toBe("Error");
      expect(error.message).toBeTruthy();
    }
  });

  it("reports a cross-household id as plain 'not found', leaking nothing", () => {
    // §2.4(d): confirming that an id is real but belongs to someone else would
    // disclose the existence of another household's records.
    expect(new WrongHouseholdError().message).toBe("Not found");
  });

  it("carries the retry delay on a rate-limit denial", () => {
    expect(new RateLimitedError(2500).retryAfterMs).toBe(2500);
  });

  it("accepts custom messages", () => {
    expect(new UnauthenticatedError("Sign in first").message).toBe("Sign in first");
    expect(new NotAMemberError("Join Flat 3 first").message).toBe("Join Flat 3 first");
    expect(new RateLimitedError(1, "Slow down").message).toBe("Slow down");
  });
});
