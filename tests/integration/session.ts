/**
 * The identity the mocked session reports.
 *
 * Held on `globalThis` rather than in a module binding because the `vi.mock`
 * factory in setup.ts and the test file that calls `actAs` are separate module
 * graphs under Vitest's mock hoisting; a plain export would give them two
 * different copies.
 */

export interface TestSession {
  id: string | null;
  name: string | null;
  email: string | null;
}

const KEY = "__splitshare_test_session__";

export function session(): TestSession {
  const store = globalThis as unknown as Record<string, TestSession | undefined>;
  store[KEY] ??= { id: null, name: null, email: null };
  return store[KEY];
}

/** Signs the given user in for subsequent action calls. */
export function actAs(user: {
  id: string;
  name?: string | null;
  email?: string | null;
}): void {
  const current = session();
  current.id = user.id;
  current.name = user.name ?? null;
  current.email = user.email ?? `${user.id}@example.test`;
}

export function signOutForTests(): void {
  const current = session();
  current.id = null;
  current.name = null;
  current.email = null;
}
