# Project: Household Splitwise (working title: SplitHome)

## §1 Mission

Production-quality household expense-sharing app on Next.js (App Router) + PostgreSQL
(Neon in production) + Vercel. Monolithic, modular, server-first. Modeled on SplitPro
(`oss-apps/split-pro`) but optimized for a small co-habiting group.

## §2 Non-negotiable rules

1. **Money is never a float.** Store integer cents (Postgres `BIGINT`). All math in cents.
   Convert at the UI boundary only.
2. **Financial facts are immutable once accepted.** No UPDATE/DELETE on `expenses`,
   `expense_splits` (after acceptance), or `payments`. Corrections = new reversal/adjustment row.
3. **Balances are derived, never stored.** Compute via SQL view or server function.
4. **Every server action validates, in this order:** (a) authenticated user,
   (b) household membership, (c) role, (d) entity belongs to that household.
5. **All split math is recomputed server-side** from Zod-validated input. The client split
   UI is a suggestion only; never trust client-supplied per-person amounts.
6. **Leftover pennies** are distributed deterministically: sort participants by
   (amount desc, userId asc), then hand out 1 cent each until the total matches.
7. **No `any`.** Use `unknown` + Zod parse, or a proper type.
8. **Never expose `DATABASE_URL` or any secret to the client.** Server-only modules under
   `src/lib/db/*` and `src/lib/auth/*` must `import "server-only"`.
9. **Audit everything financial.** Every state transition writes to `audit_logs` inside the
   same DB transaction as the change itself.
10. **Commit after every prompt** with a Conventional Commit message.

## §3 Stack (versions verified in this repo — do not assume older APIs)

| Thing | Version | Notes |
|---|---|---|
| Next.js | **16.3.8** | App Router, Turbopack by default |
| React | 19.2.8 | |
| TypeScript | 5.9.3 | `strict: true` |
| Tailwind CSS | **4.x** | CSS-first config, `@tailwindcss/postcss` |
| Prisma ORM | **7.10.0** | new `prisma-client` generator + **driver adapter required** |
| Zod | **4.6.5** | v4 API, not v3 |
| Auth.js (NextAuth) | 5.0.0-beta.32 | |
| Vitest | 5.0.3 | |
| Playwright | 1.63.0 | |
| Node | 24.21.0 LTS | |
| pnpm | 12.9.1 | |

**Read `.claude/skills/versions.skill.md` before writing any code.** It documents the
breaking changes in Next 16, Prisma 7, Zod 4 and Tailwind 4 that differ from older training
data. Getting these wrong is the single most likely cause of a failed build.

Also available: Prisma's own agent skills under `.claude/skills/prisma-*` (symlinked from
`.agents/skills/`), and the full Next.js 16 docs under `node_modules/next/dist/docs/`.

## §4 Directory conventions

- `app/` — routes only (root-level, **not** `src/app`). No business logic.
- `src/lib/` — business logic (`db`, `auth`, `splits`, `expenses`, `settlements`,
  `storage`, `email`, `audit`, `notifications`, `reminders`, `ui`)
- `src/actions/` — Server Actions (`"use server"`)
- `src/components/` — UI, grouped by feature
- `src/generated/prisma/` — generated Prisma client (gitignored)
- `prisma/schema.prisma` — schema; `prisma/migrations/` — migrations
- `tests/` — Vitest unit/integration; `tests/e2e/` — Playwright
- Import alias: `@/*` → `./src/*`. So `@/lib/splits/engine`, `@/actions/expenses/create`.

## §5 Role matrix

| Action | ADMIN | MEMBER | VIEWER |
|---|---|---|---|
| View dashboard/expenses | ✅ | ✅ | ✅ |
| Create expense | ✅ | ✅ | ❌ |
| Accept/reject own split | ✅ | ✅ | ❌ |
| Record own payment | ✅ | ✅ | ❌ |
| Confirm payment received | ✅ | ✅ | ❌ |
| Invite/remove member, change role | ✅ | ❌ | ❌ |
| Manage categories/settings | ✅ | ❌ | ❌ |
| Lock expense | ✅ | ❌ | ❌ |
| View audit logs | ✅ | ❌ | ❌ |

## §6 Expense creation input contract

```ts
{
  householdId: string;      // uuid
  paidByUserId: string;     // uuid, must be a member
  categoryId: string | null;
  description: string;      // 1..200
  amountCents: number;      // integer, non-zero
  currency: string;         // ISO 4217, 3 chars
  date: Date;
  notes?: string;           // <= 2000
  receiptFileId?: string;
  splitMethod: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";
  participants: Array<{
    userId: string;
    amountCents?: number;   // EXACT only
    percentBps?: number;    // PERCENTAGE only, basis points, 10000 = 100%
    shares?: number;        // SHARES only, positive int
  }>;
}
```

The server recomputes every per-person amount with `@/lib/splits/engine` and ignores any
client-supplied `amountCents` except in `EXACT` mode, where it validates the sum.

## §7 Expense state machine

```
                       create
                         │
                         ▼
             PENDING_ACCEPTANCE ──(all accept)──► ACCEPTED
                  │     │                            │
       (some accept)    │ (any reject)               │ (first confirmed payment)
                  ▼     ▼                            ▼
       PARTIALLY_ACCEPTED   DISPUTED            PARTIALLY_PAID
                  │             │                     │
       (all accept)│   (resolved)│                    │ (all splits paid)
                  ▼             ▼                     ▼
               ACCEPTED ◄───────┘                   PAID
                                                      │ (admin locks)
                                                      ▼
                                                   LOCKED
```

`ExpenseStatus` = `PENDING_ACCEPTANCE | PARTIALLY_ACCEPTED | ACCEPTED | DISPUTED |
PARTIALLY_PAID | PAID | LOCKED | REVERSED`.

**`PAID` and `LOCKED` are terminal for edits.** `LOCKED` rejects every mutation.
A correction is a *new* expense with a negative `amountCents` and `reversesExpenseId` set.

## §8 Split acceptance

`AcceptanceStatus` = `PENDING | ACCEPTED | REJECTED`.
A user may only transition **their own** split. Rejecting sets the parent expense to
`DISPUTED` and notifies the creator.

## §8a Placeholder members (amends §8 and §12)

Not every participant has an account. A **placeholder** is a household member
tracked by somebody else — the flatmate who will never sign up but still owes for
the groceries.

- `users.is_placeholder` + `users.managed_by_user_id`, kept consistent by a
  `CHECK`: a placeholder must have a manager, a real account must not.
- They live in `users` rather than a parallel table because `expense_splits`,
  `payments` and `settlement_transfers` all have foreign keys to it.
- Their email is synthetic, under the RFC 2606 reserved `.invalid` TLD, so no
  provider can ever verify it. `BEFORE INSERT OR UPDATE` triggers on `accounts`
  and `sessions` make "a placeholder can never authenticate" a database
  guarantee, not a convention.
- **Their splits are written `ACCEPTED`**, because there is nobody to accept
  them. This is the amendment to §8: acceptance gates the §12 balances, so
  without it a tracked member's share would never count and balances would read
  zero. §8 still applies in full to real accounts.
- A split also starts `ACCEPTED` for the expense's payer and creator — entering
  an expense is accepting your own share of it.
- The **manager** is the one person who may act on a placeholder's behalf for §8
  acceptance and §9 payment confirmation. `requireCanActFor` replaces
  `assertIsSelf` wherever that applies. Not transitive: a placeholder cannot
  manage another placeholder.
- A placeholder is always `MEMBER`, never `ADMIN`: it cannot sign in, so admin
  rights would be authority nobody can exercise.

## §9 Payment rules

- `PaymentStatus` = `PENDING_CONFIRMATION | CONFIRMED | REVERSED`.
- Only the **recipient** (the expense payer) may confirm a payment.
- `payments` rows are **immutable** — enforced by a `BEFORE UPDATE OR DELETE` trigger that
  raises an exception. Cancelling a payment inserts a *reversal* row
  (`reversesPaymentId` set, negative `amountCents`); the original row is never touched.
- Only `CONFIRMED` payments count toward balances.

## §10 Immutability enforcement

Two layers, both required:
1. **Application layer** — guards in `src/lib/expenses/state.ts` and every server action.
2. **Database layer** — triggers in a hand-written SQL migration:
   - `BEFORE UPDATE OR DELETE ON payments` → `RAISE EXCEPTION`
   - `BEFORE UPDATE OR DELETE ON audit_logs` → `RAISE EXCEPTION`
   - `DEFERRABLE INITIALLY DEFERRED` constraint trigger asserting
     `SUM(expense_splits.amount_cents) = expenses.amount_cents`, checked at COMMIT.

## §11 Audit log

Every financial state transition writes one `audit_logs` row **inside the same transaction**.
`AuditAction` includes at minimum: `HOUSEHOLD_CREATED`, `MEMBER_INVITED`,
`INVITATION_REVOKED`, `INVITATION_ACCEPTED`, `MEMBER_REMOVED`, `ROLE_CHANGED`,
`EXPENSE_CREATED`, `EXPENSE_ACCEPTED`, `EXPENSE_REJECTED`, `EXPENSE_LOCKED`,
`EXPENSE_REVERSED`, `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_REVERSED`,
`SETTLEMENT_CREATED`, `CATEGORY_CREATED`, `CATEGORY_UPDATED`.

Rows record: `householdId`, `actorUserId`, `action`, `entityType`, `entityId`,
`beforeJson`, `afterJson`, `createdAt`.

## §12 Balances (derived)

A Postgres view `household_balances` yields per `(household_id, user_id)`:

- `total_paid_cents` — sum of expenses they paid, counting only expenses in
  `ACCEPTED | PARTIALLY_PAID | PAID | LOCKED`
- `total_owed_cents` — sum of their accepted splits on those same expenses
- `net_cents` = `total_paid_cents - total_owed_cents` (positive ⇒ owed to them)

Worked 3-payer example (used as a test fixture):

> Household of 3 (Ann, Bob, Cal), all splits equal and accepted.
> Ann pays 9000 (3000 each). Bob pays 6000 (2000 each). Cal pays 0.
> Totals: Ann paid 9000 owes 5000 ⇒ net **+4000**.
> Bob paid 6000 owes 5000 ⇒ net **+1000**. Cal paid 0 owes 5000 ⇒ net **−5000**.
> Sum of nets = 0. Minimal transfers: Cal→Ann 4000, Cal→Bob 1000.

**Invariant: the sum of all `net_cents` in a household is always exactly 0.**

## §13 UI conventions

See `.claude/skills/ui.skill.md`. Single source of truth for status colors is
`src/lib/ui/status.ts`; money is always rendered through `formatMoney(cents, currency)`.

## §17 Notifications

In-app only (no websockets). `notifications` rows are created inside the same transaction
as the triggering financial change. The bell polls every 30s on window focus.

## §18 Reminders

`src/lib/reminders/schedule.ts` is a **pure** function: given unpaid splits and today's
date, it returns the reminders that *should* exist (default offsets: 3 and 7 days after
the expense date, configurable per household). The cron route inserts only missing
`reminders` rows, making it idempotent — a replay sends nothing twice.

## §19 Email

`src/lib/email/send.ts` exposes a provider interface. Resend is used when `EMAIL_API_KEY`
is set; otherwise every function is a no-op that logs. Functions: `sendInvitationEmail`,
`sendExpenseCreatedEmail`, `sendPaymentReminderEmail`, `sendPaymentConfirmedEmail`.

## §20 Cron

`app/api/cron/reminders/route.ts`, scheduled hourly by `vercel.json`. It must verify the
`Authorization: Bearer $CRON_SECRET` header and return 401 otherwise.

## §21 Security requirements

- Every server action begins with `requireAuth()` then `requireHouseholdMember(...)`.
- Rate-limit invite and create-expense actions behind `src/lib/rate-limit.ts`.
- No secret may be imported into a client component. This must hold:
  ```
  grep -rn "process.env" src/components app | grep -v NEXT_PUBLIC
  ```
  returns nothing.
- Server-only modules `import "server-only"`.

## §22 Testing

- Unit/pure logic: Vitest. The split engine requires **100% line coverage**.
- DB constraint tests: Vitest against a real Postgres (`TEST_DATABASE_URL`); they must
  **skip cleanly**, not fail, when no database is reachable.
- E2E: Playwright, `tests/e2e/`.

## §40 Acceptance scenario (the E2E that must pass)

1. Ann signs in with Google and creates household "Flat 3" (currency NZD).
2. Ann invites Bob; Bob accepts via the invite link; Bob is a MEMBER.
3. Ann creates an expense: "Groceries", 9000 cents, split EQUAL between Ann and Bob,
   with a JPEG receipt attached. Status ⇒ `PENDING_ACCEPTANCE`. Bob's split = 4500.
4. Bob opens the dashboard, sees "Awaiting Your Action", and accepts. Status ⇒ `ACCEPTED`.
5. Bob records a payment of 4500 to Ann. Payment ⇒ `PENDING_CONFIRMATION`.
6. Ann confirms it. Payment ⇒ `CONFIRMED`, Bob's split ⇒ paid, expense ⇒ `PAID`.
7. Balances read 0 net for both. `audit_logs` contains `EXPENSE_CREATED`,
   `EXPENSE_ACCEPTED`, `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`.
8. Ann locks the expense. Any further mutation is rejected.

## §41 Workflow per prompt

1. Read this file, `.claude/skills/versions.skill.md`, and the skills relevant to the task.
2. Plan (≤10 lines), then implement.
3. `pnpm lint && pnpm typecheck && pnpm test` — fix every failure.
4. `git add -A && git commit -m "<type>(<scope>): <msg>"`

## §42 Commands

```bash
pnpm dev                # next dev
pnpm build              # next build
pnpm lint               # eslint  (NOTE: `next lint` was removed in Next 16)
pnpm typecheck          # tsc --noEmit
pnpm test               # vitest run
pnpm test:watch         # vitest
pnpm test:coverage      # vitest run --coverage
pnpm test:e2e           # playwright test
pnpm prisma:generate    # prisma generate
pnpm prisma:migrate     # prisma migrate dev
pnpm prisma:deploy      # prisma migrate deploy
pnpm prisma:studio      # prisma studio
pnpm db:reset           # prisma migrate reset --force
```
