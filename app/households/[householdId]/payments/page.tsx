import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/layout/app-header";
import { HouseholdNav } from "@/components/layout/household-nav";
import { ConfirmPayments } from "@/components/payments/confirm-payments";
import { RecordPayment } from "@/components/payments/record-payment";
import { PaymentStatusBadge } from "@/components/ui/badge";
import { Card, EmptyState } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { NotAMemberError } from "@/lib/auth/errors";
import { requireAuth } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { getHousehold } from "@/lib/households/queries";
import { listPayments, listPaymentsAwaitingYou } from "@/lib/payments/queries";
import { minimizeTransfers } from "@/lib/settlements/minimize";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({
  params,
}: PageProps<"/households/[householdId]/payments">) {
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

  const [awaiting, recent] = await Promise.all([
    listPaymentsAwaitingYou(householdId),
    listPayments(householdId, 25),
  ]);

  // What the viewer owes each person, from the settle-up plan, so the record
  // form can prefill the amount that actually clears the debt.
  const positions = household.members.map((member) => ({
    userId: member.userId,
    netCents: member.settledNetCents,
  }));
  let owedByYou = new Map<string, number>();
  try {
    owedByYou = new Map(
      minimizeTransfers(positions)
        .filter((transfer) => transfer.fromUserId === viewer.id)
        .map((transfer) => [transfer.toUserId, transfer.amountCents]),
    );
  } catch {
    // The dashboard already reports balances that do not sum to zero.
  }

  const canPay = can(household.yourRole, "RECORD_OWN_PAYMENT");

  return (
    <>
      <AppHeader householdName={household.name} role={household.yourRole} />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4 pb-24">
        <h1 className="text-xl font-semibold tracking-tight">Payments</h1>

        {canPay ? (
          <ConfirmPayments householdId={householdId} payments={awaiting} />
        ) : null}

        {canPay ? (
          <RecordPayment
            householdId={householdId}
            currency={household.currency}
            members={household.members
              .filter((member) => member.userId !== viewer.id)
              .map((member) => ({
                userId: member.userId,
                name: member.name ?? member.email,
                youOweCents: owedByYou.get(member.userId) ?? 0,
              }))}
          />
        ) : null}

        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h2 className="text-sm font-semibold tracking-tight">History</h2>
          </div>
          {recent.length === 0 ? (
            <EmptyState
              title="No payments yet"
              body="Payments between members show here once somebody records one."
            />
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {recent.map((payment) => (
                <li key={payment.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {payment.fromUserId === viewer.id ? "You" : payment.fromName}
                      <span className="mx-2 text-slate-400">→</span>
                      {payment.toUserId === viewer.id ? "you" : payment.toName}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {payment.paidAt.toLocaleDateString("en-NZ", {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </div>
                  <PaymentStatusBadge status={payment.status} />
                  <Money
                    cents={payment.amountCents}
                    currency={payment.currency}
                    className="w-24 shrink-0 text-right text-sm"
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
      <HouseholdNav householdId={householdId} />
    </>
  );
}
