"use server";

import { fail, ok, toActionResult, type ActionResult } from "@/lib/actions/result";
import { requireCapability } from "@/lib/auth/guards";
import { uploadReceipt } from "@/lib/storage/blob";
import { maxUploadBytes, UploadError } from "@/lib/storage/validate";

/**
 * Uploads a receipt for an expense (§40 step 3).
 *
 * Takes `FormData` because that is what a file input gives a Server Action.
 * Requires CREATE_EXPENSE rather than mere membership: a VIEWER has no reason
 * to be able to write to the blob store.
 */
export async function uploadReceiptAction(
  formData: FormData,
): Promise<ActionResult<{ fileId: string }>> {
  try {
    const householdId = formData.get("householdId");
    const file = formData.get("file");

    if (typeof householdId !== "string") {
      return fail("VALIDATION", "Missing household.", {
        fieldErrors: { householdId: ["Required"] },
      });
    }
    if (!(file instanceof File)) {
      return fail("VALIDATION", "Choose a file to upload.", {
        fieldErrors: { file: ["Required"] },
      });
    }

    const membership = await requireCapability(householdId, "CREATE_EXPENSE");

    // Checked before reading the body into memory, so an oversized upload is
    // rejected without buffering all of it.
    const limit = maxUploadBytes(process.env.MAX_UPLOAD_BYTES);
    if (file.size > limit) {
      return fail(
        "VALIDATION",
        `Receipts must be ${Math.floor(limit / (1024 * 1024))}MB or smaller.`,
        {
          fieldErrors: { file: ["That file is too large"] },
        },
      );
    }

    const stored = await uploadReceipt({
      householdId,
      uploadedByUserId: membership.userId,
      bytes: new Uint8Array(await file.arrayBuffer()),
      declaredContentType: file.type,
    });

    return ok({ fileId: stored.fileId });
  } catch (error) {
    if (error instanceof UploadError) {
      return fail("VALIDATION", error.message, {
        fieldErrors: { file: [error.message] },
      });
    }
    return toActionResult(error);
  }
}
