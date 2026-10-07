"use server";

import { revalidatePath } from "next/cache";

import { ok, toActionResult, type ActionResult } from "@/lib/actions/result";
import { writeAuditLog } from "@/lib/audit/write";
import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";

import { createHouseholdSchema } from "./schema";

/** The default categories a new household starts with, so the form is usable. */
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

/**
 * Creates a household with the caller as its first ADMIN.
 *
 * No membership or role check applies here — there is no household to be a
 * member of yet — so the guard chain starts and ends at (a) authenticated.
 */
export async function createHousehold(
  input: unknown,
): Promise<ActionResult<{ householdId: string }>> {
  try {
    const user = await requireAuth();
    const data = createHouseholdSchema.parse(input);

    const householdId = await prisma.$transaction(async (tx) => {
      const household = await tx.household.create({
        data: {
          name: data.name,
          currency: data.currency,
          createdByUserId: user.id,
          members: { create: { userId: user.id, role: "ADMIN" } },
          categories: { create: DEFAULT_CATEGORIES },
        },
        select: { id: true, name: true, currency: true },
      });

      // §11 — in the same transaction as the change itself.
      await writeAuditLog(tx, {
        householdId: household.id,
        actorUserId: user.id,
        action: "HOUSEHOLD_CREATED",
        entityType: "household",
        entityId: household.id,
        after: household,
      });

      return household.id;
    });

    revalidatePath("/households");
    return ok({ householdId });
  } catch (error) {
    return toActionResult(error);
  }
}
