import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Pooled connection (PgBouncer on Neon) used by the app at runtime.
    url: env("DATABASE_URL"),
    // Direct connection used by `prisma migrate` / DDL.
    directUrl: env("DIRECT_URL"),
  },
});
