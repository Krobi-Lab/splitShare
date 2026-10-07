"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Bottom tab bar inside a household.
 *
 * At the bottom rather than the top because this is a phone app first: in a
 * standalone window there is no browser chrome, and the bottom edge is where a
 * thumb reaches. It sits above the home-indicator inset, which the body's
 * safe-area padding already accounts for.
 */
const TABS = [
  { segment: "", label: "Home" },
  { segment: "/payments", label: "Payments" },
  { segment: "/members", label: "Members" },
];

export function HouseholdNav({ householdId }: { householdId: string }) {
  const pathname = usePathname();
  const base = `/households/${householdId}`;

  return (
    <nav
      aria-label="Household"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
    >
      <ul className="mx-auto flex w-full max-w-2xl">
        {TABS.map((tab) => {
          const href = `${base}${tab.segment}`;
          // "Home" must not stay highlighted on every child route.
          const active =
            tab.segment === "" ? pathname === base : pathname.startsWith(href);
          return (
            <li key={tab.label} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 items-center justify-center text-sm font-medium ${
                  active
                    ? "text-slate-900 dark:text-slate-100"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
