import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Test-database plumbing for the §10 constraint tests.
 *
 * §22 requires these tests to SKIP cleanly rather than fail when no database is
 * reachable, so that `pnpm test` stays green on a laptop with no Postgres and
 * in CI jobs that do not provision one. `connectTestDatabase` therefore returns
 * null instead of throwing, for three distinct reasons: no TEST_DATABASE_URL,
 * nothing listening, or a database that has not had the migrations applied.
 *
 * This builds its own client rather than importing `@/lib/db/client`, both
 * because that module is `server-only` and because it must point at
 * TEST_DATABASE_URL, never at the development database.
 */

export interface TestDatabase {
  prisma: PrismaClient;
  reset: () => Promise<void>;
}

/** Tables wiped between tests, children first. */
const TABLES = [
  "reminders",
  "notifications",
  "audit_logs",
  "settlement_transfers",
  "payment_confirmations",
  "payments",
  "settlements",
  "expense_splits",
  "expenses",
  "categories",
  "invitations",
  "file_uploads",
  "household_members",
  "households",
  "sessions",
  "accounts",
  "users",
];

let cached: TestDatabase | null | undefined;

export async function connectTestDatabase(): Promise<TestDatabase | null> {
  if (cached !== undefined) {
    return cached;
  }

  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    console.warn("[db tests] skipped: TEST_DATABASE_URL is not set");
    cached = null;
    return cached;
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 3_000, max: 4 }),
  });

  try {
    // Does the §10/§12 migration actually exist in this database? Checking the
    // view and the trigger together distinguishes "no database" from "database
    // without migrations applied", which is a far more confusing failure.
    const [{ ready }] = await prisma.$queryRaw<[{ ready: boolean }]>`
      SELECT (
        to_regclass('public.household_balances') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payments_immutable')
      ) AS ready
    `;

    if (!ready) {
      console.warn(
        "[db tests] skipped: TEST_DATABASE_URL has no migrations applied. " +
          "Run: DATABASE_URL=$TEST_DATABASE_URL DIRECT_URL=$TEST_DATABASE_URL pnpm prisma:deploy",
      );
      await prisma.$disconnect();
      cached = null;
      return cached;
    }
  } catch (error) {
    console.warn(
      `[db tests] skipped: TEST_DATABASE_URL is unreachable (${(error as Error).message})`,
    );
    await prisma.$disconnect().catch(() => undefined);
    cached = null;
    return cached;
  }

  const reset = async (): Promise<void> => {
    // TRUNCATE, not DELETE: the append-only triggers reject row-level DELETE by
    // design, and TRUNCATE does not fire row-level triggers.
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`,
    );
  };

  cached = { prisma, reset };
  return cached;
}

export interface HouseholdFixture {
  householdId: string;
  userIds: Record<string, string>;
}

/**
 * Creates a household with the given members, all ADMIN, currency NZD.
 * Returns the generated ids keyed by the names passed in.
 */
export async function seedHousehold(
  prisma: PrismaClient,
  names: readonly string[],
): Promise<HouseholdFixture> {
  const userIds: Record<string, string> = {};

  for (const name of names) {
    const [{ id }] = await prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO "users" (id, name, email, created_at, updated_at)
      VALUES (gen_random_uuid(), ${name}, ${`${name.toLowerCase()}@example.test`}, now(), now())
      RETURNING id
    `;
    userIds[name] = id;
  }

  const ownerId = userIds[names[0]];
  const [{ id: householdId }] = await prisma.$queryRaw<[{ id: string }]>`
    INSERT INTO "households" (id, name, currency, created_by_user_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Flat 3', 'NZD', ${ownerId}::uuid, now(), now())
    RETURNING id
  `;

  for (const name of names) {
    await prisma.$executeRaw`
      INSERT INTO "household_members" (id, household_id, user_id, role, joined_at)
      VALUES (gen_random_uuid(), ${householdId}::uuid, ${userIds[name]}::uuid, 'ADMIN', now())
    `;
  }

  return { householdId, userIds };
}

/**
 * Inserts an ACCEPTED expense with equal, accepted splits across `participants`
 * — the shape §12's worked example assumes.
 */
export async function seedAcceptedExpense(
  prisma: PrismaClient,
  options: {
    householdId: string;
    paidByUserId: string;
    amountCents: number;
    splits: ReadonlyArray<{ userId: string; amountCents: number }>;
    description?: string;
  },
): Promise<string> {
  // One transaction, necessarily. The expense and its splits go in as separate
  // statements, so run outside a transaction each would be its own implicit one
  // and the DEFERRABLE split-sum trigger would fire at the end of each —
  // rejecting the expense insert on its own, before any split exists.
  return prisma.$transaction(async (tx) => {
    const [{ id: expenseId }] = await tx.$queryRaw<[{ id: string }]>`
      INSERT INTO "expenses" (
        id, household_id, paid_by_user_id, created_by_user_id, description,
        amount_cents, currency, date, split_method, status, created_at, updated_at
      )
      VALUES (
        gen_random_uuid(), ${options.householdId}::uuid, ${options.paidByUserId}::uuid,
        ${options.paidByUserId}::uuid, ${options.description ?? "Groceries"},
        ${BigInt(options.amountCents)}, 'NZD', CURRENT_DATE, 'EQUAL', 'ACCEPTED', now(), now()
      )
      RETURNING id
    `;

    for (const split of options.splits) {
      await tx.$executeRaw`
        INSERT INTO "expense_splits" (
          id, expense_id, user_id, amount_cents, acceptance, accepted_at, created_at
        )
        VALUES (
          gen_random_uuid(), ${expenseId}::uuid, ${split.userId}::uuid,
          ${BigInt(split.amountCents)}, 'ACCEPTED', now(), now()
        )
      `;
    }

    return expenseId;
  });
}
