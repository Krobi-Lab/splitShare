import "server-only";

import type {
  AcceptanceStatus,
  ExpenseStatus,
  SplitMethod,
} from "@/generated/prisma/enums";
import { requireHouseholdMember } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { fromDbCents } from "@/lib/money";

/**
 * Read models for expenses.
 *
 * Every query runs the §2.4 guard chain first, so there is no path that reads
 * an expense from a household the caller is not a member of.
 */

export interface ExpenseListItem {
  id: string;
  description: string;
  amountCents: number;
  currency: string;
  date: Date;
  status: ExpenseStatus;
  splitMethod: SplitMethod;
  paidByUserId: string;
  paidByName: string;
  categoryName: string | null;
  categoryColorHex: string | null;
  /** The caller's own share, or null if they are not a participant. */
  yourShareCents: number | null;
  yourAcceptance: AcceptanceStatus | null;
  participantCount: number;
  hasReceipt: boolean;
  isReversal: boolean;
}

interface ListOptions {
  limit?: number;
  /** Only expenses on or after this date. */
  since?: Date;
}

export async function listExpenses(
  householdId: string,
  options: ListOptions = {},
): Promise<ExpenseListItem[]> {
  const membership = await requireHouseholdMember(householdId);

  const expenses = await prisma.expense.findMany({
    where: {
      householdId,
      ...(options.since ? { date: { gte: options.since } } : {}),
    },
    select: {
      id: true,
      description: true,
      amountCents: true,
      currency: true,
      date: true,
      status: true,
      splitMethod: true,
      paidByUserId: true,
      receiptFileId: true,
      reversesExpenseId: true,
      paidBy: { select: { name: true, email: true } },
      category: { select: { name: true, colorHex: true } },
      splits: { select: { userId: true, amountCents: true, acceptance: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: options.limit ?? 50,
  });

  return expenses.map((expense) => {
    const yours = expense.splits.find((split) => split.userId === membership.userId);
    return {
      id: expense.id,
      description: expense.description,
      amountCents: fromDbCents(expense.amountCents, "expense total"),
      currency: expense.currency,
      date: expense.date,
      status: expense.status,
      splitMethod: expense.splitMethod,
      paidByUserId: expense.paidByUserId,
      paidByName: expense.paidBy.name ?? expense.paidBy.email,
      categoryName: expense.category?.name ?? null,
      categoryColorHex: expense.category?.colorHex ?? null,
      yourShareCents: yours ? fromDbCents(yours.amountCents, "split amount") : null,
      yourAcceptance: yours?.acceptance ?? null,
      participantCount: expense.splits.length,
      hasReceipt: expense.receiptFileId !== null,
      isReversal: expense.reversesExpenseId !== null,
    };
  });
}

export interface AwaitingAction {
  expenseId: string;
  description: string;
  amountCents: number;
  yourShareCents: number;
  currency: string;
  date: Date;
  paidByName: string;
  /** Set when the share belongs to a placeholder the caller manages (§8a). */
  onBehalfOfUserId: string | null;
  onBehalfOfName: string | null;
}

/**
 * The §40 step 4 "Awaiting Your Action" list.
 *
 * Covers both the caller's own pending shares and those of any placeholder they
 * manage, since nobody else can act on those.
 */
export async function listAwaitingYourAction(
  householdId: string,
): Promise<AwaitingAction[]> {
  const membership = await requireHouseholdMember(householdId);

  const managed = await prisma.user.findMany({
    where: { isPlaceholder: true, managedByUserId: membership.userId },
    select: { id: true, name: true },
  });
  const managedById = new Map(managed.map((user) => [user.id, user.name]));

  const splits = await prisma.expenseSplit.findMany({
    where: {
      acceptance: "PENDING",
      userId: { in: [membership.userId, ...managedById.keys()] },
      expense: {
        householdId,
        // A locked or reversed expense cannot be acted on any more.
        status: { in: ["PENDING_ACCEPTANCE", "PARTIALLY_ACCEPTED", "DISPUTED"] },
      },
    },
    select: {
      userId: true,
      amountCents: true,
      expense: {
        select: {
          id: true,
          description: true,
          amountCents: true,
          currency: true,
          date: true,
          paidBy: { select: { name: true, email: true } },
        },
      },
    },
    orderBy: { expense: { date: "desc" } },
  });

  return splits.map((split) => ({
    expenseId: split.expense.id,
    description: split.expense.description,
    amountCents: fromDbCents(split.expense.amountCents, "expense total"),
    yourShareCents: fromDbCents(split.amountCents, "split amount"),
    currency: split.expense.currency,
    date: split.expense.date,
    paidByName: split.expense.paidBy.name ?? split.expense.paidBy.email,
    onBehalfOfUserId: split.userId === membership.userId ? null : split.userId,
    onBehalfOfName:
      split.userId === membership.userId ? null : (managedById.get(split.userId) ?? null),
  }));
}

export interface ExpenseDetail extends ExpenseListItem {
  notes: string | null;
  receiptFileId: string | null;
  createdByName: string;
  splits: Array<{
    userId: string;
    name: string;
    amountCents: number;
    acceptance: AcceptanceStatus;
    settled: boolean;
    isPlaceholder: boolean;
  }>;
}

export async function getExpense(
  householdId: string,
  expenseId: string,
): Promise<ExpenseDetail | null> {
  const membership = await requireHouseholdMember(householdId);

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: {
      id: true,
      householdId: true,
      description: true,
      amountCents: true,
      currency: true,
      date: true,
      status: true,
      splitMethod: true,
      notes: true,
      receiptFileId: true,
      paidByUserId: true,
      reversesExpenseId: true,
      paidBy: { select: { name: true, email: true } },
      createdBy: { select: { name: true, email: true } },
      category: { select: { name: true, colorHex: true } },
      splits: {
        select: {
          userId: true,
          amountCents: true,
          acceptance: true,
          settledAt: true,
          user: { select: { name: true, email: true, isPlaceholder: true } },
        },
        orderBy: { amountCents: "desc" },
      },
    },
  });

  // §2.4(d) — another household's expense id reads as missing.
  if (!expense || expense.householdId !== householdId) {
    return null;
  }

  const yours = expense.splits.find((split) => split.userId === membership.userId);

  return {
    id: expense.id,
    description: expense.description,
    amountCents: fromDbCents(expense.amountCents, "expense total"),
    currency: expense.currency,
    date: expense.date,
    status: expense.status,
    splitMethod: expense.splitMethod,
    paidByUserId: expense.paidByUserId,
    paidByName: expense.paidBy.name ?? expense.paidBy.email,
    createdByName: expense.createdBy.name ?? expense.createdBy.email,
    categoryName: expense.category?.name ?? null,
    categoryColorHex: expense.category?.colorHex ?? null,
    yourShareCents: yours ? fromDbCents(yours.amountCents, "split amount") : null,
    yourAcceptance: yours?.acceptance ?? null,
    participantCount: expense.splits.length,
    hasReceipt: expense.receiptFileId !== null,
    isReversal: expense.reversesExpenseId !== null,
    notes: expense.notes,
    receiptFileId: expense.receiptFileId,
    splits: expense.splits.map((split) => ({
      userId: split.userId,
      name: split.user.name ?? split.user.email,
      amountCents: fromDbCents(split.amountCents, "split amount"),
      acceptance: split.acceptance,
      settled: split.settledAt !== null,
      isPlaceholder: split.user.isPlaceholder,
    })),
  };
}
