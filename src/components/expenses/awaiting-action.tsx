"use client";

import { useState, useTransition } from "react";

import { respondToSplit } from "@/actions/expenses/respond";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import type { AwaitingAction } from "@/lib/expenses/queries";
import { formatMoney } from "@/lib/money";

/**
 * §40 step 4 — "Awaiting Your Action".
 *
 * Accepting is one tap. Rejecting asks for a reason first, because a rejection
 * puts the whole expense into DISPUTED and tells whoever created it (§8); the
 * person on the other end needs to know what to fix.
 */
export function AwaitingActionList({
  householdId,
  items,
}: {
  householdId: string;
  items: AwaitingAction[];
}) {
  if (items.length === 0) {
    return (
      <Card>
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold tracking-tight">Awaiting your action</h2>
        </div>
        <EmptyState
          title="Nothing to review"
          body="Shares other people add for you will show up here before they count toward balances."
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold tracking-tight">
          Awaiting your action
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {items.length}
          </span>
        </h2>
      </div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {items.map((item) => (
          <AwaitingActionRow
            key={`${item.expenseId}-${item.onBehalfOfUserId ?? "self"}`}
            householdId={householdId}
            item={item}
          />
        ))}
      </ul>
    </Card>
  );
}

function AwaitingActionRow({
  householdId,
  item,
}: {
  householdId: string;
  item: AwaitingAction;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  function respond(decision: "ACCEPTED" | "REJECTED") {
    setError(null);
    startTransition(async () => {
      const result = await respondToSplit({
        householdId,
        expenseId: item.expenseId,
        decision,
        rejectionReason: decision === "REJECTED" ? reason : undefined,
        onBehalfOfUserId: item.onBehalfOfUserId ?? undefined,
      });
      if (!result.ok) {
        setError(result.message);
      }
    });
  }

  return (
    <li className="px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{item.description}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {item.paidByName} paid {formatMoney(item.amountCents, item.currency)}
            {item.onBehalfOfName ? ` · for ${item.onBehalfOfName}` : ""}
          </p>
        </div>
        <p className="shrink-0 font-mono text-sm font-medium tabular-nums">
          {formatMoney(item.yourShareCents, item.currency)}
        </p>
      </div>

      {rejecting ? (
        <div className="mt-3">
          <label
            htmlFor={`reason-${item.expenseId}`}
            className="text-xs text-slate-600 dark:text-slate-400"
          >
            Why are you rejecting this? The person who added it will see this.
          </label>
          <textarea
            id={`reason-${item.expenseId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        {rejecting ? (
          <>
            <Button
              variant="danger"
              disabled={isPending}
              onClick={() => respond("REJECTED")}
              className="flex-1"
            >
              {isPending ? "Rejecting…" : "Confirm rejection"}
            </Button>
            <Button
              variant="ghost"
              disabled={isPending}
              onClick={() => setRejecting(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={isPending}
              onClick={() => respond("ACCEPTED")}
              className="flex-1"
            >
              {isPending ? "Accepting…" : "Accept"}
            </Button>
            <Button
              variant="secondary"
              disabled={isPending}
              onClick={() => setRejecting(true)}
            >
              Reject
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
