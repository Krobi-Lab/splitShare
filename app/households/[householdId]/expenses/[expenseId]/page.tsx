import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AcceptanceBadge, ExpenseStatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { AppHeader } from "@/components/layout/app-header";
import { NotAMemberError } from "@/lib/auth/errors";
import { getExpense } from "@/lib/expenses/queries";
import { getHousehold } from "@/lib/households/queries";

export const metadata: Metadata = { title: "Expense" };

export default async function ExpensePage({
  params,
}: PageProps<"/households/[householdId]/expenses/[expenseId]">) {
  const { householdId, expenseId } = await params;

  let household;
  try {
    household = await getHousehold(householdId);
  } catch (error) {
    if (error instanceof NotAMemberError) {
      notFound();
    }
    throw error;
  }

  const expense = await getExpense(householdId, expenseId);
  if (!expense) {
    notFound();
  }

  return (
    <>
      <AppHeader householdName={household.name} role={household.yourRole} />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4 pb-24">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {expense.description}
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {expense.paidByName} paid ·{" "}
                {expense.date.toLocaleDateString("en-NZ", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                {expense.categoryName ? ` · ${expense.categoryName}` : ""}
              </p>
            </div>
            <ExpenseStatusBadge status={expense.status} />
          </div>

          <p className="mt-4 font-mono text-3xl font-semibold tabular-nums">
            <Money cents={expense.amountCents} currency={expense.currency} />
          </p>

          {expense.notes ? (
            <p className="mt-4 text-sm whitespace-pre-wrap text-slate-600 dark:text-slate-400">
              {expense.notes}
            </p>
          ) : null}

          {expense.isReversal ? (
            <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              This is a reversal. It cancels an earlier expense; both stay on the record.
            </p>
          ) : null}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h2 className="text-sm font-semibold tracking-tight">
              Split {expense.splitMethod.toLowerCase()}
            </h2>
          </div>
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {expense.splits.map((split) => (
              <li key={split.userId} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {split.name}
                  {split.isPlaceholder ? (
                    <span className="ml-1 text-xs text-slate-400">(tracked)</span>
                  ) : null}
                </span>
                {split.settled ? (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">
                    settled
                  </span>
                ) : (
                  <AcceptanceBadge status={split.acceptance} />
                )}
                <Money
                  cents={split.amountCents}
                  currency={expense.currency}
                  className="w-24 shrink-0 text-right text-sm"
                />
              </li>
            ))}
          </ul>
        </Card>

        {expense.receiptFileId ? (
          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold tracking-tight">Receipt</h2>
            </div>
            {/* Served through the authenticated route, never a public blob URL. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/receipts/${expense.receiptFileId}`}
              alt={`Receipt for ${expense.description}`}
              className="w-full"
            />
          </Card>
        ) : null}
      </main>
    </>
  );
}
