import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDatabase, seedAcceptedExpense, seedHousehold } from "./helpers";

/**
 * §10 / §12 database-layer tests.
 *
 * These assert the guarantees that live in SQL rather than in TypeScript: the
 * append-only triggers, the deferred split-sum assertion, and the derived
 * balance views. They skip cleanly without a database (§22) — see helpers.ts.
 */

const db = await connectTestDatabase();
const describeDb = db ? describe : describe.skip;

afterAll(async () => {
  await db?.prisma.$disconnect();
});

describeDb("§10 append-only tables", () => {
  beforeEach(async () => {
    await db!.reset();
  });

  async function seedPayment(): Promise<{
    paymentId: string;
    householdId: string;
    ann: string;
    bob: string;
  }> {
    const { prisma } = db!;
    const { householdId, userIds } = await seedHousehold(prisma, ["Ann", "Bob"]);
    const [{ id: paymentId }] = await prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO "payments" (
        id, household_id, from_user_id, to_user_id, amount_cents, currency,
        method, paid_at, created_at
      )
      VALUES (
        gen_random_uuid(), ${householdId}::uuid, ${userIds.Bob}::uuid,
        ${userIds.Ann}::uuid, 4500, 'NZD', 'BANK_TRANSFER', now(), now()
      )
      RETURNING id
    `;
    return { paymentId, householdId, ann: userIds.Ann, bob: userIds.Bob };
  }

  it("rejects an UPDATE on payments", async () => {
    const { paymentId } = await seedPayment();
    await expect(
      db!.prisma
        .$executeRaw`UPDATE "payments" SET amount_cents = 1 WHERE id = ${paymentId}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it("rejects a DELETE on payments", async () => {
    const { paymentId } = await seedPayment();
    await expect(
      db!.prisma.$executeRaw`DELETE FROM "payments" WHERE id = ${paymentId}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it("rejects an UPDATE on payment_confirmations", async () => {
    const { paymentId, ann } = await seedPayment();
    await db!.prisma.$executeRaw`
      INSERT INTO "payment_confirmations" (id, payment_id, confirmed_by_user_id, confirmed_at)
      VALUES (gen_random_uuid(), ${paymentId}::uuid, ${ann}::uuid, now())
    `;
    await expect(
      db!.prisma.$executeRaw`
        UPDATE "payment_confirmations" SET confirmed_at = now() WHERE payment_id = ${paymentId}::uuid
      `,
    ).rejects.toThrow(/append-only/);
  });

  it("rejects an UPDATE and a DELETE on audit_logs", async () => {
    const { prisma } = db!;
    const { householdId, userIds } = await seedHousehold(prisma, ["Ann"]);
    const [{ id }] = await prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO "audit_logs" (
        id, household_id, actor_user_id, action, entity_type, entity_id, created_at
      )
      VALUES (
        gen_random_uuid(), ${householdId}::uuid, ${userIds.Ann}::uuid,
        'HOUSEHOLD_CREATED', 'household', ${householdId}::uuid, now()
      )
      RETURNING id
    `;
    await expect(
      prisma.$executeRaw`UPDATE "audit_logs" SET action = 'ROLE_CHANGED' WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRaw`DELETE FROM "audit_logs" WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it("still allows a reversal row, which is how a payment is cancelled", async () => {
    const { prisma } = db!;
    const { paymentId, householdId, ann, bob } = await seedPayment();
    await prisma.$executeRaw`
      INSERT INTO "payments" (
        id, household_id, from_user_id, to_user_id, amount_cents, currency,
        method, reverses_payment_id, paid_at, created_at
      )
      VALUES (
        gen_random_uuid(), ${householdId}::uuid, ${bob}::uuid, ${ann}::uuid,
        -4500, 'NZD', 'BANK_TRANSFER', ${paymentId}::uuid, now(), now()
      )
    `;
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM "payments"
    `;
    expect(Number(rows[0].count)).toBe(2);
  });
});

describeDb("§10 deferred split-sum assertion", () => {
  beforeEach(async () => {
    await db!.reset();
  });

  it("accepts an expense written before its splits, because the check is deferred", async () => {
    const { prisma } = db!;
    const { householdId, userIds } = await seedHousehold(prisma, ["Ann", "Bob"]);

    // The expense row is momentarily unbalanced (no splits yet) inside the
    // transaction; only the state at COMMIT has to add up.
    await expect(
      prisma.$transaction(async (tx) => {
        const [{ id }] = await tx.$queryRaw<[{ id: string }]>`
          INSERT INTO "expenses" (
            id, household_id, paid_by_user_id, created_by_user_id, description,
            amount_cents, currency, date, split_method, created_at, updated_at
          )
          VALUES (
            gen_random_uuid(), ${householdId}::uuid, ${userIds.Ann}::uuid,
            ${userIds.Ann}::uuid, 'Groceries', 9000, 'NZD', CURRENT_DATE,
            'EQUAL', now(), now()
          )
          RETURNING id
        `;
        for (const userId of [userIds.Ann, userIds.Bob]) {
          await tx.$executeRaw`
            INSERT INTO "expense_splits" (id, expense_id, user_id, amount_cents, created_at)
            VALUES (gen_random_uuid(), ${id}::uuid, ${userId}::uuid, 4500, now())
          `;
        }
      }),
    ).resolves.toBeUndefined();
  });

  it("fires on an expenses row too, not only on expense_splits", async () => {
    // Regression: the original trigger function served both tables and chose the
    // expense id with a CASE on TG_TABLE_NAME. plpgsql plans an expression as a
    // whole, so `NEW.expense_id` was resolved even when firing on `expenses`,
    // which has no such column — ERROR 42703. Updating an expense's amount
    // without touching its splits exercises that path.
    const { prisma } = db!;
    const { householdId, userIds } = await seedHousehold(prisma, ["Ann", "Bob"]);
    const expenseId = await seedAcceptedExpense(prisma, {
      householdId,
      paidByUserId: userIds.Ann,
      amountCents: 9000,
      splits: [
        { userId: userIds.Ann, amountCents: 4500 },
        { userId: userIds.Bob, amountCents: 4500 },
      ],
    });

    await expect(
      prisma.$executeRaw`
        UPDATE "expenses" SET amount_cents = 9500 WHERE id = ${expenseId}::uuid
      `,
    ).rejects.toThrow(/splits summing to 9000 but a total of 9500/);
  });

  it("rejects at COMMIT when the splits do not sum to the expense total", async () => {
    const { prisma } = db!;
    const { householdId, userIds } = await seedHousehold(prisma, ["Ann", "Bob"]);

    await expect(
      prisma.$transaction(async (tx) => {
        const [{ id }] = await tx.$queryRaw<[{ id: string }]>`
          INSERT INTO "expenses" (
            id, household_id, paid_by_user_id, created_by_user_id, description,
            amount_cents, currency, date, split_method, created_at, updated_at
          )
          VALUES (
            gen_random_uuid(), ${householdId}::uuid, ${userIds.Ann}::uuid,
            ${userIds.Ann}::uuid, 'Groceries', 9000, 'NZD', CURRENT_DATE,
            'EQUAL', now(), now()
          )
          RETURNING id
        `;
        // 4500 + 4000 = 8500, not 9000.
        await tx.$executeRaw`
          INSERT INTO "expense_splits" (id, expense_id, user_id, amount_cents, created_at)
          VALUES (gen_random_uuid(), ${id}::uuid, ${userIds.Ann}::uuid, 4500, now())
        `;
        await tx.$executeRaw`
          INSERT INTO "expense_splits" (id, expense_id, user_id, amount_cents, created_at)
          VALUES (gen_random_uuid(), ${id}::uuid, ${userIds.Bob}::uuid, 4000, now())
        `;
      }),
    ).rejects.toThrow(/splits summing to 8500 but a total of 9000/);

    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM "expenses"
    `;
    expect(Number(rows[0].count)).toBe(0);
  });
});

describeDb("§12 household_balances", () => {
  beforeEach(async () => {
    await db!.reset();
  });

  it("reproduces the worked 3-payer example", async () => {
    const { prisma } = db!;
    const { householdId, userIds } = await seedHousehold(prisma, ["Ann", "Bob", "Cal"]);
    const { Ann, Bob, Cal } = userIds;

    // Ann pays 9000 (3000 each). Bob pays 6000 (2000 each). Cal pays nothing.
    await seedAcceptedExpense(prisma, {
      householdId,
      paidByUserId: Ann,
      amountCents: 9000,
      splits: [Ann, Bob, Cal].map((userId) => ({ userId, amountCents: 3000 })),
    });
    await seedAcceptedExpense(prisma, {
      householdId,
      paidByUserId: Bob,
      amountCents: 6000,
      splits: [Ann, Bob, Cal].map((userId) => ({ userId, amountCents: 2000 })),
    });

    const rows = await prisma.$queryRaw<
      Array<{
        user_id: string;
        total_paid_cents: bigint;
        total_owed_cents: bigint;
        net_cents: bigint;
      }>
    >`
      SELECT user_id, total_paid_cents, total_owed_cents, net_cents
        FROM "household_balances"
       WHERE household_id = ${householdId}::uuid
    `;

    const byUser = new Map(
      rows.map((row) => [
        row.user_id,
        {
          paid: Number(row.total_paid_cents),
          owed: Number(row.total_owed_cents),
          net: Number(row.net_cents),
        },
      ]),
    );

    expect(byUser.get(Ann)).toEqual({ paid: 9000, owed: 5000, net: 4000 });
    expect(byUser.get(Bob)).toEqual({ paid: 6000, owed: 5000, net: 1000 });
    expect(byUser.get(Cal)).toEqual({ paid: 0, owed: 5000, net: -5000 });
  });

  it("holds the invariant that nets sum to exactly zero", async () => {
    const { prisma } = db!;
    const { householdId, userIds } = await seedHousehold(prisma, ["Ann", "Bob", "Cal"]);
    const { Ann, Bob, Cal } = userIds;

    // An amount that does not divide evenly, so pennies are in play.
    await seedAcceptedExpense(prisma, {
      householdId,
      paidByUserId: Ann,
      amountCents: 10_001,
      splits: [
        { userId: Ann, amountCents: 3334 },
        { userId: Bob, amountCents: 3334 },
        { userId: Cal, amountCents: 3333 },
      ],
    });

    const [{ total }] = await prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COALESCE(SUM(net_cents), 0) AS total
        FROM "household_balances"
       WHERE household_id = ${householdId}::uuid
    `;
    expect(Number(total)).toBe(0);
  });

  it("ignores expenses that are not yet accepted", async () => {
    const { prisma } = db!;
    const { householdId, userIds } = await seedHousehold(prisma, ["Ann", "Bob"]);

    await prisma.$transaction(async (tx) => {
      const [{ id }] = await tx.$queryRaw<[{ id: string }]>`
        INSERT INTO "expenses" (
          id, household_id, paid_by_user_id, created_by_user_id, description,
          amount_cents, currency, date, split_method, status, created_at, updated_at
        )
        VALUES (
          gen_random_uuid(), ${householdId}::uuid, ${userIds.Ann}::uuid,
          ${userIds.Ann}::uuid, 'Groceries', 9000, 'NZD', CURRENT_DATE, 'EQUAL',
          'PENDING_ACCEPTANCE', now(), now()
        )
        RETURNING id
      `;
      for (const userId of [userIds.Ann, userIds.Bob]) {
        await tx.$executeRaw`
          INSERT INTO "expense_splits" (id, expense_id, user_id, amount_cents, created_at)
          VALUES (gen_random_uuid(), ${id}::uuid, ${userId}::uuid, 4500, now())
        `;
      }
    });

    const [{ total }] = await prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COALESCE(SUM(total_paid_cents + total_owed_cents), 0) AS total
        FROM "household_balances"
       WHERE household_id = ${householdId}::uuid
    `;
    expect(Number(total)).toBe(0);
  });
});

describeDb("§9 derived payment status and settled balances", () => {
  beforeEach(async () => {
    await db!.reset();
  });

  it("walks the §40 acceptance scenario to a zero net for both members", async () => {
    const { prisma } = db!;
    const { householdId, userIds } = await seedHousehold(prisma, ["Ann", "Bob"]);
    const { Ann, Bob } = userIds;

    // Ann paid 9000, split equally and accepted: Ann +4500, Bob -4500.
    await seedAcceptedExpense(prisma, {
      householdId,
      paidByUserId: Ann,
      amountCents: 9000,
      splits: [
        { userId: Ann, amountCents: 4500 },
        { userId: Bob, amountCents: 4500 },
      ],
    });

    const [{ id: paymentId }] = await prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO "payments" (
        id, household_id, from_user_id, to_user_id, amount_cents, currency,
        method, paid_at, created_at
      )
      VALUES (
        gen_random_uuid(), ${householdId}::uuid, ${Bob}::uuid, ${Ann}::uuid,
        4500, 'NZD', 'BANK_TRANSFER', now(), now()
      )
      RETURNING id
    `;

    // Before confirmation the payment must not move any balance.
    const pending = await prisma.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM "payment_states" WHERE id = ${paymentId}::uuid
    `;
    expect(pending[0].status).toBe("PENDING_CONFIRMATION");

    const beforeRows = await prisma.$queryRaw<
      Array<{ user_id: string; settled_net_cents: bigint }>
    >`
      SELECT user_id, settled_net_cents FROM "household_net_positions"
       WHERE household_id = ${householdId}::uuid
    `;
    const before = new Map(
      beforeRows.map((r) => [r.user_id, Number(r.settled_net_cents)]),
    );
    expect(before.get(Ann)).toBe(4500);
    expect(before.get(Bob)).toBe(-4500);

    // Ann confirms (only the recipient may, enforced in the server action).
    await prisma.$executeRaw`
      INSERT INTO "payment_confirmations" (id, payment_id, confirmed_by_user_id, confirmed_at)
      VALUES (gen_random_uuid(), ${paymentId}::uuid, ${Ann}::uuid, now())
    `;

    const confirmed = await prisma.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM "payment_states" WHERE id = ${paymentId}::uuid
    `;
    expect(confirmed[0].status).toBe("CONFIRMED");

    const afterRows = await prisma.$queryRaw<
      Array<{ user_id: string; settled_net_cents: bigint }>
    >`
      SELECT user_id, settled_net_cents FROM "household_net_positions"
       WHERE household_id = ${householdId}::uuid
    `;
    const after = new Map(afterRows.map((r) => [r.user_id, Number(r.settled_net_cents)]));
    expect(after.get(Ann)).toBe(0);
    expect(after.get(Bob)).toBe(0);
  });

  it("marks a payment REVERSED once a reversal row points at it", async () => {
    const { prisma } = db!;
    const { householdId, userIds } = await seedHousehold(prisma, ["Ann", "Bob"]);
    const { Ann, Bob } = userIds;

    const [{ id: paymentId }] = await prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO "payments" (
        id, household_id, from_user_id, to_user_id, amount_cents, currency, paid_at, created_at
      )
      VALUES (
        gen_random_uuid(), ${householdId}::uuid, ${Bob}::uuid, ${Ann}::uuid,
        4500, 'NZD', now(), now()
      )
      RETURNING id
    `;
    await prisma.$executeRaw`
      INSERT INTO "payment_confirmations" (id, payment_id, confirmed_by_user_id, confirmed_at)
      VALUES (gen_random_uuid(), ${paymentId}::uuid, ${Ann}::uuid, now())
    `;
    await prisma.$executeRaw`
      INSERT INTO "payments" (
        id, household_id, from_user_id, to_user_id, amount_cents, currency,
        reverses_payment_id, paid_at, created_at
      )
      VALUES (
        gen_random_uuid(), ${householdId}::uuid, ${Bob}::uuid, ${Ann}::uuid,
        -4500, 'NZD', ${paymentId}::uuid, now(), now()
      )
    `;

    const rows = await prisma.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM "payment_states" WHERE id = ${paymentId}::uuid
    `;
    expect(rows[0].status).toBe("REVERSED");
  });
});

describeDb("§8a placeholder members", () => {
  beforeEach(async () => {
    await db!.reset();
  });

  async function seedManager(): Promise<string> {
    const { userIds } = await seedHousehold(db!.prisma, ["Ann"]);
    return userIds.Ann;
  }

  it("accepts a placeholder that has a manager", async () => {
    const managerId = await seedManager();
    const rows = await db!.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "users" (id, name, email, is_placeholder, managed_by_user_id, created_at, updated_at)
      VALUES (gen_random_uuid(), 'Pukar', 'placeholder.p@splithome.invalid', true, ${managerId}::uuid, now(), now())
      RETURNING id
    `;
    expect(rows).toHaveLength(1);
  });

  it("rejects a placeholder with no manager", async () => {
    await expect(
      db!.prisma.$executeRaw`
        INSERT INTO "users" (id, name, email, is_placeholder, created_at, updated_at)
        VALUES (gen_random_uuid(), 'Orphan', 'placeholder.o@splithome.invalid', true, now(), now())
      `,
    ).rejects.toThrow(/users_placeholder_has_manager/);
  });

  it("rejects a real account that has a manager", async () => {
    const managerId = await seedManager();
    await expect(
      db!.prisma.$executeRaw`
        INSERT INTO "users" (id, name, email, is_placeholder, managed_by_user_id, created_at, updated_at)
        VALUES (gen_random_uuid(), 'Bob', 'bob@example.test', false, ${managerId}::uuid, now(), now())
      `,
    ).rejects.toThrow(/users_placeholder_has_manager/);
  });

  it("refuses to let a placeholder hold an account, so it can never sign in", async () => {
    const managerId = await seedManager();
    const [{ id: placeholderId }] = await db!.prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO "users" (id, name, email, is_placeholder, managed_by_user_id, created_at, updated_at)
      VALUES (gen_random_uuid(), 'Pukar', 'placeholder.p@splithome.invalid', true, ${managerId}::uuid, now(), now())
      RETURNING id
    `;

    await expect(
      db!.prisma.$executeRaw`
        INSERT INTO "accounts" (id, user_id, type, provider, provider_account_id)
        VALUES (gen_random_uuid(), ${placeholderId}::uuid, 'oauth', 'google', 'sub-123')
      `,
    ).rejects.toThrow(/placeholder and cannot hold accounts/);
  });

  it("refuses to let a placeholder hold a session", async () => {
    const managerId = await seedManager();
    const [{ id: placeholderId }] = await db!.prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO "users" (id, name, email, is_placeholder, managed_by_user_id, created_at, updated_at)
      VALUES (gen_random_uuid(), 'Pukar', 'placeholder.p@splithome.invalid', true, ${managerId}::uuid, now(), now())
      RETURNING id
    `;

    await expect(
      db!.prisma.$executeRaw`
        INSERT INTO "sessions" (id, session_token, user_id, expires)
        VALUES (gen_random_uuid(), 'tok-123', ${placeholderId}::uuid, now() + interval '1 day')
      `,
    ).rejects.toThrow(/placeholder and cannot hold sessions/);
  });

  it("still lets a real account hold an account row", async () => {
    const managerId = await seedManager();
    const rows = await db!.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "accounts" (id, user_id, type, provider, provider_account_id)
      VALUES (gen_random_uuid(), ${managerId}::uuid, 'oauth', 'google', 'sub-real')
      RETURNING id
    `;
    expect(rows).toHaveLength(1);
  });
});

describeDb("§7 reversal and §12 balances", () => {
  beforeEach(async () => {
    await db!.reset();
  });

  /** Inserts the negation of an expense, as `reverseExpense` does. */
  async function reverse(expenseId: string, householdId: string, paidByUserId: string) {
    const { prisma } = db!;
    await prisma.$transaction(async (tx) => {
      const splits = await tx.$queryRaw<Array<{ user_id: string; amount_cents: bigint }>>`
        SELECT user_id, amount_cents FROM "expense_splits" WHERE expense_id = ${expenseId}::uuid
      `;
      const total = await tx.$queryRaw<[{ amount_cents: bigint }]>`
        SELECT amount_cents FROM "expenses" WHERE id = ${expenseId}::uuid
      `;
      const [{ id: reversalId }] = await tx.$queryRaw<[{ id: string }]>`
        INSERT INTO "expenses" (
          id, household_id, paid_by_user_id, created_by_user_id, description,
          amount_cents, currency, date, split_method, status, reverses_expense_id,
          created_at, updated_at
        )
        VALUES (
          gen_random_uuid(), ${householdId}::uuid, ${paidByUserId}::uuid,
          ${paidByUserId}::uuid, 'Reversal', ${-total[0].amount_cents}, 'NZD',
          CURRENT_DATE, 'EQUAL', 'ACCEPTED', ${expenseId}::uuid, now(), now()
        )
        RETURNING id
      `;
      for (const split of splits) {
        await tx.$executeRaw`
          INSERT INTO "expense_splits" (
            id, expense_id, user_id, amount_cents, acceptance, accepted_at, created_at
          )
          VALUES (
            gen_random_uuid(), ${reversalId}::uuid, ${split.user_id}::uuid,
            ${-split.amount_cents}, 'ACCEPTED', now(), now()
          )
        `;
      }
      await tx.$executeRaw`
        UPDATE "expenses" SET status = 'REVERSED' WHERE id = ${expenseId}::uuid
      `;
    });
  }

  async function nets(householdId: string): Promise<Map<string, number>> {
    const rows = await db!.prisma.$queryRaw<
      Array<{ user_id: string; net_cents: bigint }>
    >`
      SELECT user_id, net_cents FROM "household_balances"
       WHERE household_id = ${householdId}::uuid
    `;
    return new Map(rows.map((row) => [row.user_id, Number(row.net_cents)]));
  }

  it("returns every balance to zero, not just the sum (regression)", async () => {
    const { prisma } = db!;
    const { householdId, userIds } = await seedHousehold(prisma, ["Ann", "Bob"]);
    const { Ann, Bob } = userIds;

    const expenseId = await seedAcceptedExpense(prisma, {
      householdId,
      paidByUserId: Ann,
      amountCents: 9000,
      splits: [
        { userId: Ann, amountCents: 4500 },
        { userId: Bob, amountCents: 4500 },
      ],
    });

    const before = await nets(householdId);
    expect(before.get(Ann)).toBe(4500);
    expect(before.get(Bob)).toBe(-4500);

    await reverse(expenseId, householdId, Ann);

    // Counting the reversal row while the original dropped out would leave Ann
    // at -4500 and Bob at +4500 — a symmetric error the zero-sum invariant
    // cannot detect, which is why this asserts each balance individually.
    const after = await nets(householdId);
    expect(after.get(Ann)).toBe(0);
    expect(after.get(Bob)).toBe(0);
  });

  it("leaves balances untouched when an unaccepted expense is reversed", async () => {
    const { prisma } = db!;
    const { householdId, userIds } = await seedHousehold(prisma, ["Ann", "Bob"]);

    const expenseId = await prisma.$transaction(async (tx) => {
      const [{ id }] = await tx.$queryRaw<[{ id: string }]>`
        INSERT INTO "expenses" (
          id, household_id, paid_by_user_id, created_by_user_id, description,
          amount_cents, currency, date, split_method, status, created_at, updated_at
        )
        VALUES (
          gen_random_uuid(), ${householdId}::uuid, ${userIds.Ann}::uuid,
          ${userIds.Ann}::uuid, 'Groceries', 9000, 'NZD', CURRENT_DATE, 'EQUAL',
          'PENDING_ACCEPTANCE', now(), now()
        )
        RETURNING id
      `;
      for (const userId of [userIds.Ann, userIds.Bob]) {
        await tx.$executeRaw`
          INSERT INTO "expense_splits" (id, expense_id, user_id, amount_cents, created_at)
          VALUES (gen_random_uuid(), ${id}::uuid, ${userId}::uuid, 4500, now())
        `;
      }
      return id;
    });

    await reverse(expenseId, householdId, userIds.Ann);

    const after = await nets(householdId);
    expect(after.get(userIds.Ann)).toBe(0);
    expect(after.get(userIds.Bob)).toBe(0);
  });

  it("keeps a confirmed payment against a reversed expense visible as an overpayment", async () => {
    const { prisma } = db!;
    const { householdId, userIds } = await seedHousehold(prisma, ["Ann", "Bob"]);
    const { Ann, Bob } = userIds;

    const expenseId = await seedAcceptedExpense(prisma, {
      householdId,
      paidByUserId: Ann,
      amountCents: 9000,
      splits: [
        { userId: Ann, amountCents: 4500 },
        { userId: Bob, amountCents: 4500 },
      ],
    });

    const [{ id: paymentId }] = await prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO "payments" (
        id, household_id, from_user_id, to_user_id, amount_cents, currency, paid_at, created_at
      )
      VALUES (
        gen_random_uuid(), ${householdId}::uuid, ${Bob}::uuid, ${Ann}::uuid,
        4500, 'NZD', now(), now()
      )
      RETURNING id
    `;
    await prisma.$executeRaw`
      INSERT INTO "payment_confirmations" (id, payment_id, confirmed_by_user_id, confirmed_at)
      VALUES (gen_random_uuid(), ${paymentId}::uuid, ${Ann}::uuid, now())
    `;

    await reverse(expenseId, householdId, Ann);

    // Bob paid for something that was then cancelled, so he is owed it back.
    const rows = await prisma.$queryRaw<
      Array<{ user_id: string; settled_net_cents: bigint }>
    >`
      SELECT user_id, settled_net_cents FROM "household_net_positions"
       WHERE household_id = ${householdId}::uuid
    `;
    const settled = new Map(
      rows.map((row) => [row.user_id, Number(row.settled_net_cents)]),
    );
    expect(settled.get(Bob)).toBe(4500);
    expect(settled.get(Ann)).toBe(-4500);
  });
});
