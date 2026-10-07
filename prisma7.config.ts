import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 CLI configuration.
 *
 * This `datasource` is used by the CLI only — `migrate`, `db push`, `studio`.
 * The application never reads it: at runtime `src/lib/db/client.ts` connects
 * through the `@prisma/adapter-pg` driver adapter using `DATABASE_URL` (the
 * pooled PgBouncer URL).
 *
 * DDL must not go through a transaction pooler, so the CLI gets `DIRECT_URL`.
 * Prisma 7 removed the `directUrl` field that used to express this; the split
 * is now "config file = direct, driver adapter = pooled". Locally the two URLs
 * are usually the same, hence the fallback.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL ? env("DIRECT_URL") : env("DATABASE_URL"),
  },
});
