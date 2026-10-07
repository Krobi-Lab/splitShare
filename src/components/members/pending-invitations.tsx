"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { revokeInvitation } from "@/actions/households/invite";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import type { PendingInvitation } from "@/lib/households/queries";

export function PendingInvitations({
  householdId,
  invitations,
}: {
  householdId: string;
  invitations: PendingInvitation[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold tracking-tight">Pending invitations</h2>
      </div>

      {invitations.length === 0 ? (
        <EmptyState
          title="No invitations outstanding"
          body="Anyone you invite shows here until they accept, and you can withdraw it."
        />
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{invitation.email}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Invited as {invitation.role.toLowerCase()} · expires{" "}
                  {invitation.expiresAt.toLocaleDateString("en-NZ", {
                    day: "numeric",
                    month: "short",
                  })}
                </p>
              </div>
              <Button
                variant="ghost"
                disabled={isPending}
                className="min-h-9 px-3 text-xs"
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await revokeInvitation({
                      householdId,
                      invitationId: invitation.id,
                    });
                    if (!result.ok) {
                      setError(result.message);
                      return;
                    }
                    router.refresh();
                  });
                }}
              >
                Withdraw
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
