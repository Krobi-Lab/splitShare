import type { Metadata } from "next";

import { listHouseholds } from "@/lib/households/queries";
import { formatSignedMoney } from "@/lib/money";
import { balanceToneClass, ROLE_TONES, STATUS_BADGE_BASE } from "@/lib/ui/status";

export const metadata: Metadata = {
  title: "Your households",
};

/**
 * The list an accepted invitation lands on.
 *
 * Minimal on purpose: enough to confirm membership took effect and to show each
 * household's net position. The per-household dashboard is not built yet, so
 * nothing here links into one.
 */
export default async function HouseholdsPage() {
  const households = await listHouseholds();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Your households</h1>

      {households.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
          You are not a member of any household yet. Ask someone to invite you, and the
          link in their email will bring you back here.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {households.map((household) => {
            const tone = ROLE_TONES[household.role];
            return (
              <li
                key={household.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{household.name}</p>
                  <p className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className={`${STATUS_BADGE_BASE} ${tone.className}`}>
                      {tone.label}
                    </span>
                    {household.memberCount}{" "}
                    {household.memberCount === 1 ? "member" : "members"}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`font-mono text-sm font-medium ${balanceToneClass(household.yourNetCents)}`}
                  >
                    {formatSignedMoney(household.yourNetCents, household.currency)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {household.yourNetCents > 0
                      ? "owed to you"
                      : household.yourNetCents < 0
                        ? "you owe"
                        : "settled"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
