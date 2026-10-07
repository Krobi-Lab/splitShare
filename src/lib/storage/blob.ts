import "server-only";

import { randomUUID } from "node:crypto";

import { put, del } from "@vercel/blob";

import { prisma } from "@/lib/db/client";

import { maxUploadBytes, receiptPathname, validateReceipt } from "./validate";

/**
 * Receipt storage on Vercel Blob.
 *
 * Receipts are stored with `access: "private"`. They are financial documents —
 * a bill with an address on it, a card receipt — so a world-readable URL would
 * leak household data to anyone who ever saw the link. Private blobs are read
 * back through `app/api/receipts/[fileId]/route.ts`, which re-checks household
 * membership on every request.
 *
 * The `file_uploads` row and the blob are written in that order on purpose: a
 * row with no blob renders as a broken receipt, which is recoverable, whereas a
 * blob with no row is unreferenced garbage nobody will ever find.
 */

export interface StoredReceipt {
  fileId: string;
  pathname: string;
  contentType: string;
  sizeBytes: number;
}

export async function uploadReceipt(options: {
  householdId: string;
  uploadedByUserId: string;
  bytes: Uint8Array;
  declaredContentType: string;
}): Promise<StoredReceipt> {
  const validated = validateReceipt({
    bytes: options.bytes,
    declaredContentType: options.declaredContentType,
    maxBytes: maxUploadBytes(process.env.MAX_UPLOAD_BYTES),
  });

  const fileId = randomUUID();
  const pathname = receiptPathname(options.householdId, fileId, validated.extension);

  const blob = await put(pathname, Buffer.from(options.bytes), {
    access: "private",
    contentType: validated.contentType,
    // The pathname already carries a server-generated uuid, so a suffix would
    // only make the stored path unpredictable to us.
    addRandomSuffix: false,
  });

  try {
    await prisma.fileUpload.create({
      data: {
        id: fileId,
        householdId: options.householdId,
        uploadedByUserId: options.uploadedByUserId,
        url: blob.url,
        pathname,
        contentType: validated.contentType,
        sizeBytes: validated.sizeBytes,
      },
    });
  } catch (error) {
    // Nothing references this blob, so leaving it would be a permanent orphan.
    await del(pathname).catch(() => undefined);
    throw error;
  }

  return {
    fileId,
    pathname,
    contentType: validated.contentType,
    sizeBytes: validated.sizeBytes,
  };
}
