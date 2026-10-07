import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { AppHeader } from "@/components/layout/app-header";
import { HouseholdNav } from "@/components/layout/household-nav";
import { InsufficientRoleError, NotAMemberError } from "@/lib/auth/errors";
import { requireAuth, requireCapability } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { getHousehold } from "@/lib/households/queries";

export const metadata: Metadata = { title: "Add an expense" };

export default async function NewExpensePage({
  params,
}: PageProps<"/households/[householdId]/expenses/new">) {
  const { householdId } = await params;
  const viewer = await requireAuth();

  try {
    // §5 — a VIEWER has no business on this page at all, so it is refused here
    // rather than only when the form is submitted.
    await requireCapability(householdId, "CREATE_EXPENSE");
  } catch (error) {
    if (error instanceof NotAMemberError || error instanceof InsufficientRoleError) {
      notFound();
    }
    throw error;
  }

  const [household, categories] = await Promise.all([
    getHousehold(householdId),
    prisma.category.findMany({
      where: { householdId, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <AppHeader householdName={household.name} role={household.yourRole} />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4 pb-24">
        <h1 className="mb-4 text-xl font-semibold tracking-tight">Add an expense</h1>
        <ExpenseForm
          householdId={householdId}
          currency={household.currency}
          viewerUserId={viewer.id}
          categories={categories}
          members={household.members.map((member) => ({
            userId: member.userId,
            name: member.name ?? member.email,
            // The form labels these "(tracked)", since nobody will accept for
            // them — their share counts straight away (§8a).
            isPlaceholder: member.email.endsWith("@splithome.invalid"),
          }))}
        />
      </main>
      <HouseholdNav householdId={householdId} />
    </>
  );
}
