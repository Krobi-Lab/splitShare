import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  fail,
  ok,
  toActionResult,
  toFieldErrors,
  type ActionResult,
} from "@/lib/actions/result";
import {
  InsufficientRoleError,
  NotAMemberError,
  RateLimitedError,
  UnauthenticatedError,
  WrongHouseholdError,
} from "@/lib/auth/errors";
import { ExpenseStateError } from "@/lib/expenses/state";
import { MoneyError } from "@/lib/money";
import { SettlementError } from "@/lib/settlements/minimize";
import { SplitError } from "@/lib/splits/engine";

/** Narrows to the failure arm without non-null assertions everywhere. */
function expectFailure<T>(result: ActionResult<T>) {
  if (result.ok) {
    throw new Error("expected a failure result");
  }
  return result;
}

describe("ok / fail", () => {
  it("wraps a success payload", () => {
    expect(ok({ householdId: "h1" })).toEqual({ ok: true, data: { householdId: "h1" } });
  });

  it("wraps a failure with its code", () => {
    expect(fail("CONFLICT", "Taken")).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Taken",
    });
  });
});

describe("toFieldErrors", () => {
  it("keys issues by dotted path, so a form can place them on the right row", () => {
    const schema = z.object({
      participants: z.array(z.object({ amountCents: z.number().int() })),
    });
    const error = schema.safeParse({ participants: [{ amountCents: 1.5 }] }).error!;
    expect(Object.keys(toFieldErrors(error))).toEqual(["participants.0.amountCents"]);
  });

  it("collects several issues on one field", () => {
    const error = z
      .object({
        name: z
          .string()
          .min(5)
          .regex(/^[A-Z]/),
      })
      .safeParse({ name: "ab" }).error!;
    expect(toFieldErrors(error).name.length).toBeGreaterThan(1);
  });

  it("files a top-level issue under _", () => {
    const error = z
      .object({ a: z.number() })
      .refine(() => false, { error: "nope" })
      .safeParse({ a: 1 }).error!;
    expect(toFieldErrors(error)._).toEqual(["nope"]);
  });
});

describe("toActionResult", () => {
  it("maps a ZodError to VALIDATION with field errors", () => {
    const error = z.object({ id: z.uuid() }).safeParse({ id: "nope" }).error!;
    const result = expectFailure(toActionResult(error));
    expect(result.code).toBe("VALIDATION");
    expect(result.fieldErrors?.id).toBeDefined();
  });

  it("forwards each guard-chain failure under its own code", () => {
    expect(expectFailure(toActionResult(new UnauthenticatedError())).code).toBe(
      "UNAUTHENTICATED",
    );
    expect(expectFailure(toActionResult(new NotAMemberError())).code).toBe(
      "NOT_A_MEMBER",
    );
    expect(expectFailure(toActionResult(new InsufficientRoleError("no"))).code).toBe(
      "INSUFFICIENT_ROLE",
    );
    expect(expectFailure(toActionResult(new WrongHouseholdError())).code).toBe(
      "WRONG_HOUSEHOLD",
    );
  });

  it("carries the retry delay through a rate-limit denial", () => {
    const result = expectFailure(toActionResult(new RateLimitedError(2500)));
    expect(result.code).toBe("RATE_LIMITED");
    expect(result.retryAfterMs).toBe(2500);
  });

  it("does not invent a retryAfterMs for other authorization failures", () => {
    expect(
      expectFailure(toActionResult(new NotAMemberError())).retryAfterMs,
    ).toBeUndefined();
  });

  it("maps state, split and settlement errors to their own codes", () => {
    expect(
      expectFailure(toActionResult(new ExpenseStateError("LOCKED", "locked"))).code,
    ).toBe("STATE");
    expect(
      expectFailure(toActionResult(new SplitError("EXACT_SUM_MISMATCH", "bad sum"))).code,
    ).toBe("SPLIT");
    expect(expectFailure(toActionResult(new SettlementError("not zero"))).code).toBe(
      "SPLIT",
    );
  });

  it("forwards the message of errors we raised on purpose", () => {
    expect(expectFailure(toActionResult(new NotAMemberError())).message).toMatch(
      /not a member/i,
    );
    expect(
      expectFailure(toActionResult(new SplitError("EXACT_SUM_MISMATCH", "sums to 10")))
        .message,
    ).toBe("sums to 10");
  });

  it("maps a Prisma unique violation to CONFLICT by shape, not by import", () => {
    const result = expectFailure(
      toActionResult(Object.assign(new Error("dupe"), { code: "P2002" })),
    );
    expect(result.code).toBe("CONFLICT");
  });

  it("recognises a §10 append-only trigger violation", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = expectFailure(
      toActionResult(new Error("payments is append-only: UPDATE is not permitted.")),
    );
    expect(result.code).toBe("STATE");
    expect(result.message).toMatch(/reversal/i);
    spy.mockRestore();
  });

  it("hides a MoneyError's detail but keeps it in the log", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = expectFailure(toActionResult(new MoneyError("amount is 1.5")));
    expect(result.code).toBe("VALIDATION");
    expect(result.message).not.toMatch(/1\.5/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("never forwards an unrecognised error's message to the client", () => {
    // An unexpected message can carry a connection string, a SQL fragment, or
    // another household's data.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = expectFailure(
      toActionResult(new Error("connect ECONNREFUSED postgres://user:pw@host/db")),
    );
    expect(result.code).toBe("UNKNOWN");
    expect(result.message).toBe("Something went wrong. Please try again.");
    expect(result.message).not.toMatch(/postgres|pw/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("handles a thrown non-Error without crashing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(expectFailure(toActionResult("just a string")).code).toBe("UNKNOWN");
    expect(expectFailure(toActionResult(undefined)).code).toBe("UNKNOWN");
    spy.mockRestore();
  });
});
