import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { signIn } from "@/lib/auth";
import { getOptionalUser } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "Sign in · SplitHome",
  description: "Sign in to your household.",
};

/**
 * The page `authConfig.pages.signIn` points at.
 *
 * Auth.js reports failures by redirecting back here with `?error=`, so the
 * codes it can send are mapped to something a person can act on rather than
 * shown raw.
 */
const ERROR_MESSAGES: Record<string, string> = {
  Configuration:
    "Sign-in is not configured correctly. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and AUTH_SECRET.",
  AccessDenied: "You declined the Google sign-in request.",
  OAuthAccountNotLinked:
    "That email is already registered with a different sign-in method.",
  Verification: "That sign-in link has expired. Request a new one.",
};

function errorMessage(error: string | string[] | undefined): string | null {
  if (error === undefined) {
    return null;
  }
  const code = Array.isArray(error) ? error[0] : error;
  return ERROR_MESSAGES[code] ?? "Something went wrong signing you in. Please try again.";
}

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  // Already signed in: nothing to do here.
  if (await getOptionalUser()) {
    redirect("/");
  }

  const { error, callbackUrl } = await searchParams;
  const message = errorMessage(error);
  const redirectTo = typeof callbackUrl === "string" ? callbackUrl : "/";

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-2xl font-semibold tracking-tight">SplitHome</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Share household expenses without the spreadsheet.
          </p>

          {message ? (
            <p
              role="alert"
              className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-600/20 ring-inset dark:bg-red-950 dark:text-red-300 dark:ring-red-400/20"
            >
              {message}
            </p>
          ) : null}

          <form
            className="mt-6"
            action={async () => {
              "use server";
              // Throws a redirect on success, so nothing may catch it here.
              await signIn("google", { redirectTo });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5">
                <path
                  fill="#4285F4"
                  d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3.01h3.88c2.27-2.09 3.58-5.17 3.58-8.82Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.96H1.29v3.12A12 12 0 0 0 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27a7.2 7.2 0 0 1 0-4.54V6.61H1.29a12 12 0 0 0 0 10.78l3.99-3.12Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.61l3.99 3.12C6.22 6.86 8.87 4.75 12 4.75Z"
                />
              </svg>
              Continue with Google
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-500">
          You will only be able to see households you have been invited to.
        </p>
      </div>
    </main>
  );
}
