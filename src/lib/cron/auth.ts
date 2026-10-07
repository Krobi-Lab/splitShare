import "server-only";

/**
 * §20 — authenticates the reminders cron.
 *
 * Lives here rather than in the route because §21 requires that
 * `grep -rn "process.env" src/components app | grep -v NEXT_PUBLIC` finds
 * nothing: no secret is read anywhere under `app/`. A route handler never
 * reaches the client, so this is about keeping that check meaningful rather
 * than papering over an exception to it.
 */
export function isCronAuthorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  // An unset secret must not mean "allow everyone". Refusing is the safe
  // failure: a cron that does not run is recoverable, an open endpoint that
  // records rows and sends email is not.
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set; refusing to run");
    return false;
  }

  const header = request.headers.get("authorization");
  if (!header) {
    return false;
  }

  const expected = `Bearer ${secret}`;
  // Compared over a fixed length so the check does not leak the secret's length
  // through its own timing.
  if (header.length !== expected.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < header.length; i += 1) {
    mismatch |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
