import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AwaitingActionList } from "@/components/expenses/awaiting-action";
import { ExpenseList } from "@/components/expenses/expense-list";
import { AppHeader } from "@/components/layout/app-header";
import { HouseholdNav } from "@/components/layout/household-nav";
import { BalanceSummary, SettleUpPlan } from "@/components/dashboard/balance-summary";
import { NotAMemberError } from "@/lib/auth/errors";
import { requireAuth } from "@/lib/auth/guards";
import { listAwaitingYourAction, listExpenses } from "@/lib/expenses/queries";
import { getHousehold } from "@/lib/households/queries";

export const metadata: Metadata = {
  title: "Household",
};

/**
 * The household dashboard.
 *
 * Everything on it is derived: balances come from the §12 views, and the
 * settle-up plan from the pure minimiser. Nothing here stores or recomputes
 * money.
 */
export default async function HouseholdPage({
  params,
}: PageProps<"/households/[householdId]">) {
  const { householdId } = await params;
  const viewer = await requireAuth();

  let household;
  try {
    household = await getHousehold(householdId);
  } catch (error) {
    // A household the viewer is not in must look missing, not forbidden (§2.4d).
    if (error instanceof NotAMemberError) {
      notFound();
    }
    throw error;
  }

  const [awaiting, expenses] = await Promise.all([
    listAwaitingYourAction(householdId),
    listExpenses(householdId, { limit: 20 }),
  ]);

  return (
    <>
      <AppHeader householdName={household.name} role={household.yourRole} />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4 pb-24">
        <BalanceSummary
          members={household.members}
          currency={household.currency}
          viewerUserId={viewer.id}
        />

        <AwaitingActionList householdId={householdId} items={awaiting} />

        <SettleUpPlan
          members={household.members}
          currency={household.currency}
          viewerUserId={viewer.id}
        />

        <ExpenseList householdId={householdId} expenses={expenses} />
      </main>
      <HouseholdNav householdId={householdId} />
    </>
  );
}
