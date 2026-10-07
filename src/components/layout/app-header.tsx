import Link from "next/link";

import { RoleBadge } from "@/components/ui/badge";
import type { HouseholdRole } from "@/generated/prisma/enums";

/**
 * The header inside a household.
 *
 * Sticky, because in a standalone PWA window there is no browser back button —
 * the way out has to be on the page.
 */
export function AppHeader({
  householdName,
  role,
}: {
  householdName: string;
  role: HouseholdRole;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
        <Link
          href="/households"
          aria-label="All households"
          className="-ml-2 flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <span aria-hidden="true">←</span>
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
          {householdName}
        </h1>
        <RoleBadge role={role} />
      </div>
    </header>
  );
}
