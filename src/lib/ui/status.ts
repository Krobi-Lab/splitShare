/**
 * The single source of truth for status presentation (§13).
 *
 * Nothing else may hard-code a status colour or label. Each entry carries the
 * Tailwind utility classes for a badge plus the human label, keyed by the
 * generated Prisma enums so a schema change surfaces here as a type error.
 */

import type {
  AcceptanceStatus,
  ExpenseStatus,
  HouseholdRole,
  PaymentStatus,
} from "@/generated/prisma/enums";

export interface StatusTone {
  /** Human label for the badge. */
  label: string;
  /** Tailwind classes for the badge surface. */
  className: string;
  /** Short explanation, for tooltips and empty states. */
  description: string;
}

export const EXPENSE_STATUS_TONES: Record<ExpenseStatus, StatusTone> = {
  PENDING_ACCEPTANCE: {
    label: "Awaiting acceptance",
    className:
      "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/20",
    description: "Nobody has accepted their share yet.",
  },
  PARTIALLY_ACCEPTED: {
    label: "Partly accepted",
    className:
      "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/20",
    description: "Some participants have accepted their share.",
  },
  ACCEPTED: {
    label: "Accepted",
    className:
      "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-400/20",
    description: "Everyone accepted their share. Awaiting payment.",
  },
  DISPUTED: {
    label: "Disputed",
    className:
      "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-300 dark:ring-red-400/20",
    description: "A participant rejected their share.",
  },
  PARTIALLY_PAID: {
    label: "Partly paid",
    className:
      "bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-400/20",
    description: "Some shares have been paid and confirmed.",
  },
  PAID: {
    label: "Paid",
    className:
      "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/20",
    description: "Every share has been paid and confirmed.",
  },
  LOCKED: {
    label: "Locked",
    className:
      "bg-slate-100 text-slate-700 ring-slate-600/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-400/20",
    description: "Closed by an admin. No further changes are possible.",
  },
  REVERSED: {
    label: "Reversed",
    className:
      "bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-400/20",
    description: "Cancelled by a later reversal expense.",
  },
};

export const ACCEPTANCE_STATUS_TONES: Record<AcceptanceStatus, StatusTone> = {
  PENDING: {
    label: "Pending",
    className:
      "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/20",
    description: "Waiting on this participant to accept.",
  },
  ACCEPTED: {
    label: "Accepted",
    className:
      "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/20",
    description: "This participant accepted their share.",
  },
  REJECTED: {
    label: "Rejected",
    className:
      "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-300 dark:ring-red-400/20",
    description: "This participant rejected their share.",
  },
};

export const PAYMENT_STATUS_TONES: Record<PaymentStatus, StatusTone> = {
  PENDING_CONFIRMATION: {
    label: "Awaiting confirmation",
    className:
      "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/20",
    description: "The recipient has not confirmed this payment yet.",
  },
  CONFIRMED: {
    label: "Confirmed",
    className:
      "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/20",
    description: "The recipient confirmed this payment. It counts toward balances.",
  },
  REVERSED: {
    label: "Reversed",
    className:
      "bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-400/20",
    description: "Cancelled by a reversal row. It no longer counts toward balances.",
  },
};

export const ROLE_TONES: Record<HouseholdRole, StatusTone> = {
  ADMIN: {
    label: "Admin",
    className:
      "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-400/20",
    description: "Can invite members, manage settings and lock expenses.",
  },
  MEMBER: {
    label: "Member",
    className:
      "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-400/20",
    description: "Can create expenses, accept splits and record payments.",
  },
  VIEWER: {
    label: "Viewer",
    className:
      "bg-slate-100 text-slate-700 ring-slate-600/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-400/20",
    description: "Read-only access to the household.",
  },
};

/** Classes shared by every status badge, so the shapes stay identical. */
export const STATUS_BADGE_BASE =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

/** Tailwind classes for a net balance: owed to you, owing, or settled. */
export function balanceToneClass(netCents: number): string {
  if (netCents > 0) {
    return "text-emerald-600 dark:text-emerald-400";
  }
  if (netCents < 0) {
    return "text-red-600 dark:text-red-400";
  }
  return "text-slate-500 dark:text-slate-400";
}
