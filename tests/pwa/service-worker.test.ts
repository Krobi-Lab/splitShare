import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The service worker is plain JS served as a static asset, so it is read as
 * source here. These assert its CACHING POLICY, which is the security-relevant
 * part: the Cache API is readable by any script on the origin and survives
 * sign-out, so anything cached is effectively left on the device.
 */
const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

describe("service worker caching policy", () => {
  it("ignores every non-GET request", () => {
    // Server Actions are POSTs that move money. Replaying one from a cache
    // would be a correctness disaster.
    expect(source).toMatch(/request\.method !== "GET"/);
  });

  it("never touches anything under /api/", () => {
    // /api/receipts serves private financial documents; /api/auth handles
    // credentials.
    expect(source).toMatch(/pathname\.startsWith\("\/api\/"\)/);
  });

  it("only ever caches immutable build output", () => {
    expect(source).toMatch(/_next\/static\//);
  });

  it("goes to the network first for navigations", () => {
    // A signed-in page carries balances, so it must never be served from cache.
    expect(source).toMatch(/request\.mode === "navigate"/);
    const navigationBlock = source.slice(source.indexOf('request.mode === "navigate"'));
    expect(navigationBlock).toMatch(/await fetch\(request\)/);
  });

  it("falls back to the offline shell rather than a cached page", () => {
    expect(source).toMatch(/OFFLINE_URL/);
    expect(source).toMatch(/const OFFLINE_URL = "\/offline"/);
  });

  it("drops caches from previous versions on activate", () => {
    expect(source).toMatch(/caches\.delete/);
  });

  it("supports being told to clear everything, for sign-out", () => {
    expect(source).toMatch(/CLEAR_CACHES/);
  });

  it("is syntactically valid JavaScript", () => {
    // It is never bundled or typechecked, so nothing else would catch a typo.
    expect(() => new Function(source.replace(/\bself\b/g, "globalThis"))).not.toThrow();
  });
});
