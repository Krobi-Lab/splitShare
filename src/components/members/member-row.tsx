"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { changeRole, removeMember } from "@/actions/households/members";
import { RoleBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Balance } from "@/components/ui/money";
import type { HouseholdRole } from "@/generated/prisma/enums";
import type { MemberBalance } from "@/lib/households/queries";

const ROLES: HouseholdRole[] = ["ADMIN", "MEMBER", "VIEWER"];

/**
 * One member, with the admin controls when the viewer is an admin (§5).
 *
 * The actions refuse to strip the last admin, so the UI does not need to guess
 * at that rule — it just surfaces whatever the server says.
 */
export function MemberRow({
  householdId,
  member,
  currency,
  isPlaceholder,
  canManage,
  isYou,
}: {
  householdId: string;
  member: MemberBalance;
  currency: string;
  isPlaceholder: boolean;
  canManage: boolean;
  isYou: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message ?? "That did not work.");
        return;
      }
      setConfirmingRemove(false);
      router.refresh();
    });
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {member.name ?? member.email}
            {isYou ? <span className="ml-1 text-xs text-slate-400">(you)</span> : null}
            {isPlaceholder ? (
              <span className="ml-1 text-xs text-slate-400">(tracked)</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {isPlaceholder ? "No account — you act for them" : member.email}
          </p>
        </div>
        <RoleBadge role={member.role} />
        <Balance
          cents={member.settledNetCents}
          currency={currency}
          className="w-24 shrink-0 text-right text-sm"
        />
      </div>

      {canManage ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!isPlaceholder ? (
            <select
              value={member.role}
              disabled={isPending}
              onChange={(event) =>
                run(() =>
                  changeRole({
                    householdId,
                    userId: member.userId,
                    role: event.target.value as HouseholdRole,
                  }),
                )
              }
              className="min-h-9 rounded-lg border border-slate-300 px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          ) : null}

          {confirmingRemove ? (
            <>
              <span className="text-xs text-slate-600 dark:text-slate-400">
                Remove? Their expenses stay on the record.
              </span>
              <Button
                variant="danger"
                disabled={isPending}
                className="min-h-9 px-3 text-xs"
                onClick={() =>
                  run(() => removeMember({ householdId, userId: member.userId }))
                }
              >
                Confirm
              </Button>
              <Button
                variant="ghost"
                disabled={isPending}
                className="min-h-9 px-3 text-xs"
                onClick={() => setConfirmingRemove(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              disabled={isPending}
              className="min-h-9 px-3 text-xs"
              onClick={() => setConfirmingRemove(true)}
            >
              Remove
            </Button>
          )}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </li>
  );
}
