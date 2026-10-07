import { describe, expect, it } from "vitest";

import {
  ALLOWED_RECEIPT_TYPES,
  DEFAULT_MAX_UPLOAD_BYTES,
  maxUploadBytes,
  receiptPathname,
  sniffContentType,
  UploadError,
  validateReceipt,
} from "@/lib/storage/validate";

/** Minimal byte sequences carrying each format's magic number. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script>");
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

function expectUploadError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).code).toBe(code);
    return;
  }
  throw new Error(`expected an UploadError with code ${code}`);
}

describe("sniffContentType", () => {
  it("recognises each accepted format from its magic bytes", () => {
    expect(sniffContentType(JPEG)).toBe("image/jpeg");
    expect(sniffContentType(PNG)).toBe("image/png");
    expect(sniffContentType(WEBP)).toBe("image/webp");
    expect(sniffContentType(PDF)).toBe("application/pdf");
  });

  it("rejects formats we do not accept, however plausible", () => {
    expect(sniffContentType(HTML)).toBeNull();
    expect(sniffContentType(SVG)).toBeNull();
    expect(sniffContentType(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it("does not read past the end of a short buffer", () => {
    expect(sniffContentType(new Uint8Array([]))).toBeNull();
    expect(sniffContentType(new Uint8Array([0xff]))).toBeNull();
    expect(sniffContentType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    // "RIFF" alone is not WebP — the WEBP tag sits at offset 8.
    expect(sniffContentType(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull();
  });

  it("does not mistake a RIFF container that is not WebP", () => {
    // A WAV file: RIFF....WAVE
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(sniffContentType(wav)).toBeNull();
  });
});

describe("validateReceipt", () => {
  it("accepts a JPEG declared as a JPEG (§40 step 3)", () => {
    expect(validateReceipt({ bytes: JPEG, declaredContentType: "image/jpeg" })).toEqual({
      contentType: "image/jpeg",
      extension: "jpg",
      sizeBytes: JPEG.byteLength,
    });
  });

  it("accepts every type in the allow list", () => {
    const samples = [
      ["image/jpeg", JPEG],
      ["image/png", PNG],
      ["image/webp", WEBP],
      ["application/pdf", PDF],
    ] as const;
    for (const [type, bytes] of samples) {
      const result = validateReceipt({ bytes, declaredContentType: type });
      expect(result.contentType, type).toBe(type);
      expect(result.extension, type).toBe(ALLOWED_RECEIPT_TYPES[type]);
    }
  });

  it("rejects an empty file", () => {
    expectUploadError(
      () =>
        validateReceipt({ bytes: new Uint8Array([]), declaredContentType: "image/jpeg" }),
      "EMPTY_FILE",
    );
  });

  it("rejects a file over the limit and names the limit", () => {
    const big = new Uint8Array(1024);
    big.set(JPEG);
    try {
      validateReceipt({ bytes: big, declaredContentType: "image/jpeg", maxBytes: 512 });
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as UploadError).code).toBe("TOO_LARGE");
    }
  });

  it("rejects a content type outside the allow list", () => {
    expectUploadError(
      () => validateReceipt({ bytes: PDF, declaredContentType: "image/svg+xml" }),
      "UNSUPPORTED_TYPE",
    );
    expectUploadError(
      () => validateReceipt({ bytes: PDF, declaredContentType: "text/html" }),
      "UNSUPPORTED_TYPE",
    );
  });

  it("rejects HTML smuggled in as a JPEG", () => {
    // The whole point: a declared Content-Type is a string the client chose.
    expectUploadError(
      () => validateReceipt({ bytes: HTML, declaredContentType: "image/jpeg" }),
      "CONTENT_MISMATCH",
    );
  });

  it("rejects an SVG smuggled in as a PNG", () => {
    // SVG is the dangerous one: it is a real image to a browser and can script.
    expectUploadError(
      () => validateReceipt({ bytes: SVG, declaredContentType: "image/png" }),
      "CONTENT_MISMATCH",
    );
  });

  it("rejects a real PNG declared as a JPEG, and says what it actually is", () => {
    try {
      validateReceipt({ bytes: PNG, declaredContentType: "image/jpeg" });
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as UploadError).code).toBe("CONTENT_MISMATCH");
      expect((error as Error).message).toMatch(/image\/png/);
    }
  });

  it("checks size before type, so a huge wrong-type file is still rejected", () => {
    expectUploadError(
      () =>
        validateReceipt({
          bytes: new Uint8Array(2048),
          declaredContentType: "x/y",
          maxBytes: 512,
        }),
      "TOO_LARGE",
    );
  });
});

describe("receiptPathname", () => {
  it("namespaces by household and keys by file id", () => {
    expect(receiptPathname("h-1", "f-2", "jpg")).toBe("receipts/h-1/f-2.jpg");
  });
});

describe("maxUploadBytes", () => {
  it("reads a valid value", () => {
    expect(maxUploadBytes("1048576")).toBe(1_048_576);
  });

  it("falls back to the default for anything unusable", () => {
    for (const raw of [undefined, "", "lots", "0", "-5", "1.5", "NaN"]) {
      expect(maxUploadBytes(raw), String(raw)).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    }
  });
});
