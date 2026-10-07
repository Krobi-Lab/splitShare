/**
 * Receipt upload validation.
 *
 * Pure, so every rule is unit-testable without a blob store. The important one
 * is `sniffContentType`: a browser-supplied `Content-Type` is just a string the
 * client chose, so it is never trusted on its own. The bytes are checked against
 * the declared type, and a mismatch is rejected — otherwise an HTML or SVG file
 * announced as `image/jpeg` would be stored and later served back.
 */

export type ReceiptContentType =
  "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

/** Content types a receipt may be, and the extension each is stored under. */
export const ALLOWED_RECEIPT_TYPES: Record<ReceiptContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadErrorCode =
  "EMPTY_FILE" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "CONTENT_MISMATCH";

export class UploadError extends Error {
  readonly code: UploadErrorCode;

  constructor(code: UploadErrorCode, message: string) {
    super(message);
    this.name = "UploadError";
    this.code = code;
  }
}

function isAllowedType(contentType: string): contentType is ReceiptContentType {
  return Object.hasOwn(ALLOWED_RECEIPT_TYPES, contentType);
}

function startsWith(
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0,
): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * The real content type according to the file's magic bytes, or null if it is
 * not one we accept.
 */
export function sniffContentType(bytes: Uint8Array): ReceiptContentType | null {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  // PNG: 89 "PNG" CR LF 1A LF
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  // WebP: "RIFF" <4 byte size> "WEBP"
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  // PDF: "%PDF-"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return "application/pdf";
  }
  return null;
}

export interface ValidatedReceipt {
  contentType: ReceiptContentType;
  extension: string;
  sizeBytes: number;
}

/**
 * Validates a receipt upload against its own bytes.
 *
 * @throws UploadError — the caller maps the code onto a field error.
 */
export function validateReceipt(input: {
  bytes: Uint8Array;
  declaredContentType: string;
  maxBytes?: number;
}): ValidatedReceipt {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const sizeBytes = input.bytes.byteLength;

  if (sizeBytes === 0) {
    throw new UploadError("EMPTY_FILE", "That file is empty.");
  }
  if (sizeBytes > maxBytes) {
    const limitMb = Math.floor(maxBytes / (1024 * 1024));
    throw new UploadError("TOO_LARGE", `Receipts must be ${limitMb}MB or smaller.`);
  }
  if (!isAllowedType(input.declaredContentType)) {
    throw new UploadError(
      "UNSUPPORTED_TYPE",
      "Receipts must be a JPEG, PNG, WebP or PDF.",
    );
  }

  const actual = sniffContentType(input.bytes);
  if (actual === null) {
    throw new UploadError(
      "CONTENT_MISMATCH",
      "That file is not a JPEG, PNG, WebP or PDF.",
    );
  }
  // A client can declare anything; only the bytes are evidence.
  if (actual !== input.declaredContentType) {
    throw new UploadError(
      "CONTENT_MISMATCH",
      `That file claims to be ${input.declaredContentType} but its contents are ${actual}.`,
    );
  }

  return { contentType: actual, extension: ALLOWED_RECEIPT_TYPES[actual], sizeBytes };
}

/**
 * Where a receipt lives in the blob store.
 *
 * Namespaced by household so a store listing is at least grouped sensibly, and
 * keyed by a server-generated id so nothing a user typed reaches the path.
 */
export function receiptPathname(
  householdId: string,
  fileId: string,
  extension: string,
): string {
  return `receipts/${householdId}/${fileId}.${extension}`;
}

/** Reads MAX_UPLOAD_BYTES, falling back to the default when unset or junk. */
export function maxUploadBytes(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_BYTES;
}
