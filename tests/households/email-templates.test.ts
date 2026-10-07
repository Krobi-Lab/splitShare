import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  expenseCreatedEmail,
  invitationEmail,
  paymentConfirmedEmail,
  paymentReminderEmail,
} from "@/lib/email/templates";

describe("escapeHtml", () => {
  it("neutralises the characters that make injection possible", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escapeHtml("a & b")).toBe("a &amp; b");
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("escapes the ampersand first, so escapes are not double-encoded wrongly", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("invitationEmail", () => {
  const input = {
    householdName: "Flat 3",
    inviterName: "Ann",
    acceptUrl: "https://split.example/invite/tok",
    expiresAt: new Date("2026-10-14T12:00:00.000Z"),
  };

  it("names the inviter and household in the subject", () => {
    expect(invitationEmail(input).subject).toBe("Ann invited you to Flat 3");
  });

  it("includes the link in both the text and html parts", () => {
    const body = invitationEmail(input);
    expect(body.text).toContain(input.acceptUrl);
    expect(body.html).toContain(input.acceptUrl);
  });

  it("states the expiry date", () => {
    expect(invitationEmail(input).text).toContain("2026-10-14");
  });

  it("escapes a household name carrying markup", () => {
    // Household names are user-supplied and reach someone else's inbox.
    const body = invitationEmail({
      ...input,
      householdName: `<img src=x onerror=alert(1)>`,
    });
    expect(body.html).not.toContain("<img");
    expect(body.html).toContain("&lt;img");
  });

  it("escapes a malicious url rather than emitting a raw attribute break", () => {
    const body = invitationEmail({
      ...input,
      acceptUrl: `https://x" onmouseover="evil()`,
    });
    expect(body.html).not.toContain(`" onmouseover="`);
  });
});

describe("expenseCreatedEmail", () => {
  const input = {
    householdName: "Flat 3",
    description: "Groceries",
    paidByName: "Ann",
    amountCents: 9000,
    yourShareCents: 4500,
    currency: "NZD",
    url: "https://split.example/e/1",
  };

  it("renders money through formatMoney, never raw cents", () => {
    const body = expenseCreatedEmail(input);
    expect(body.subject).toContain("$45.00");
    expect(body.text).toContain("$90.00");
    expect(body.text).not.toContain("9000");
    expect(body.text).not.toContain("4500");
  });

  it("escapes an expense description carrying markup", () => {
    const body = expenseCreatedEmail({ ...input, description: "<b>beer</b>" });
    expect(body.html).not.toContain("<b>beer");
    expect(body.html).toContain("&lt;b&gt;beer");
  });

  it("respects a zero-decimal currency", () => {
    const body = expenseCreatedEmail({
      ...input,
      currency: "JPY",
      amountCents: 9000,
      yourShareCents: 4500,
    });
    expect(body.text).toContain("¥9,000");
  });
});

describe("paymentReminderEmail", () => {
  it("states the amount and the date it was due", () => {
    const body = paymentReminderEmail({
      householdName: "Flat 3",
      description: "Power bill",
      amountCents: 2000,
      currency: "NZD",
      dueDate: new Date("2026-10-10T00:00:00.000Z"),
      url: "https://split.example/settle",
    });
    expect(body.subject).toContain("$20.00");
    expect(body.text).toContain("2026-10-10");
  });
});

describe("paymentConfirmedEmail", () => {
  it("names who confirmed and how much", () => {
    const body = paymentConfirmedEmail({
      householdName: "Flat 3",
      fromName: "Ann",
      amountCents: 4500,
      currency: "NZD",
      url: "https://split.example/balances",
    });
    expect(body.subject).toBe("Ann confirmed your $45.00 payment");
  });
});

describe("every template", () => {
  const bodies = [
    invitationEmail({
      householdName: "H",
      inviterName: "A",
      acceptUrl: "https://x/i",
      expiresAt: new Date(0),
    }),
    expenseCreatedEmail({
      householdName: "H",
      description: "D",
      paidByName: "A",
      amountCents: 100,
      yourShareCents: 50,
      currency: "NZD",
      url: "https://x/e",
    }),
    paymentReminderEmail({
      householdName: "H",
      description: "D",
      amountCents: 100,
      currency: "NZD",
      dueDate: new Date(0),
      url: "https://x/s",
    }),
    paymentConfirmedEmail({
      householdName: "H",
      fromName: "A",
      amountCents: 100,
      currency: "NZD",
      url: "https://x/b",
    }),
  ];

  it("has a non-empty subject, text and html", () => {
    for (const body of bodies) {
      expect(body.subject.length).toBeGreaterThan(0);
      expect(body.text.length).toBeGreaterThan(0);
      expect(body.html).toContain("<div");
    }
  });

  it("keeps the subject to a sane length for an inbox list", () => {
    for (const body of bodies) {
      expect(body.subject.length).toBeLessThanOrEqual(120);
    }
  });
});
