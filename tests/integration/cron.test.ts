import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "../../app/api/cron/reminders/route";

/**
 * §20 — the cron route must verify `Authorization: Bearer $CRON_SECRET` and
 * answer 401 otherwise.
 *
 * These run without a database: every case here is refused before the handler
 * reaches a query, which is itself the property being asserted.
 */

const SECRET = "test-cron-secret-value";
let original: string | undefined;

beforeEach(() => {
  original = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  if (original === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = original;
  }
});

function request(authorization?: string): Request {
  return new Request("https://example.test/api/cron/reminders", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("cron authorization", () => {
  it("refuses a request with no Authorization header", async () => {
    expect((await GET(request())).status).toBe(401);
  });

  it("refuses a wrong secret", async () => {
    expect((await GET(request("Bearer not-the-secret"))).status).toBe(401);
  });

  it("refuses the right secret without the Bearer scheme", async () => {
    expect((await GET(request(SECRET))).status).toBe(401);
  });

  it("refuses a secret that merely starts correctly", async () => {
    expect((await GET(request(`Bearer ${SECRET}extra`))).status).toBe(401);
    expect((await GET(request(`Bearer ${SECRET.slice(0, -1)}`))).status).toBe(401);
  });

  it("refuses everything when CRON_SECRET is unset", async () => {
    // An unset secret must not mean "allow everyone". A cron that does not run
    // is recoverable; an open endpoint that sends email is not.
    delete process.env.CRON_SECRET;
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer "))).status).toBe(401);
    expect((await GET(request("Bearer undefined"))).status).toBe(401);
  });

  it("says nothing useful in the refusal", async () => {
    const body = await (await GET(request("Bearer wrong"))).json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("is case sensitive about the scheme", async () => {
    expect((await GET(request(`bearer ${SECRET}`))).status).toBe(401);
  });

  it("lets the correct secret through", async () => {
    // The negative control. Every assertion above would pass just as happily if
    // the check always refused, so this is what proves they mean anything.
    // Not 200: without a database the handler gets past the gate and then fails
    // its query, which is exactly the distinction being drawn.
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).not.toBe(401);
    expect([200, 500]).toContain(response.status);
  });
});
