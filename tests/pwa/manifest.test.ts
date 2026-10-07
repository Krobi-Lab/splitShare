import { describe, expect, it } from "vitest";

import manifest from "../../app/manifest";

/**
 * The manifest is what makes the app installable, and the install criteria are
 * unforgiving: a missing field or a wrong size silently means "no install
 * prompt" rather than an error anybody sees.
 */
describe("web app manifest", () => {
  const value = manifest();

  it("carries everything an install prompt requires", () => {
    expect(value.name).toBeTruthy();
    expect(value.short_name).toBeTruthy();
    expect(value.start_url).toBeTruthy();
    expect(value.display).toBe("standalone");
    expect(value.icons?.length).toBeGreaterThan(0);
  });

  it("keeps short_name short enough not to be truncated on a home screen", () => {
    expect(value.short_name!.length).toBeLessThanOrEqual(12);
  });

  it("offers both 192 and 512 icons, which Chrome requires for installability", () => {
    const sizes = (value.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("includes a maskable icon, so Android does not letterbox it", () => {
    const maskable = (value.icons ?? []).filter((icon) => icon.purpose === "maskable");
    expect(maskable).toHaveLength(1);
    expect(maskable[0].sizes).toBe("512x512");
  });

  it("does not reuse one image for both any and maskable", () => {
    // Maskable artwork is padded into the safe zone; sharing a source would
    // either crop the plain icon's mark or leave the maskable one too small.
    const any = (value.icons ?? []).filter((icon) => icon.purpose === "any");
    const maskable = (value.icons ?? []).filter((icon) => icon.purpose === "maskable");
    for (const icon of maskable) {
      expect(any.map((candidate) => candidate.src)).not.toContain(icon.src);
    }
  });

  it("starts on the household list rather than the marketing page", () => {
    // Somebody who installed this already knows what it is.
    expect(value.start_url).toBe("/households");
  });

  it("scopes to the whole origin, so in-app links do not escape to a browser tab", () => {
    expect(value.scope).toBe("/");
  });

  it("points every icon and shortcut at a same-origin absolute path", () => {
    for (const icon of value.icons ?? []) {
      expect(icon.src.startsWith("/"), icon.src).toBe(true);
    }
    for (const shortcut of value.shortcuts ?? []) {
      expect(shortcut.url.startsWith("/"), shortcut.url).toBe(true);
    }
  });
});
