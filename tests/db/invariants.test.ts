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

  async function seedPayment(): Promise<{ paymentId: string; householdId: string; ann: string; bob: string }> {
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
      db!.prisma.$executeRaw`UPDATE "payments" SET amount_cents = 1 WHERE id = ${paymentId}::uuid`,
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

    const beforeRows = await prisma.$queryRaw<Array<{ user_id: string; settled_net_cents: bigint }>>`
      SELECT user_id, settled_net_cents FROM "household_net_positions"
       WHERE household_id = ${householdId}::uuid
    `;
    const before = new Map(beforeRows.map((r) => [r.user_id, Number(r.settled_net_cents)]));
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

    const afterRows = await prisma.$queryRaw<Array<{ user_id: string; settled_net_cents: bigint }>>`
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
