import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every internal link must point at a route that exists.
 *
 * This exists because I shipped the same bug three times: a sender wired up
 * without its landing route. `authConfig.pages.signIn` pointed at /signin before
 * that page existed, `buildInvitationUrl` sent every invitation email to
 * /invite/<token> before that page existed, and the dashboard linked to
 * /expenses/new before that page existed. Each one was a 404 in the user's face
 * that typecheck, lint and the build all passed happily.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const APP_DIR = join(ROOT, "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return walk(full);
    }
    return [full];
  });
}

/** Route patterns the app serves, e.g. "/households/[householdId]". */
function routePatterns(): string[] {
  return walk(APP_DIR)
    .filter((file) => /\/(page|route)\.(tsx?|jsx?)$/.test(file))
    .map((file) => {
      // The leading slash is optional: app/page.tsx is the root route.
      const dir = relative(APP_DIR, file).replace(/\/?(page|route)\.(tsx?|jsx?)$/, "");
      // Route groups "(name)" and private "_folders" are not URL segments.
      const segments = dir
        .split("/")
        .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment));
      return `/${segments.join("/")}`;
    });
}

function toMatcher(pattern: string): RegExp {
  const body = pattern
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => {
      if (/^\[\.\.\..+\]$/.test(segment)) {
        return "(?:.+)"; // catch-all
      }
      if (/^\[.+\]$/.test(segment)) {
        return "[^/]+";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^/${body}$`);
}

/** Internal link targets written as string or template literals. */
function linkTargets(): Array<{ file: string; target: string }> {
  const sources = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "src"))].filter(
    (file) => /\.(tsx?|jsx?)$/.test(file) && !file.includes("/generated/"),
  );

  const found: Array<{ file: string; target: string }> = [];
  for (const file of sources) {
    const content = readFileSync(file, "utf8");
    // Quote-aware on purpose. A character class that merely excluded "{"
    // truncated `/households/${id}/settle-up` to "/households/$", which then
    // matched /households/[householdId] and hid the broken link.
    const patterns = [
      /href="(\/[^"]*)"/g,
      /href='(\/[^']*)'/g,
      /href=\{`(\/[^`]*)`\}/g,
      /(?:redirect|push|replace)\(\s*"(\/[^"]*)"/g,
      /(?:redirect|push|replace)\(\s*'(\/[^']*)'/g,
      /(?:redirect|push|replace)\(\s*`(\/[^`]*)`/g,
    ];
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        found.push({ file: relative(ROOT, file), target: match[1] });
      }
    }
  }
  return found;
}

/** `/households/${id}/expenses` -> `/households/x/expenses` for matching. */
function normalise(target: string): string {
  return (
    target
      .split("?")[0]
      .split("#")[0]
      .replace(/\$\{[^}]*\}/g, "x")
      .replace(/\/+$/, "") || "/"
  );
}

describe("internal links", () => {
  const patterns = routePatterns();
  const matchers = patterns.map(toMatcher);

  it("finds the app's routes", () => {
    expect(patterns).toContain("/");
    expect(patterns).toContain("/signin");
    expect(patterns.length).toBeGreaterThan(5);
  });

  it("points every internal link at a route that exists", () => {
    const broken = linkTargets().filter(({ target }) => {
      const path = normalise(target);
      // Public files are served from public/, not by a route.
      if (/\.[a-z0-9]{2,5}$/i.test(path)) {
        return false;
      }
      return !matchers.some((matcher) => matcher.test(path));
    });

    expect(
      broken.map(({ file, target }) => `${target}  (in ${file})`),
      "these links have no matching route",
    ).toEqual([]);
  });
});
