import Link from "next/link";

import { signOut } from "@/lib/auth";
import { getOptionalUser } from "@/lib/auth/guards";

export default async function Home() {
  const user = await getOptionalUser();

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">SplitHome</h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
          Share household expenses without the spreadsheet. Every amount is tracked to the
          cent, every split is agreed by the people paying it, and balances are always
          derived from the record rather than edited by hand.
        </p>

        {user ? (
          <div className="mt-10">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Signed in as{" "}
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {user.name ?? user.email}
              </span>
            </p>
            <form
              className="mt-4"
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <Link
            href="/signin"
            className="mt-10 inline-flex items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            Sign in
          </Link>
        )}
      </div>
    </main>
  );
}
