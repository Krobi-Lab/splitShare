"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { lockExpense } from "@/actions/expenses/lock";
import { reverseExpense } from "@/actions/expenses/reverse";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ExpenseStatus } from "@/generated/prisma/enums";

/**
 * Lock and reverse (§7, §40 step 8).
 *
 * Which controls appear is decided from the same rules the state machine
 * enforces, so the UI never offers something the server will refuse: LOCKED is
 * only reachable from PAID, and nothing is reachable from LOCKED at all.
 *
 * Both are explained rather than just labelled. Locking is irreversible and
 * reversing writes a permanent second row, and neither is obvious from a verb.
 */
export function ExpenseActions({
  householdId,
  expenseId,
  status,
  canLock,
  canReverse,
}: {
  householdId: string;
  expenseId: string;
  status: ExpenseStatus;
  canLock: boolean;
  canReverse: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"lock" | "reverse" | null>(null);
  const [reason, setReason] = useState("");

  // §7 — LOCKED is a sink, and only a fully paid expense can be closed.
  const lockable = canLock && status === "PAID";
  const reversible = canReverse && status !== "LOCKED" && status !== "REVERSED";

  if (!lockable && !reversible) {
    return status === "LOCKED" ? (
      <Card className="p-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          This expense is locked. It cannot be changed — a correction has to be a new
          expense.
        </p>
      </Card>
    ) : null;
  }

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold tracking-tight">Manage</h2>

      {confirming === "reverse" ? (
        <div className="space-y-2">
          <label
            htmlFor="reverse-reason"
            className="block text-xs text-slate-600 dark:text-slate-400"
          >
            Why is this being reversed? Recorded permanently against both rows.
          </label>
          <input
            id="reverse-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="Wrong amount"
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <div className="flex gap-2">
            <Button
              variant="danger"
              className="flex-1"
              disabled={isPending || reason.trim() === ""}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await reverseExpense({ householdId, expenseId, reason });
                  if (!result.ok) {
                    setError(result.message);
                    return;
                  }
                  router.push(`/households/${householdId}`);
                  router.refresh();
                });
              }}
            >
              {isPending ? "Reversing…" : "Reverse it"}
            </Button>
            <Button
              variant="ghost"
              disabled={isPending}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : confirming === "lock" ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Locking is permanent. Nothing about this expense can change afterwards, and a
            correction would have to be a separate reversing expense.
          </p>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await lockExpense({ householdId, expenseId });
                  if (!result.ok) {
                    setError(result.message);
                    return;
                  }
                  setConfirming(null);
                  router.refresh();
                });
              }}
            >
              {isPending ? "Locking…" : "Lock permanently"}
            </Button>
            <Button
              variant="ghost"
              disabled={isPending}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {lockable ? (
            <Button variant="secondary" onClick={() => setConfirming("lock")}>
              Lock
            </Button>
          ) : null}
          {reversible ? (
            <Button variant="danger" onClick={() => setConfirming("reverse")}>
              Reverse
            </Button>
          ) : null}
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
