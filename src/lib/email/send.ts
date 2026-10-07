import "server-only";

import type { EmailBody } from "./templates";
import {
  expenseCreatedEmail,
  invitationEmail,
  paymentConfirmedEmail,
  paymentReminderEmail,
} from "./templates";

/**
 * §19 — the email provider.
 *
 * Resend is used when EMAIL_API_KEY is set; otherwise every function is a
 * no-op that logs, so local development and CI never send real mail and never
 * need a key.
 *
 * Sending is best-effort by design: a provider outage must not roll back the
 * transaction that triggered it. An expense that was created, accepted and
 * audited is a fact whether or not the notification email went out, and §17's
 * in-app notification is the durable channel. Failures are logged, never
 * thrown.
 *
 * Uses `fetch` against the Resend REST API rather than the SDK, to avoid a
 * dependency for four calls.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface EmailRecipient {
  email: string;
  name?: string | null;
}

export interface EmailProvider {
  send(to: EmailRecipient, body: EmailBody): Promise<void>;
}

/** Used whenever EMAIL_API_KEY is absent. */
class LoggingEmailProvider implements EmailProvider {
  async send(to: EmailRecipient, body: EmailBody): Promise<void> {
    console.info(
      `[email:noop] to=${to.email} subject="${body.subject}" (EMAIL_API_KEY not set, nothing sent)`,
    );
  }
}

class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(to: EmailRecipient, body: EmailBody): Promise<void> {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [to.name ? `${to.name} <${to.email}>` : to.email],
        subject: body.subject,
        text: body.text,
        html: body.html,
      }),
    });

    if (!response.ok) {
      // Read the body for the log, but never surface it: a provider error can
      // echo back the recipient list and the API key prefix.
      const detail = await response.text().catch(() => "<unreadable>");
      throw new Error(`Resend rejected the message (${response.status}): ${detail}`);
    }
  }
}

let cachedProvider: EmailProvider | undefined;

export function emailProvider(): EmailProvider {
  if (cachedProvider) {
    return cachedProvider;
  }
  const apiKey = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM ?? "SplitHome <no-reply@example.com>";
  cachedProvider = apiKey
    ? new ResendEmailProvider(apiKey, from)
    : new LoggingEmailProvider();
  return cachedProvider;
}

/** Swallows provider failures — see the note on best-effort sending above. */
async function deliver(to: EmailRecipient | null, body: EmailBody): Promise<void> {
  if (!to?.email) {
    return;
  }
  try {
    await emailProvider().send(to, body);
  } catch (error) {
    console.error(`[email] failed to send "${body.subject}"`, error);
  }
}

export async function sendInvitationEmail(
  to: EmailRecipient,
  input: Parameters<typeof invitationEmail>[0],
): Promise<void> {
  await deliver(to, invitationEmail(input));
}

export async function sendExpenseCreatedEmail(
  to: EmailRecipient | null,
  input: Parameters<typeof expenseCreatedEmail>[0],
): Promise<void> {
  await deliver(to, expenseCreatedEmail(input));
}

export async function sendPaymentReminderEmail(
  to: EmailRecipient | null,
  input: Parameters<typeof paymentReminderEmail>[0],
): Promise<void> {
  await deliver(to, paymentReminderEmail(input));
}

export async function sendPaymentConfirmedEmail(
  to: EmailRecipient | null,
  input: Parameters<typeof paymentConfirmedEmail>[0],
): Promise<void> {
  await deliver(to, paymentConfirmedEmail(input));
}
