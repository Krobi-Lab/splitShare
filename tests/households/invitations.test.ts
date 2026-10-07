import { describe, expect, it } from "vitest";

import {
  buildInvitationUrl,
  DEFAULT_INVITATION_TTL_DAYS,
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiresAt,
  isAcceptable,
  REJECTION_MESSAGES,
  rejectionReason,
  type InvitationLike,
} from "@/lib/invitations/token";

const NOW = new Date("2026-10-07T12:00:00.000Z");

describe("invitation tokens", () => {
  it("generates url-safe tokens with no padding", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateInvitationToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("generates a distinct token every time", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateInvitationToken()));
    expect(tokens.size).toBe(200);
  });

  it("hashes deterministically, which is what makes lookup by hash possible", () => {
    const token = generateInvitationToken();
    expect(hashInvitationToken(token)).toBe(hashInvitationToken(token));
    expect(hashInvitationToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never stores anything resembling the token itself", () => {
    const token = generateInvitationToken();
    const hash = hashInvitationToken(token);
    expect(hash).not.toContain(token);
    expect(hash).not.toBe(token);
  });

  it("hashes different tokens differently", () => {
    expect(hashInvitationToken("a")).not.toBe(hashInvitationToken("b"));
  });
});

describe("invitationExpiresAt", () => {
  it("defaults to a week out", () => {
    expect(invitationExpiresAt(NOW).toISOString()).toBe("2026-10-14T12:00:00.000Z");
    expect(DEFAULT_INVITATION_TTL_DAYS).toBe(7);
  });

  it("honours a custom ttl and does not mutate the input", () => {
    expect(invitationExpiresAt(NOW, 1).toISOString()).toBe("2026-10-08T12:00:00.000Z");
    expect(NOW.toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });

  it("rolls over month boundaries", () => {
    expect(
      invitationExpiresAt(new Date("2026-10-28T00:00:00.000Z"), 7).toISOString(),
    ).toBe("2026-11-04T00:00:00.000Z");
  });
});

describe("acceptability", () => {
  const pending = (expiresAt: string): InvitationLike => ({
    status: "PENDING",
    expiresAt: new Date(expiresAt),
  });

  it("accepts a live pending invitation", () => {
    expect(isAcceptable(pending("2026-10-14T12:00:00.000Z"), NOW)).toBe(true);
    expect(rejectionReason(pending("2026-10-14T12:00:00.000Z"), NOW)).toBeNull();
  });

  it("derives expiry from the clock, not the stored status", () => {
    // Nothing sweeps PENDING rows into EXPIRED, so a row can sit PENDING long
    // past its date. Trusting the status would make invitations immortal.
    const stale = pending("2026-10-01T12:00:00.000Z");
    expect(isAcceptable(stale, NOW)).toBe(false);
    expect(rejectionReason(stale, NOW)).toBe("EXPIRED");
  });

  it("treats the exact expiry instant as expired", () => {
    expect(isAcceptable(pending("2026-10-07T12:00:00.000Z"), NOW)).toBe(false);
  });

  it("reports a used invitation distinctly from a withdrawn one", () => {
    expect(
      rejectionReason({ status: "ACCEPTED", expiresAt: new Date("2027-01-01") }, NOW),
    ).toBe("ALREADY_ACCEPTED");
    expect(
      rejectionReason({ status: "REVOKED", expiresAt: new Date("2027-01-01") }, NOW),
    ).toBe("REVOKED");
    expect(
      rejectionReason({ status: "EXPIRED", expiresAt: new Date("2027-01-01") }, NOW),
    ).toBe("EXPIRED");
  });

  it("has a message for every rejection reason", () => {
    for (const reason of ["ALREADY_ACCEPTED", "REVOKED", "EXPIRED"] as const) {
      expect(REJECTION_MESSAGES[reason]).toBeTruthy();
    }
  });
});

describe("buildInvitationUrl", () => {
  it("builds an absolute link against the app url", () => {
    expect(buildInvitationUrl("https://split.example", "abc123")).toBe(
      "https://split.example/invite/abc123",
    );
  });

  it("escapes a token so it survives the URL intact", () => {
    // base64url never produces these, but the encoding must not be optional.
    expect(buildInvitationUrl("https://split.example", "a/b?c#d")).toBe(
      "https://split.example/invite/a%2Fb%3Fc%23d",
    );
  });

  it("works against a localhost base with a port", () => {
    expect(buildInvitationUrl("http://localhost:3000", "tok")).toBe(
      "http://localhost:3000/invite/tok",
    );
  });
});
