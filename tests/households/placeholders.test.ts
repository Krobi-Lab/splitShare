import { describe, expect, it } from "vitest";

import {
  canActFor,
  isPlaceholderEmail,
  PLACEHOLDER_EMAIL_DOMAIN,
  placeholderEmail,
  splitStartsAccepted,
} from "@/lib/households/placeholders";

const ANN = "ann";
const BOB = "bob";
const PUKAR = "pukar";

describe("placeholder addresses", () => {
  it("builds an address under a TLD that can never resolve", () => {
    // RFC 2606 reserves .invalid precisely so it cannot be registered, so no
    // provider can ever verify it and it can never become a way to sign in.
    expect(placeholderEmail("abc")).toBe(`placeholder.abc@${PLACEHOLDER_EMAIL_DOMAIN}`);
    expect(PLACEHOLDER_EMAIL_DOMAIN.endsWith(".invalid")).toBe(true);
  });

  it("is unique per user, since users.email is unique", () => {
    expect(placeholderEmail("a")).not.toBe(placeholderEmail("b"));
  });

  it("recognises its own addresses, case-insensitively", () => {
    expect(isPlaceholderEmail(placeholderEmail("abc"))).toBe(true);
    expect(isPlaceholderEmail(placeholderEmail("abc").toUpperCase())).toBe(true);
  });

  it("does not mistake a real address for a placeholder", () => {
    for (const email of ["ann@example.com", "bob@splithome.com", "x@invalid.example"]) {
      expect(isPlaceholderEmail(email), email).toBe(false);
    }
  });
});

describe("canActFor", () => {
  it("lets anyone act for themselves", () => {
    expect(canActFor(ANN, { id: ANN, isPlaceholder: false, managedByUserId: null })).toBe(
      true,
    );
  });

  it("lets a manager act for the placeholder they manage", () => {
    expect(canActFor(ANN, { id: PUKAR, isPlaceholder: true, managedByUserId: ANN })).toBe(
      true,
    );
  });

  it("refuses someone else's placeholder", () => {
    expect(canActFor(BOB, { id: PUKAR, isPlaceholder: true, managedByUserId: ANN })).toBe(
      false,
    );
  });

  it("refuses acting for another real account, however the fields are set", () => {
    // The critical case: a real user must never be actionable by anyone else,
    // even if managedByUserId somehow carried a value.
    expect(canActFor(ANN, { id: BOB, isPlaceholder: false, managedByUserId: ANN })).toBe(
      false,
    );
    expect(canActFor(ANN, { id: BOB, isPlaceholder: false, managedByUserId: null })).toBe(
      false,
    );
  });

  it("refuses a placeholder with no manager", () => {
    expect(
      canActFor(ANN, { id: PUKAR, isPlaceholder: true, managedByUserId: null }),
    ).toBe(false);
  });

  it("is not transitive — a placeholder cannot manage another placeholder", () => {
    // Pukar is managed by Ann; Sagar claims to be managed by Pukar. Pukar has no
    // way to act at all, so nothing may be delegated through it.
    expect(
      canActFor(PUKAR, { id: "sagar", isPlaceholder: true, managedByUserId: PUKAR }),
    ).toBe(true);
    // ...but Ann cannot reach Sagar through Pukar.
    expect(
      canActFor(ANN, { id: "sagar", isPlaceholder: true, managedByUserId: PUKAR }),
    ).toBe(false);
  });
});

describe("splitStartsAccepted", () => {
  const base = { paidByUserId: ANN, createdByUserId: ANN };

  it("accepts a placeholder's split immediately — nobody can accept for them", () => {
    expect(
      splitStartsAccepted({ ...base, participantUserId: PUKAR, isPlaceholder: true }),
    ).toBe(true);
  });

  it("accepts the payer's own split — entering the expense is accepting it", () => {
    expect(
      splitStartsAccepted({ ...base, participantUserId: ANN, isPlaceholder: false }),
    ).toBe(true);
  });

  it("accepts the creator's split when somebody else paid", () => {
    expect(
      splitStartsAccepted({
        participantUserId: BOB,
        paidByUserId: ANN,
        createdByUserId: BOB,
        isPlaceholder: false,
      }),
    ).toBe(true);
  });

  it("leaves everyone else pending, per §8", () => {
    expect(
      splitStartsAccepted({ ...base, participantUserId: BOB, isPlaceholder: false }),
    ).toBe(false);
  });

  it("matches §40: Ann pays, so Bob's split is the only one awaiting action", () => {
    expect(
      splitStartsAccepted({ ...base, participantUserId: ANN, isPlaceholder: false }),
    ).toBe(true);
    expect(
      splitStartsAccepted({ ...base, participantUserId: BOB, isPlaceholder: false }),
    ).toBe(false);
  });
});
