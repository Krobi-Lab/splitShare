import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectIntegrationDatabase } from "./db";
import { actAs, signOutForTests } from "./session";

import { createHousehold } from "@/actions/households/create";
import { addPlaceholderMember } from "@/actions/households/placeholders";
import { changeRole, removeMember } from "@/actions/households/members";
import { createExpense } from "@/actions/expenses/create";
import { respondToSplit } from "@/actions/expenses/respond";
import { lockExpense } from "@/actions/expenses/lock";
import { reverseExpense } from "@/actions/expenses/reverse";
import { recordPayment } from "@/actions/payments/record";
import { confirmPayment } from "@/actions/payments/confirm";
import type { ActionResult } from "@/lib/actions/result";

/**
 * The §40 acceptance scenario, driven through the real Server Actions.
 *
 * This is the layer nothing else covered. Every action here is the genuine one
 * the app calls; only the session and Next's cache invalidation are stubbed.
 */

const db = await connectIntegrationDatabase();
const describeDb = db ? describe : describe.skip;

afterAll(async () => {
  await db?.prisma.$disconnect();
});

/** Unwraps a successful result, failing loudly with the error message. */
function expectOk<T>(result: ActionResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.code}: ${result.message}`);
  }
  return result.data;
}

function expectFail<T>(result: ActionResult<T>) {
  if (result.ok) {
    throw new Error("expected a failure result");
  }
  return result;
}

/** Creates a real user row and signs in as them. */
async function createUser(
  name: string,
): Promise<{ id: string; name: string; email: string }> {
  const email = `${name.toLowerCase()}@example.test`;
  const user = await db!.prisma.user.upsert({
    where: { email },
    update: {},
    create: { name, email, emailVerified: new Date() },
    select: { id: true, name: true, email: true },
  });
  return { id: user.id, name: user.name!, email: user.email };
}

describeDb("§40 acceptance scenario, through the actions", () => {
  beforeEach(async () => {
    await db!.reset();
  });

  it("runs all eight steps end to end", async () => {
    const { prisma } = db!;

    // 1. Ann signs in and creates household "Flat 3" (NZD).
    const ann = await createUser("Ann");
    actAs(ann);
    const { householdId } = expectOk(
      await createHousehold({ name: "Flat 3", currency: "NZD" }),
    );

    // 2. Bob joins. (The invite link is covered separately; here he is added
    //    directly so this test stays about the expense lifecycle.)
    const bob = await createUser("Bob");
    await prisma.householdMember.create({
      data: { householdId, userId: bob.id, role: "MEMBER" },
    });

    // 3. Ann creates "Groceries", 9000 cents, EQUAL between Ann and Bob.
    const { expenseId, status } = expectOk(
      await createExpense({
        householdId,
        paidByUserId: ann.id,
        categoryId: null,
        description: "Groceries",
        amountCents: 9000,
        currency: "NZD",
        date: new Date("2026-10-07T00:00:00.000Z"),
        splitMethod: "EQUAL",
        participants: [{ userId: ann.id }, { userId: bob.id }],
      }),
    );

    // Ann paid, so her own share is already accepted; Bob's is not. That makes
    // the expense PARTIALLY_ACCEPTED rather than PENDING_ACCEPTANCE.
    expect(status).toBe("PARTIALLY_ACCEPTED");

    const splits = await prisma.expenseSplit.findMany({
      where: { expenseId },
      select: {
        userId: true,
        amountCents: true,
        acceptance: true,
        settledAt: true,
      },
      orderBy: { userId: "asc" },
    });
    expect(splits).toHaveLength(2);
    const bobSplit = splits.find((split) => split.userId === bob.id)!;
    expect(bobSplit.amountCents).toBe(4500n);
    expect(bobSplit.acceptance).toBe("PENDING");
    expect(bobSplit.settledAt).toBeNull();

    // Ann paid the bill, so her own share is settled from the outset — there is
    // nobody for her to pay. Without this the expense could never reach PAID.
    const annSplit = splits.find((split) => split.userId === ann.id)!;
    expect(annSplit.settledAt).not.toBeNull();

    // 4. Bob accepts. Status => ACCEPTED.
    actAs(bob);
    expect(
      expectOk(await respondToSplit({ householdId, expenseId, decision: "ACCEPTED" }))
        .status,
    ).toBe("ACCEPTED");

    // Balances now read +4500 / -4500.
    const beforePayment = await netPositions(householdId);
    expect(beforePayment.get(ann.id)).toBe(4500);
    expect(beforePayment.get(bob.id)).toBe(-4500);

    // 5. Bob records a payment of 4500 to Ann.
    const { paymentId } = expectOk(
      await recordPayment({
        householdId,
        toUserId: ann.id,
        amountCents: 4500,
        currency: "NZD",
        expenseSplitId: (
          await prisma.expenseSplit.findFirstOrThrow({
            where: { expenseId, userId: bob.id },
            select: { id: true },
          })
        ).id,
      }),
    );

    // Unconfirmed, so nothing has moved yet (§9).
    const pending = await netPositions(householdId);
    expect(pending.get(ann.id)).toBe(4500);
    expect(pending.get(bob.id)).toBe(-4500);

    // Bob cannot confirm his own payment — only the recipient may.
    expect(expectFail(await confirmPayment({ householdId, paymentId })).code).toBe(
      "INSUFFICIENT_ROLE",
    );

    // 6. Ann confirms. Expense => PAID, Bob's split settled.
    actAs(ann);
    expect(expectOk(await confirmPayment({ householdId, paymentId })).expenseStatus).toBe(
      "PAID",
    );

    const settledSplit = await prisma.expenseSplit.findFirstOrThrow({
      where: { expenseId, userId: bob.id },
      select: { settledAt: true },
    });
    expect(settledSplit.settledAt).not.toBeNull();

    // 7. Balances read 0 for both, and the audit log has the four entries.
    const after = await netPositions(householdId);
    expect(after.get(ann.id)).toBe(0);
    expect(after.get(bob.id)).toBe(0);

    const actions = await prisma.auditLog.findMany({
      where: { householdId },
      select: { action: true },
    });
    const seen = actions.map((row) => row.action);
    for (const action of [
      "EXPENSE_CREATED",
      "EXPENSE_ACCEPTED",
      "PAYMENT_CREATED",
      "PAYMENT_CONFIRMED",
    ] as const) {
      expect(seen, action).toContain(action);
    }

    // 8. Ann locks it, and further mutation is rejected.
    expectOk(await lockExpense({ householdId, expenseId }));
    expect(
      await prisma.expense.findUniqueOrThrow({
        where: { id: expenseId },
        select: { status: true },
      }),
    ).toEqual({ status: "LOCKED" });

    expect(
      expectFail(
        await reverseExpense({ householdId, expenseId, reason: "changed my mind" }),
      ).code,
    ).toBe("STATE");
  });

  async function netPositions(householdId: string): Promise<Map<string, number>> {
    const rows = await db!.prisma.$queryRaw<
      Array<{ user_id: string; settled_net_cents: bigint }>
    >`
      SELECT user_id, settled_net_cents FROM "household_net_positions"
       WHERE household_id = ${householdId}::uuid
    `;
    return new Map(rows.map((row) => [row.user_id, Number(row.settled_net_cents)]));
  }
});

describeDb("guard chain, through the actions", () => {
  beforeEach(async () => {
    await db!.reset();
  });

  it("refuses an unauthenticated caller", async () => {
    signOutForTests();
    expect(
      expectFail(await createHousehold({ name: "Flat 3", currency: "NZD" })).code,
    ).toBe("UNAUTHENTICATED");
  });

  it("refuses a non-member who knows the household id", async () => {
    const ann = await createUser("Ann");
    actAs(ann);
    const { householdId } = expectOk(
      await createHousehold({ name: "Flat 3", currency: "NZD" }),
    );

    const mallory = await createUser("Mallory");
    actAs(mallory);
    expect(
      expectFail(
        await createExpense({
          householdId,
          paidByUserId: mallory.id,
          categoryId: null,
          description: "Sneaky",
          amountCents: 100,
          currency: "NZD",
          date: new Date(),
          splitMethod: "EQUAL",
          participants: [{ userId: mallory.id }],
        }),
      ).code,
    ).toBe("NOT_A_MEMBER");
  });

  it("refuses a VIEWER the right to create an expense (§5)", async () => {
    const ann = await createUser("Ann");
    actAs(ann);
    const { householdId } = expectOk(
      await createHousehold({ name: "Flat 3", currency: "NZD" }),
    );

    const cal = await createUser("Cal");
    await db!.prisma.householdMember.create({
      data: { householdId, userId: cal.id, role: "VIEWER" },
    });

    actAs(cal);
    expect(
      expectFail(
        await createExpense({
          householdId,
          paidByUserId: cal.id,
          categoryId: null,
          description: "Nope",
          amountCents: 100,
          currency: "NZD",
          date: new Date(),
          splitMethod: "EQUAL",
          participants: [{ userId: cal.id }],
        }),
      ).code,
    ).toBe("INSUFFICIENT_ROLE");
  });

  it("refuses a participant from another household (§2.4d)", async () => {
    const ann = await createUser("Ann");
    actAs(ann);
    const { householdId } = expectOk(
      await createHousehold({ name: "Flat 3", currency: "NZD" }),
    );

    const outsider = await createUser("Outsider");
    expect(
      expectFail(
        await createExpense({
          householdId,
          paidByUserId: ann.id,
          categoryId: null,
          description: "Groceries",
          amountCents: 9000,
          currency: "NZD",
          date: new Date(),
          splitMethod: "EQUAL",
          participants: [{ userId: ann.id }, { userId: outsider.id }],
        }),
      ).code,
    ).toBe("WRONG_HOUSEHOLD");
  });

  it("refuses an expense in a currency the household does not settle in", async () => {
    const ann = await createUser("Ann");
    actAs(ann);
    const { householdId } = expectOk(
      await createHousehold({ name: "Flat 3", currency: "NZD" }),
    );

    const result = expectFail(
      await createExpense({
        householdId,
        paidByUserId: ann.id,
        categoryId: null,
        description: "Duty free",
        amountCents: 9000,
        currency: "USD",
        date: new Date(),
        splitMethod: "EQUAL",
        participants: [{ userId: ann.id }],
      }),
    );
    expect(result.code).toBe("VALIDATION");
    expect(result.fieldErrors?.currency).toBeDefined();
  });

  it("will not let the last admin be demoted or removed", async () => {
    const ann = await createUser("Ann");
    actAs(ann);
    const { householdId } = expectOk(
      await createHousehold({ name: "Flat 3", currency: "NZD" }),
    );

    expect(
      expectFail(await changeRole({ householdId, userId: ann.id, role: "MEMBER" })).code,
    ).toBe("CONFLICT");
    expect(expectFail(await removeMember({ householdId, userId: ann.id })).code).toBe(
      "CONFLICT",
    );
  });
});

describeDb("§8a placeholder members, through the actions", () => {
  beforeEach(async () => {
    await db!.reset();
  });

  it("counts a placeholder's share immediately, with no acceptance step", async () => {
    const { prisma } = db!;
    const ann = await createUser("Ann");
    actAs(ann);
    const { householdId } = expectOk(
      await createHousehold({ name: "Flat 3", currency: "NZD" }),
    );

    const { userId: pukar } = expectOk(
      await addPlaceholderMember({ householdId, name: "Pukar" }),
    );

    // The pasted plan's example: 5941 cents split 4 ways is not 1485 each.
    const { userId: aniket } = expectOk(
      await addPlaceholderMember({ householdId, name: "Aniket" }),
    );
    const { userId: sagar } = expectOk(
      await addPlaceholderMember({ householdId, name: "Sagar" }),
    );

    const { expenseId, status } = expectOk(
      await createExpense({
        householdId,
        paidByUserId: ann.id,
        categoryId: null,
        description: "Grocery",
        amountCents: 5941,
        currency: "NZD",
        date: new Date(),
        splitMethod: "EQUAL",
        participants: [
          { userId: ann.id },
          { userId: pukar },
          { userId: aniket },
          { userId: sagar },
        ],
      }),
    );

    // Nobody has to accept, so it is ACCEPTED on creation.
    expect(status).toBe("ACCEPTED");

    const splits = await prisma.expenseSplit.findMany({
      where: { expenseId },
      select: { amountCents: true, acceptance: true },
    });
    expect(splits.every((split) => split.acceptance === "ACCEPTED")).toBe(true);
    // Exactly 5941, with the leftover cent handed out deterministically.
    expect(splits.reduce((total, split) => total + Number(split.amountCents), 0)).toBe(
      5941,
    );
    expect(
      splits.map((split) => Number(split.amountCents)).sort((a, b) => b - a),
    ).toEqual([1486, 1485, 1485, 1485]);

    // Ann is owed what the other three's shares come to.
    const rows = await prisma.$queryRaw<Array<{ user_id: string; net_cents: bigint }>>`
      SELECT user_id, net_cents FROM "household_balances"
       WHERE household_id = ${householdId}::uuid
    `;
    const nets = new Map(rows.map((row) => [row.user_id, Number(row.net_cents)]));
    expect(
      nets.get(ann.id)! + nets.get(pukar)! + nets.get(aniket)! + nets.get(sagar)!,
    ).toBe(0);

    // Ann is owed the total less her own share. Which participant receives the
    // leftover cent depends on userId order (§2.6), and the ids are random
    // uuids, so her share is read back rather than assumed.
    const annShare = await prisma.expenseSplit.findFirstOrThrow({
      where: { expenseId, userId: ann.id },
      select: { amountCents: true },
    });
    expect(nets.get(ann.id)).toBe(5941 - Number(annShare.amountCents));
  });

  it("lets a manager settle a placeholder's debt and confirm it", async () => {
    const ann = await createUser("Ann");
    actAs(ann);
    const { householdId } = expectOk(
      await createHousehold({ name: "Flat 3", currency: "NZD" }),
    );
    const { userId: pukar } = expectOk(
      await addPlaceholderMember({ householdId, name: "Pukar" }),
    );

    expectOk(
      await createExpense({
        householdId,
        paidByUserId: pukar,
        categoryId: null,
        description: "Grocery",
        amountCents: 1000,
        currency: "NZD",
        date: new Date(),
        splitMethod: "EQUAL",
        participants: [{ userId: ann.id }, { userId: pukar }],
      }),
    );

    // Ann owes Pukar 500 and pays it. Pukar cannot confirm — Ann manages them,
    // so she confirms on their behalf (§8a).
    const { paymentId } = expectOk(
      await recordPayment({
        householdId,
        toUserId: pukar,
        amountCents: 500,
        currency: "NZD",
      }),
    );
    expectOk(await confirmPayment({ householdId, paymentId }));

    const rows = await db!.prisma.$queryRaw<
      Array<{ user_id: string; settled_net_cents: bigint }>
    >`
      SELECT user_id, settled_net_cents FROM "household_net_positions"
       WHERE household_id = ${householdId}::uuid
    `;
    const settled = new Map(
      rows.map((row) => [row.user_id, Number(row.settled_net_cents)]),
    );
    expect(settled.get(ann.id)).toBe(0);
    expect(settled.get(pukar)).toBe(0);
  });
});

describeDb("§8 dispute and §7 reversal, through the actions", () => {
  beforeEach(async () => {
    await db!.reset();
  });

  it("disputes an expense on rejection and drops it out of balances", async () => {
    const { prisma } = db!;
    const ann = await createUser("Ann");
    const bob = await createUser("Bob");
    actAs(ann);
    const { householdId } = expectOk(
      await createHousehold({ name: "Flat 3", currency: "NZD" }),
    );
    await prisma.householdMember.create({
      data: { householdId, userId: bob.id, role: "MEMBER" },
    });

    const { expenseId } = expectOk(
      await createExpense({
        householdId,
        paidByUserId: ann.id,
        categoryId: null,
        description: "Groceries",
        amountCents: 9000,
        currency: "NZD",
        date: new Date(),
        splitMethod: "EQUAL",
        participants: [{ userId: ann.id }, { userId: bob.id }],
      }),
    );

    actAs(bob);
    expect(
      expectOk(
        await respondToSplit({
          householdId,
          expenseId,
          decision: "REJECTED",
          rejectionReason: "I was away that week",
        }),
      ).status,
    ).toBe("DISPUTED");

    // A disputed expense must not charge anybody.
    const rows = await prisma.$queryRaw<Array<{ user_id: string; net_cents: bigint }>>`
      SELECT user_id, net_cents FROM "household_balances"
       WHERE household_id = ${householdId}::uuid
    `;
    expect(rows.every((row) => Number(row.net_cents) === 0)).toBe(true);

    // And the creator was told.
    const notifications = await prisma.notification.findMany({
      where: { userId: ann.id },
      select: { type: true },
    });
    expect(notifications.map((row) => row.type)).toContain("SPLIT_REJECTED");

    // Re-deciding is refused — a split is immutable once decided (§2.2).
    expect(
      expectFail(await respondToSplit({ householdId, expenseId, decision: "ACCEPTED" }))
        .code,
    ).toBe("CONFLICT");
  });

  it("returns every balance to zero after a reversal", async () => {
    const { prisma } = db!;
    const ann = await createUser("Ann");
    const bob = await createUser("Bob");
    actAs(ann);
    const { householdId } = expectOk(
      await createHousehold({ name: "Flat 3", currency: "NZD" }),
    );
    await prisma.householdMember.create({
      data: { householdId, userId: bob.id, role: "MEMBER" },
    });

    const { expenseId } = expectOk(
      await createExpense({
        householdId,
        paidByUserId: ann.id,
        categoryId: null,
        description: "Groceries",
        amountCents: 9001,
        currency: "NZD",
        date: new Date(),
        splitMethod: "EQUAL",
        participants: [{ userId: ann.id }, { userId: bob.id }],
      }),
    );
    actAs(bob);
    expectOk(await respondToSplit({ householdId, expenseId, decision: "ACCEPTED" }));

    actAs(ann);
    const { reversalExpenseId } = expectOk(
      await reverseExpense({ householdId, expenseId, reason: "Wrong card" }),
    );

    // The reversal is the exact negation, to the cent.
    const original = await prisma.expenseSplit.findMany({
      where: { expenseId },
      select: { userId: true, amountCents: true },
      orderBy: { userId: "asc" },
    });
    const reversal = await prisma.expenseSplit.findMany({
      where: { expenseId: reversalExpenseId },
      select: { userId: true, amountCents: true },
      orderBy: { userId: "asc" },
    });
    expect(reversal.map((split) => split.amountCents)).toEqual(
      original.map((split) => -split.amountCents),
    );

    const rows = await prisma.$queryRaw<Array<{ user_id: string; net_cents: bigint }>>`
      SELECT user_id, net_cents FROM "household_balances"
       WHERE household_id = ${householdId}::uuid
    `;
    for (const row of rows) {
      expect(Number(row.net_cents), row.user_id).toBe(0);
    }

    // Reversing twice is refused.
    expect(
      expectFail(await reverseExpense({ householdId, expenseId, reason: "again" })).code,
    ).toBe("CONFLICT");
  });
});
