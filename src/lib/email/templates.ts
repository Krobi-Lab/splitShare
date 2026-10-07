/**
 * Email bodies for the four §19 functions.
 *
 * Pure, so every template is testable without a provider. Kept separate from
 * `send.ts` for that reason: `send.ts` is server-only because it touches
 * EMAIL_API_KEY, which would make these untestable if they lived there.
 *
 * Every interpolated value is HTML-escaped. Household names, expense
 * descriptions and member names are all user-supplied, and an unescaped one
 * would make an injected `<script>` or a broken layout reachable in someone
 * else's inbox.
 */

import { formatMoney } from "@/lib/money";

export interface EmailBody {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Wraps body HTML in the minimal shell that renders consistently in clients.
 *
 * `action` is required: every one of these emails exists to get someone to do
 * something, so an email without a button would be a bug rather than a variant.
 */
function layout(
  heading: string,
  bodyHtml: string,
  action: { url: string; label: string },
) {
  const button = `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#0f172a;color:#ffffff;padding:11px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:500">${escapeHtml(action.label)}</a></p>`;
  return [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a;line-height:1.5">`,
    `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>`,
    bodyHtml,
    button,
    `<p style="color:#64748b;font-size:12px;margin-top:32px">SplitHome · you are receiving this because you are a member of this household.</p>`,
    `</div>`,
  ].join("");
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px">${escapeHtml(text)}</p>`;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function invitationEmail(input: {
  householdName: string;
  inviterName: string;
  acceptUrl: string;
  expiresAt: Date;
}): EmailBody {
  const intro = `${input.inviterName} invited you to join "${input.householdName}" on SplitHome.`;
  const expiry = `This invitation expires on ${formatDate(input.expiresAt)}.`;
  return {
    subject: `${input.inviterName} invited you to ${input.householdName}`,
    text: `${intro}\n\nAccept: ${input.acceptUrl}\n\n${expiry}`,
    html: layout("You have been invited", paragraph(intro) + paragraph(expiry), {
      url: input.acceptUrl,
      label: "Accept invitation",
    }),
  };
}

export function expenseCreatedEmail(input: {
  householdName: string;
  description: string;
  paidByName: string;
  amountCents: number;
  yourShareCents: number;
  currency: string;
  url: string;
}): EmailBody {
  const total = formatMoney(input.amountCents, input.currency);
  const share = formatMoney(input.yourShareCents, input.currency);
  const intro = `${input.paidByName} added "${input.description}" (${total}) to ${input.householdName}.`;
  const ask = `Your share is ${share}. It needs your approval before it counts toward balances.`;
  return {
    subject: `${input.paidByName} added ${input.description} — your share is ${share}`,
    text: `${intro}\n\n${ask}\n\nReview: ${input.url}`,
    html: layout("A new expense needs your approval", paragraph(intro) + paragraph(ask), {
      url: input.url,
      label: "Review your share",
    }),
  };
}

export function paymentReminderEmail(input: {
  householdName: string;
  description: string;
  amountCents: number;
  currency: string;
  dueDate: Date;
  url: string;
}): EmailBody {
  const amount = formatMoney(input.amountCents, input.currency);
  const intro = `You still owe ${amount} for "${input.description}" in ${input.householdName}.`;
  const due = `It was due on ${formatDate(input.dueDate)}.`;
  return {
    subject: `Reminder: ${amount} outstanding for ${input.description}`,
    text: `${intro}\n\n${due}\n\nSettle up: ${input.url}`,
    html: layout("A payment is outstanding", paragraph(intro) + paragraph(due), {
      url: input.url,
      label: "Settle up",
    }),
  };
}

export function paymentConfirmedEmail(input: {
  householdName: string;
  fromName: string;
  amountCents: number;
  currency: string;
  url: string;
}): EmailBody {
  const amount = formatMoney(input.amountCents, input.currency);
  const intro = `${input.fromName} confirmed receiving your ${amount} payment in ${input.householdName}.`;
  return {
    subject: `${input.fromName} confirmed your ${amount} payment`,
    text: `${intro}\n\nView balances: ${input.url}`,
    html: layout("Your payment was confirmed", paragraph(intro), {
      url: input.url,
      label: "View balances",
    }),
  };
}
