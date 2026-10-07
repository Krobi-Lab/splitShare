import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { acceptInvitation } from "@/actions/households/accept-invite";
import { getOptionalUser } from "@/lib/auth/guards";
import { previewInvitation } from "@/lib/invitations/preview";
import { ROLE_TONES, STATUS_BADGE_BASE } from "@/lib/ui/status";

export const metadata: Metadata = {
  title: "Invitation",
  description: "Join a household on SplitHome.",
};

/** The page every invitation email links to (§40 step 2). */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const [invitation, user] = await Promise.all([
    previewInvitation(token),
    getOptionalUser(),
  ]);

  if (invitation.state === "NOT_FOUND") {
    return (
      <Shell heading="That link is not valid">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          The invitation link looks incomplete or has already been replaced. Ask an admin
          of the household to send you a new one.
        </p>
      </Shell>
    );
  }

  if (invitation.state === "UNUSABLE") {
    return (
      <Shell heading="This invitation cannot be used">
        <p className="text-sm text-slate-600 dark:text-slate-400">{invitation.message}</p>
      </Shell>
    );
  }

  const tone = ROLE_TONES[invitation.role];

  // Not signed in: send them through Google and back here afterwards.
  if (!user) {
    return (
      <Shell heading={`Join ${invitation.householdName}`}>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {invitation.inviterName} invited you as a{" "}
          <span className={`${STATUS_BADGE_BASE} ${tone.className}`}>{tone.label}</span>.
          Sign in to accept.
        </p>
        <Link
          href={`/signin?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`}
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          Sign in to accept
        </Link>
      </Shell>
    );
  }

  return (
    <Shell heading={`Join ${invitation.householdName}`}>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {invitation.inviterName} invited you as a{" "}
        <span className={`${STATUS_BADGE_BASE} ${tone.className}`}>{tone.label}</span>.{" "}
        {tone.description}
      </p>

      {/* The invitation was addressed elsewhere. Accepting is still allowed —
          possession of the token is the authorisation — but saying so avoids a
          surprise, and both addresses go into the audit trail. */}
      {user.email && user.email.toLowerCase() !== invitation.email.toLowerCase() ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-600/20 ring-inset dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-400/20">
          This invitation was sent to {invitation.email}, and you are signed in as{" "}
          {user.email}. You can still accept it.
        </p>
      ) : null}

      <form
        className="mt-6"
        action={async () => {
          "use server";
          const result = await acceptInvitation({ token });
          if (!result.ok) {
            redirect(`/invite/${token}?error=${encodeURIComponent(result.message)}`);
          }
          redirect("/households");
        }}
      >
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          Accept invitation
        </button>
      </form>
    </Shell>
  );
}

function Shell({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <div className="mt-3">{children}</div>
      </div>
    </main>
  );
}
