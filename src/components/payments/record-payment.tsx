"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { recordPayment } from "@/actions/payments/record";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMoney, parseMoneyInput, toMoneyInput } from "@/lib/money";

export interface PayableMember {
  userId: string;
  name: string;
  /** Positive when you owe them. Used to prefill the amount. */
  youOweCents: number;
}

/**
 * Records a payment you have made (§40 step 5).
 *
 * The amount is prefilled with what you actually owe that person, since settling
 * a round number is the exception. Recording it does not move any balance —
 * only the recipient confirming it does (§9) — and the form says so, because an
 * unchanged balance afterwards would otherwise look like a bug.
 */
export function RecordPayment({
  householdId,
  currency,
  members,
}: {
  householdId: string;
  currency: string;
  members: PayableMember[];
}) {
  const router = useRouter();
  const owed = members.filter((member) => member.youOweCents > 0);
  const [toUserId, setToUserId] = useState(owed[0]?.userId ?? members[0]?.userId ?? "");
  const [amountText, setAmountText] = useState(() =>
    owed[0] ? toMoneyInput(owed[0].youOweCents, currency) : "",
  );
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const amountCents = parseMoneyInput(amountText, currency);

  function pick(userId: string) {
    setToUserId(userId);
    const member = members.find((candidate) => candidate.userId === userId);
    if (member && member.youOweCents > 0) {
      setAmountText(toMoneyInput(member.youOweCents, currency));
    }
  }

  if (members.length === 0) {
    return null;
  }

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold tracking-tight">Record a payment</h2>

      <div>
        <label
          htmlFor="pay-to"
          className="block text-xs font-medium text-slate-600 dark:text-slate-400"
        >
          Paid to
        </label>
        <select
          id="pay-to"
          value={toUserId}
          onChange={(event) => pick(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
        >
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
              {member.youOweCents > 0
                ? ` — you owe ${formatMoney(member.youOweCents, currency)}`
                : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="pay-amount"
            className="block text-xs font-medium text-slate-600 dark:text-slate-400"
          >
            Amount ({currency})
          </label>
          <input
            id="pay-amount"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            inputMode="decimal"
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
        <div>
          <label
            htmlFor="pay-method"
            className="block text-xs font-medium text-slate-600 dark:text-slate-400"
          >
            How
          </label>
          <select
            id="pay-method"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
      </div>

      <div>
        <label
          htmlFor="pay-note"
          className="block text-xs font-medium text-slate-600 dark:text-slate-400"
        >
          Note (optional)
        </label>
        <input
          id="pay-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <Button
        className="w-full"
        disabled={
          isPending || amountCents === null || amountCents <= 0 || toUserId === ""
        }
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await recordPayment({
              householdId,
              toUserId,
              amountCents,
              currency,
              method,
              note: note.trim() === "" ? undefined : note,
            });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setNote("");
            router.refresh();
          });
        }}
      >
        {isPending ? "Recording…" : "Record payment"}
      </Button>

      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
        Balances only change once they confirm it.
      </p>
    </Card>
  );
}
