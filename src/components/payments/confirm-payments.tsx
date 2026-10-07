"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { confirmPayment } from "@/actions/payments/confirm";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import type { PaymentListItem } from "@/lib/payments/queries";

/**
 * Payments waiting on you (§40 step 6).
 *
 * Confirming is the moment money actually moves in the balances, so the wording
 * asks whether it arrived rather than whether they said they sent it.
 */
export function ConfirmPayments({
  householdId,
  payments,
}: {
  householdId: string;
  payments: PaymentListItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold tracking-tight">
          Waiting on you
          {payments.length > 0 ? (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {payments.length}
            </span>
          ) : null}
        </h2>
      </div>

      {payments.length === 0 ? (
        <EmptyState
          title="Nothing to confirm"
          body="When somebody says they have paid you, it shows here until you confirm it arrived."
        />
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {payments.map((payment) => (
            <li key={payment.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <span className="font-medium">{payment.fromName}</span> says they paid{" "}
                    {payment.toName}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {payment.paidAt.toLocaleDateString("en-NZ", {
                      day: "numeric",
                      month: "short",
                    })}
                    {payment.note ? ` · ${payment.note}` : ""}
                  </p>
                </div>
                <Money
                  cents={payment.amountCents}
                  currency={payment.currency}
                  className="shrink-0 text-sm font-medium"
                />
              </div>
              <Button
                className="mt-3 w-full"
                disabled={isPending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await confirmPayment({
                      householdId,
                      paymentId: payment.id,
                    });
                    if (!result.ok) {
                      setError(result.message);
                      return;
                    }
                    router.refresh();
                  });
                }}
              >
                {isPending ? "Confirming…" : "Yes, it arrived"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="px-4 pb-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
