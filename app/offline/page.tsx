import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline",
  description: "You are offline.",
};

/**
 * The service worker's navigation fallback.
 *
 * Precached on install, so it has to be a static shell: no session, no
 * database, nothing household-specific. It deliberately does not show cached
 * balances, because nothing about a signed-in page is cached — see public/sw.js.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <div
          aria-hidden="true"
          className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950"
        >
          <span className="size-3 rounded-full bg-amber-500 dark:bg-amber-400" />
        </div>
        <h1 className="mt-6 text-xl font-semibold tracking-tight">You are offline</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          SplitHome needs a connection to show balances, because they are worked out from
          the shared record rather than stored on this device.
        </p>
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
          This page will work again as soon as you are back online.
        </p>
      </div>
    </main>
  );
}
