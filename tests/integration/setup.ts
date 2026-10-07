import { vi } from "vitest";

/**
 * Setup for the integration project, which runs real Server Actions against a
 * real database.
 *
 * This runs before any test file is imported, which matters: `src/lib/db/client`
 * reads DATABASE_URL at module evaluation, so it has to be pointed at the test
 * database before anything pulls it in.
 *
 * Only the session, Next's cache invalidation, React's render-scoped `cache` and
 * the blob store are stubbed. The money, guard, audit and state logic all run
 * for real — that is the point of this layer.
 */

// Never DATABASE_URL: these tests truncate every table, and pointing them at a
// development database would destroy its contents.
//
// When TEST_DATABASE_URL is unset the suites skip (§22), but the variable still
// has to hold something: `src/lib/db/client` throws at module evaluation
// without it, which would make the test file fail to import rather than skip.
// The placeholder is deliberately unusable, so anything that did try to query
// it fails obviously instead of reaching a real database.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://unused:unused@127.0.0.1:1/unused";

vi.mock("@/lib/auth", async () => {
  const { session } = await import("./session");
  return {
    auth: async () => {
      const current = session();
      return current.id === null
        ? null
        : { user: { id: current.id, name: current.name, email: current.email } };
    },
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {
      GET: async () => new Response(),
      POST: async () => new Response(),
    },
  };
});

// `revalidatePath` throws outside a request scope and is irrelevant here.
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));

// React's `cache` memoises per render pass. There is no render pass here, and
// memoising across a test would make `requireAuth` keep returning a stale
// identity after the test switches user — so it becomes a pass-through.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T>(fn: T) => fn };
});

// The one external service these tests cannot reach.
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string) => ({
    url: `https://blob.test/${pathname}`,
    pathname,
    contentType: "image/jpeg",
  }),
  del: async () => undefined,
  get: async () => null,
}));
