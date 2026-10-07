/**
 * Development seed.
 *
 * Builds the §12 worked example so a fresh database has real, non-trivial
 * balances to look at: Ann pays 9000 (3000 each), Bob pays 6000 (2000 each),
 * Cal pays nothing, leaving nets of +4000 / +1000 / -5000.
 *
 * Idempotent — re-running it reuses the same household rather than stacking
 * duplicate expenses, so `pnpm db:seed` is safe to repeat.
 *
 * Deliberately refuses to run against a production database: it writes
 * financial rows, and §2.2 makes those permanent.
 */

import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { computeSplits } from "@/lib/splits/engine";
import { toDbCents } from "@/lib/money";

const HOUSEHOLD_NAME = "Flat 3";
const CURRENCY = "NZD";

/** §13 — a household starts with these so the expense form is usable at once. */
const DEFAULT_CATEGORIES = [
  { name: "Groceries", icon: "shopping-cart", colorHex: "#16a34a" },
  { name: "Rent", icon: "home", colorHex: "#4f46e5" },
  { name: "Utilities", icon: "zap", colorHex: "#f59e0b" },
  { name: "Internet", icon: "wifi", colorHex: "#0ea5e9" },
  { name: "Household", icon: "sofa", colorHex: "#a855f7" },
  { name: "Takeaway", icon: "utensils", colorHex: "#ef4444" },
  { name: "Transport", icon: "car", colorHex: "#64748b" },
  { name: "Other", icon: "circle-ellipsis", colorHex: "#94a3b8" },
];

const PEOPLE = [
  { name: "Ann", email: "ann@example.test", role: "ADMIN" as const },
  { name: "Bob", email: "bob@example.test", role: "MEMBER" as const },
  { name: "Cal", email: "cal@example.test", role: "MEMBER" as const },
];

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set; nothing to seed");
  }
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to seed a production database");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

async function main(): Promise<void> {
  const prisma = createClient();

  try {
    const users = await Promise.all(
      PEOPLE.map((person) =>
        prisma.user.upsert({
          where: { email: person.email },
          update: { name: person.name },
          create: { name: person.name, email: person.email, emailVerified: new Date() },
          select: { id: true, name: true, email: true },
        }),
      ),
    );
    const byName = new Map(users.map((user, index) => [PEOPLE[index].name, user.id]));
    const ann = byName.get("Ann")!;

    const existing = await prisma.household.findFirst({
      where: { name: HOUSEHOLD_NAME, createdByUserId: ann },
      select: { id: true },
    });

    const household =
      existing ??
      (await prisma.household.create({
        data: { name: HOUSEHOLD_NAME, currency: CURRENCY, createdByUserId: ann },
        select: { id: true },
      }));

    for (const [index, person] of PEOPLE.entries()) {
      await prisma.householdMember.upsert({
        where: {
          householdId_userId: { householdId: household.id, userId: users[index].id },
        },
        update: { role: person.role, removedAt: null },
        create: {
          householdId: household.id,
          userId: users[index].id,
          role: person.role,
        },
      });
    }

    for (const category of DEFAULT_CATEGORIES) {
      await prisma.category.upsert({
        where: { householdId_name: { householdId: household.id, name: category.name } },
        update: {},
        create: { householdId: household.id, ...category },
      });
    }

    const groceries = await prisma.category.findUnique({
      where: { householdId_name: { householdId: household.id, name: "Groceries" } },
      select: { id: true },
    });

    // The §12 example: two expenses, both split EQUAL three ways and accepted.
    const scenario = [
      { description: "Weekly shop", paidBy: "Ann", amountCents: 9000 },
      { description: "Power bill", paidBy: "Bob", amountCents: 6000 },
    ];

    for (const entry of scenario) {
      const alreadySeeded = await prisma.expense.findFirst({
        where: { householdId: household.id, description: entry.description },
        select: { id: true },
      });
      if (alreadySeeded) {
        continue;
      }

      // Amounts come from the engine, never from hand arithmetic (§2.5).
      const splits = computeSplits({
        method: "EQUAL",
        totalCents: entry.amountCents,
        participants: PEOPLE.map((person) => ({ userId: byName.get(person.name)! })),
      });

      // One transaction, so the deferred split-sum trigger (§10) sees a
      // balanced expense at COMMIT.
      await prisma.$transaction(async (tx) => {
        await tx.expense.create({
          data: {
            householdId: household.id,
            paidByUserId: byName.get(entry.paidBy)!,
            createdByUserId: byName.get(entry.paidBy)!,
            categoryId: groceries?.id ?? null,
            description: entry.description,
            amountCents: toDbCents(entry.amountCents),
            currency: CURRENCY,
            date: new Date(),
            splitMethod: "EQUAL",
            status: "ACCEPTED",
            splits: {
              create: splits.map((split) => ({
                userId: split.userId,
                amountCents: toDbCents(split.amountCents),
                acceptance: "ACCEPTED",
                acceptedAt: new Date(),
              })),
            },
          },
        });
      });
    }

    const balances = await prisma.$queryRaw<
      Array<{ user_id: string; net_cents: bigint }>
    >`
      SELECT user_id, net_cents FROM "household_balances"
       WHERE household_id = ${household.id}::uuid
       ORDER BY net_cents DESC
    `;

    const nameOf = new Map(users.map((user) => [user.id, user.name ?? user.email]));
    console.log(`Seeded household ${HOUSEHOLD_NAME} (${household.id})`);
    for (const row of balances) {
      console.log(`  ${nameOf.get(row.user_id)}: net ${row.net_cents} cents`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
