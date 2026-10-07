"use client";

import { clearServiceWorkerCaches } from "./service-worker";

/**
 * Sign-out, wrapped so the service worker's caches go with the session.
 *
 * The caches hold no user data by policy (see public/sw.js), but clearing them
 * here makes "signing out leaves nothing on the device" true by construction
 * rather than by review — which matters most on the shared phone this is
 * likeliest to be installed on.
 *
 * The server action is passed in rather than imported, so the actual sign-out
 * still happens on the server.
 */
export function SignOutButton({ action }: { action: () => Promise<void> }) {
  return (
    <form
      action={action}
      onSubmit={() => {
        // Fire and forget: the navigation must not wait on cache eviction, and
        // there is nothing sensitive in there to lose if it does not finish.
        void clearServiceWorkerCaches();
      }}
    >
      <button
        type="submit"
        className="text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
      >
        Sign out
      </button>
    </form>
  );
}
