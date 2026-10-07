# SplitHome

Household expense sharing on Next.js, PostgreSQL and Vercel. Built for a small
co-habiting group rather than a general-purpose ledger: a few people, one
household, shared bills.

> **Status: in progress.** The data model and all the shared logic are in place
> and tested. The server actions, UI and end-to-end tests are not written yet,
> so there is no usable application to run.

## What makes it different from a spreadsheet

- **Money is never a float.** Every amount is an integer number of cents in a
  Postgres `BIGINT`. The only place a float appears is the final division for
  display.
- **Financial facts are append-only.** Payments and audit rows cannot be updated
  or deleted — enforced by database triggers, not only by application code. A
  correction is a new reversing row, so history is never rewritten.
- **Balances are derived, never stored.** They come from a SQL view over the
  expenses, splits and confirmed payments, so they cannot drift out of sync.
- **Splits are agreed, not imposed.** Each participant accepts or rejects their
  own share, and the expense tracks that as a state machine.
- **The server owns the arithmetic.** The split UI is a suggestion; every
  per-person amount is recomputed server-side from validated input.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 ·
Prisma 7 with the `pg` driver adapter · PostgreSQL (Neon in production) ·
Auth.js v5 · Zod 4 · Vitest · Playwright

## Getting started

Requires Node 24 and pnpm 12.

```bash
pnpm install
cp .env.example .env          # then fill it in
pnpm prisma:generate
pnpm prisma:deploy            # applies migrations, including the triggers and views
pnpm db:seed                  # optional: a household with realistic balances
pnpm dev
```

`.env.example` documents every variable. `DATABASE_URL` is the pooled
connection used at runtime; `DIRECT_URL` is the unpooled one used for DDL,
since migrations must not go through a transaction pooler.

## Commands

| Command | Does |
|---|---|
| `pnpm dev` / `pnpm build` | Run / build the app |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` | The CI gate |
| `pnpm test:coverage` | Enforces 100% coverage on the split engine |
| `pnpm test:e2e` | Playwright (not written yet) |
| `pnpm prisma:migrate` · `pnpm prisma:deploy` · `pnpm db:reset` | Schema |
| `pnpm db:seed` | Seed a development household |
| `pnpm format` | Prettier |

## Tests

```bash
pnpm test
```

Unit tests need nothing but Node. The database tests assert the triggers and
views directly and **skip cleanly** when no database is reachable, so a fresh
clone stays green — set `TEST_DATABASE_URL` and apply migrations to it to run
them:

```bash
DATABASE_URL=$TEST_DATABASE_URL DIRECT_URL=$TEST_DATABASE_URL pnpm prisma:deploy
pnpm test
```

CI runs them against a real Postgres and fails if it sees them skip, so a
broken trigger cannot pass silently.

## Layout

```
app/                 routes only, no business logic
src/lib/             business logic — splits, expenses, auth, audit, money
src/actions/         server actions
src/components/      UI, grouped by feature
prisma/              schema and migrations (the triggers are hand-written SQL)
tests/               vitest; tests/e2e is playwright
```

`src/lib/db/*` and `src/lib/auth/*` are `server-only`: a client component that
imports them fails the build rather than leaking a connection string.
