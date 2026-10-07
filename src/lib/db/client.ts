import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * The Prisma client singleton.
 *
 * Prisma 7 has no query engine binary: a driver adapter is mandatory, so the
 * `pg` pool below is the real connection pool. `DATABASE_URL` is the pooled
 * (PgBouncer) URL; `prisma migrate` uses `DIRECT_URL` via prisma7.config.ts and
 * never goes through here.
 *
 * `import "server-only"` (§2.8/§21) makes a client component that reaches for
 * this module fail the build rather than leak the connection string.
 */

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set; the database client cannot be created");
  }

  const adapter = new PrismaPg({
    connectionString,
    // Serverless functions are short-lived and PgBouncer fronts the database,
    // so each instance keeps a small pool and releases it quickly.
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// `next dev` re-evaluates modules on every edit; without this the pool would
// grow one client per hot reload until Postgres refused new connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
