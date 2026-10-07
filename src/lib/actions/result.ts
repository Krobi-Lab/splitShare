/**
 * The return contract for every Server Action.
 *
 * Server Actions are a network boundary: whatever they return is serialised and
 * sent to the browser. A thrown `Error` crosses that boundary as an opaque
 * "An error occurred in the Server Components render" in production, which is
 * useless to the user and to us. So actions catch, and return one of these.
 *
 * Pure and dependency-free so the mapping is unit-testable, and so it cannot
 * accidentally pull server-only modules into a client bundle.
 */

import { z } from "zod";

import { AuthorizationError } from "@/lib/auth/errors";
import { ExpenseStateError } from "@/lib/expenses/state";
import { MoneyError } from "@/lib/money";
import { SettlementError } from "@/lib/settlements/minimize";
import { SplitError } from "@/lib/splits/engine";

export type ActionErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_A_MEMBER"
  | "INSUFFICIENT_ROLE"
  | "WRONG_HOUSEHOLD"
  | "RATE_LIMITED"
  | "VALIDATION"
  | "SPLIT"
  | "STATE"
  | "CONFLICT"
  | "UNKNOWN";

/** Issues keyed by dotted field path, for rendering against form fields. */
export type FieldErrors = Record<string, string[]>;

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ActionErrorCode;
      message: string;
      fieldErrors?: FieldErrors;
      /** Only set for RATE_LIMITED. */
      retryAfterMs?: number;
    };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(
  code: ActionErrorCode,
  message: string,
  extra?: { fieldErrors?: FieldErrors; retryAfterMs?: number },
): ActionResult<never> {
  return { ok: false, code, message, ...extra };
}

/** Flattens a ZodError into dotted paths: `participants.1.amountCents`. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? "_" : issue.path.join(".");
    (fieldErrors[path] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/**
 * A Prisma unique-constraint violation, recognised by shape rather than by
 * importing the generated client — which would drag server-only code into
 * this module.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** A violation of one of the §10 database triggers. */
function isImmutabilityViolation(error: unknown): boolean {
  return error instanceof Error && /append-only/.test(error.message);
}

/**
 * Maps a thrown error onto a result.
 *
 * Only errors we raised deliberately have their message forwarded. Anything
 * unrecognised is logged server-side and reported generically, because an
 * unexpected message can carry a connection string, a SQL fragment, or another
 * household's data.
 */
export function toActionResult(error: unknown): ActionResult<never> {
  if (error instanceof z.ZodError) {
    return fail("VALIDATION", "Please check the highlighted fields.", {
      fieldErrors: toFieldErrors(error),
    });
  }

  if (error instanceof AuthorizationError) {
    return fail(error.reason, error.message, {
      retryAfterMs:
        "retryAfterMs" in error
          ? (error as { retryAfterMs: number }).retryAfterMs
          : undefined,
    });
  }

  if (error instanceof ExpenseStateError) {
    return fail("STATE", error.message);
  }

  if (error instanceof SplitError || error instanceof SettlementError) {
    return fail("SPLIT", error.message);
  }

  if (error instanceof MoneyError) {
    // The user sees a clean message; the detail is for us.
    console.error("[money]", error);
    return fail("VALIDATION", "That amount is not a valid number of cents.");
  }

  if (isUniqueViolation(error)) {
    return fail("CONFLICT", "That already exists.");
  }

  if (isImmutabilityViolation(error)) {
    console.error("[immutability]", error);
    return fail(
      "STATE",
      "That record is append-only and cannot be changed. Record a reversal instead.",
    );
  }

  console.error("[action]", error);
  return fail("UNKNOWN", "Something went wrong. Please try again.");
}
