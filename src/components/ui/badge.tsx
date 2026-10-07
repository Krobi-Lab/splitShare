import type {
  AcceptanceStatus,
  ExpenseStatus,
  HouseholdRole,
  PaymentStatus,
} from "@/generated/prisma/enums";
import {
  ACCEPTANCE_STATUS_TONES,
  EXPENSE_STATUS_TONES,
  PAYMENT_STATUS_TONES,
  ROLE_TONES,
  STATUS_BADGE_BASE,
  type StatusTone,
} from "@/lib/ui/status";

/**
 * §13 — every status badge comes from `src/lib/ui/status.ts`, so colour and
 * wording are decided in exactly one place.
 */
function Badge({ tone, title }: { tone: StatusTone; title?: string }) {
  return (
    <span
      className={`${STATUS_BADGE_BASE} ${tone.className}`}
      title={title ?? tone.description}
    >
      {tone.label}
    </span>
  );
}

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  return <Badge tone={EXPENSE_STATUS_TONES[status]} />;
}

export function AcceptanceBadge({ status }: { status: AcceptanceStatus }) {
  return <Badge tone={ACCEPTANCE_STATUS_TONES[status]} />;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={PAYMENT_STATUS_TONES[status]} />;
}

export function RoleBadge({ role }: { role: HouseholdRole }) {
  return <Badge tone={ROLE_TONES[role]} />;
}
