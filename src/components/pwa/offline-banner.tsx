"use client";

import { useOffline } from "next/offline";

/**
 * A persistent banner while the device has no connectivity.
 *
 * `useOffline` is part of Next 16's `experimental.useOffline`, enabled in
 * next.config.ts. That flag also retries navigation, prefetch and Server Action
 * requests that were blocked while offline — so this banner explains a wait
 * that the framework is already handling, rather than asking the user to retry
 * themselves.
 *
 * It returns false during server rendering and until hydration, so nothing
 * flashes on a good connection.
 */
export function OfflineBanner() {
  const isOffline = useOffline();

  if (!isOffline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400"
      />
      No connection. Anything you submit will be sent when you are back online.
    </div>
  );
}
