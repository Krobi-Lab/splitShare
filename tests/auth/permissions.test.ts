import { describe, expect, it } from "vitest";

import {
  ALL_CAPABILITIES,
  can,
  CAPABILITY_LABELS,
  capabilitiesFor,
  type Capability,
} from "@/lib/auth/permissions";
import type { HouseholdRole } from "@/generated/prisma/enums";

/**
 * The §5 role matrix, transcribed from the spec table independently of the
 * implementation. A wrong cell here is a privilege-escalation bug, so the test
 * asserts every cell rather than sampling.
 */
const EXPECTED: Record<Capability, Record<HouseholdRole, boolean>> = {
  VIEW_HOUSEHOLD: { ADMIN: true, MEMBER: true, VIEWER: true },
  CREATE_EXPENSE: { ADMIN: true, MEMBER: true, VIEWER: false },
  ACCEPT_OWN_SPLIT: { ADMIN: true, MEMBER: true, VIEWER: false },
  RECORD_OWN_PAYMENT: { ADMIN: true, MEMBER: true, VIEWER: false },
  CONFIRM_PAYMENT_RECEIVED: { ADMIN: true, MEMBER: true, VIEWER: false },
  MANAGE_MEMBERS: { ADMIN: true, MEMBER: false, VIEWER: false },
  MANAGE_SETTINGS: { ADMIN: true, MEMBER: false, VIEWER: false },
  LOCK_EXPENSE: { ADMIN: true, MEMBER: false, VIEWER: false },
  VIEW_AUDIT_LOGS: { ADMIN: true, MEMBER: false, VIEWER: false },
};

const ROLES: HouseholdRole[] = ["ADMIN", "MEMBER", "VIEWER"];

describe("§5 role matrix", () => {
  it.each(Object.entries(EXPECTED))(
    "%s matches the spec for every role",
    (capability, row) => {
      for (const role of ROLES) {
        expect(can(role, capability as Capability), `${role} / ${capability}`).toBe(
          row[role],
        );
      }
    },
  );

  it("covers exactly the capabilities the spec defines", () => {
    expect([...ALL_CAPABILITIES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("labels every capability, for denial messages", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(CAPABILITY_LABELS[capability]).toBeTruthy();
    }
  });

  it("gives a VIEWER read access and nothing else", () => {
    expect(capabilitiesFor("VIEWER")).toEqual(["VIEW_HOUSEHOLD"]);
  });

  it("does not let a MEMBER manage the household or lock expenses", () => {
    const member = capabilitiesFor("MEMBER");
    expect(member).not.toContain("MANAGE_MEMBERS");
    expect(member).not.toContain("MANAGE_SETTINGS");
    expect(member).not.toContain("LOCK_EXPENSE");
    expect(member).not.toContain("VIEW_AUDIT_LOGS");
  });

  it("grants an ADMIN every capability", () => {
    expect(capabilitiesFor("ADMIN").sort()).toEqual([...ALL_CAPABILITIES].sort());
  });
});
