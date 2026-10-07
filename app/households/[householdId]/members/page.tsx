import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/layout/app-header";
import { HouseholdNav } from "@/components/layout/household-nav";
import { AddMember } from "@/components/members/add-member";
import { MemberRow } from "@/components/members/member-row";
import { PendingInvitations } from "@/components/members/pending-invitations";
import { Card } from "@/components/ui/card";
import { NotAMemberError } from "@/lib/auth/errors";
import { requireAuth } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { getHousehold, listPendingInvitations } from "@/lib/households/queries";
import { isPlaceholderEmail } from "@/lib/households/placeholders";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({
  params,
}: PageProps<"/households/[householdId]/members">) {
  const { householdId } = await params;
  const viewer = await requireAuth();

  let household;
  try {
    household = await getHousehold(householdId);
  } catch (error) {
    if (error instanceof NotAMemberError) {
      notFound();
    }
    throw error;
  }

  const canManage = can(household.yourRole, "MANAGE_MEMBERS");
  // §5 — pending invitations are admin-only data, so they are not even fetched
  // for anyone else.
  const invitations = canManage ? await listPendingInvitations(householdId) : [];

  return (
    <>
      <AppHeader householdName={household.name} role={household.yourRole} />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4 pb-24">
        <h1 className="text-xl font-semibold tracking-tight">Members</h1>

        {canManage ? <AddMember householdId={householdId} /> : null}

        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h2 className="text-sm font-semibold tracking-tight">
              {household.members.length}{" "}
              {household.members.length === 1 ? "member" : "members"}
            </h2>
          </div>
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {household.members.map((member) => (
              <MemberRow
                key={member.userId}
                householdId={householdId}
                member={member}
                currency={household.currency}
                isPlaceholder={isPlaceholderEmail(member.email)}
                canManage={canManage}
                isYou={member.userId === viewer.id}
              />
            ))}
          </ul>
        </Card>

        {canManage ? (
          <PendingInvitations householdId={householdId} invitations={invitations} />
        ) : null}
      </main>
      <HouseholdNav householdId={householdId} />
    </>
  );
}
