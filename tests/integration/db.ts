import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * The database the integration tests run against.
 *
 * Deliberately TEST_DATABASE_URL, never DATABASE_URL: these tests truncate
 * every table between cases, and pointing them at a development database would
 * destroy its contents.
 *
 * `src/lib/db/client` reads DATABASE_URL, and the actions use that client — so
 * the environment variable is reassigned before anything imports it. That is
 * why this module must be imported before any action.
 */

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

export interface IntegrationDatabase {
  prisma: PrismaClient;
  reset: () => Promise<void>;
}

let cached: IntegrationDatabase | null | undefined;

export async function connectIntegrationDatabase(): Promise<IntegrationDatabase | null> {
  if (cached !== undefined) {
    return cached;
  }

  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    console.warn("[integration] skipped: TEST_DATABASE_URL is not set");
    cached = null;
    return cached;
  }

  // Point the application's own client at the test database.
  process.env.DATABASE_URL = connectionString;

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 3_000, max: 4 }),
  });

  try {
    const [{ ready }] = await prisma.$queryRaw<[{ ready: boolean }]>`
      SELECT (
        to_regclass('public.household_balances') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payments_immutable')
      ) AS ready
    `;
    if (!ready) {
      console.warn("[integration] skipped: TEST_DATABASE_URL has no migrations applied");
      await prisma.$disconnect();
      cached = null;
      return cached;
    }
  } catch (error) {
    console.warn(
      `[integration] skipped: TEST_DATABASE_URL is unreachable (${(error as Error).message})`,
    );
    await prisma.$disconnect().catch(() => undefined);
    cached = null;
    return cached;
  }

  const reset = async (): Promise<void> => {
    // TRUNCATE, not DELETE: the append-only triggers reject row-level DELETE.
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`,
    );
  };

  cached = { prisma, reset };
  return cached;
}
