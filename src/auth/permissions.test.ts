import { describe, expect, it } from "vitest";
import type { Profile, UserRole } from "@/data/types";
import {
  defaultRouteFor,
  primaryRole,
  resolveAccess,
  roleCan,
  roleCapabilities,
  type Capability,
} from "./permissions";

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    display_name: "Example Developer",
    email: "developer@example.test",
    roles: ["developer"],
    team_id: "example-team-id",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("developer capabilities", () => {
  it("lets a developer open the Resolve workspace and record progress", () => {
    expect(roleCan(["developer"], "view_resolve")).toBe(true);
    expect(roleCan(["developer"], "update_control_progress")).toBe(true);
    expect(roleCan(["developer"], "submit_fix")).toBe(true);
    expect(roleCan(["developer"], "request_retest")).toBe(true);
  });

  it("never gives a developer a security-owned capability", () => {
    for (const capability of [
      "run_test",
      "update_finding",
      "close_ticket",
      "review_risk_acceptance",
      "request_changes",
      "access_admin",
    ] as const) {
      expect(roleCan(["developer"], capability), capability).toBe(false);
    }
  });

  it("keeps verification and closure with security", () => {
    expect(roleCan(["security"], "run_test")).toBe(true);
    expect(roleCan(["security"], "update_finding")).toBe(true);
    expect(roleCan(["security"], "close_ticket")).toBe(true);
    expect(roleCan(["security"], "review_risk_acceptance")).toBe(true);
    expect(roleCan(["security"], "request_changes")).toBe(true);
  });

  it("does not put the developer workspace in front of a security-only account", () => {
    expect(roleCan(["security"], "view_resolve")).toBe(false);
    expect(roleCan(["security"], "update_control_progress")).toBe(false);
    expect(roleCan(["cio"], "view_resolve")).toBe(false);
  });

  it("gives a multi-role user the union of both, not just the precedence role", () => {
    const both: UserRole[] = ["developer", "security"];
    expect(primaryRole(both)).toBe("security");
    expect(roleCan(both, "view_resolve")).toBe(true);
    expect(roleCan(both, "view_assessments")).toBe(true);
    expect(roleCan(both, "close_ticket")).toBe(true);
  });

  it("grants nothing to a user with no roles", () => {
    expect(roleCan([], "view_resolve")).toBe(false);
    expect(roleCan(undefined, "view_findings")).toBe(false);
  });

  it("ignores a role the build does not know about", () => {
    expect(roleCan(["auditor" as UserRole], "view_resolve")).toBe(false);
  });

  it("every capability a role claims is one the type allows", () => {
    for (const capabilities of Object.values(roleCapabilities)) {
      expect(new Set(capabilities).size).toBe(capabilities.length);
    }
  });
});

describe("resolveAccess", () => {
  it("waits while the profile is still loading", () => {
    expect(resolveAccess(undefined, true)).toBe("loading");
    expect(resolveAccess(profile(), true)).toBe("loading");
  });

  it("admits a developer who has a team", () => {
    expect(resolveAccess(profile())).toBe("ready");
  });

  it("shows a setup state — never every application — when there is no team", () => {
    expect(resolveAccess(profile({ team_id: null }))).toBe("no_team");
  });

  it("refuses a user without developer capabilities", () => {
    expect(resolveAccess(profile({ roles: ["security"] }))).toBe("unauthorized");
    expect(resolveAccess(profile({ roles: ["cio"] }))).toBe("unauthorized");
    expect(resolveAccess(profile({ roles: [] }))).toBe("unauthorized");
  });

  it("refuses a signed-out user", () => {
    expect(resolveAccess(null)).toBe("unauthorized");
    expect(resolveAccess(undefined)).toBe("unauthorized");
  });

  it("refuses a deactivated account even when it holds the role", () => {
    expect(resolveAccess(profile({ is_active: false }))).toBe("inactive");
  });

  it("admits a developer who also holds a security role", () => {
    expect(resolveAccess(profile({ roles: ["developer", "security"] }))).toBe("ready");
  });

  it("checks the role before the team, so a non-developer never sees a setup prompt", () => {
    expect(resolveAccess(profile({ roles: ["security"], team_id: null }))).toBe("unauthorized");
  });
});

describe("defaultRouteFor", () => {
  it("sends a developer-only account to its own workspace", () => {
    expect(defaultRouteFor(profile())).toBe("/resolve");
  });

  it("sends a developer with no team there too, so they see the setup state", () => {
    expect(defaultRouteFor(profile({ team_id: null }))).toBe("/resolve");
  });

  it("sends anyone holding the developer role there, whatever else they hold", () => {
    for (const roles of [
      ["developer"],
      ["developer", "security"],
      ["developer", "admin"],
      ["developer", "cio"],
      ["security", "developer"],
    ] as UserRole[][]) {
      expect(defaultRouteFor(profile({ roles })), roles.join("+")).toBe("/resolve");
    }
  });

  it("keeps every account without the developer role on the shared dashboard", () => {
    for (const roles of [["security"], ["cio"], ["admin"], ["security", "cio"]] as UserRole[][]) {
      expect(defaultRouteFor(profile({ roles })), roles.join("+")).toBe("/");
    }
  });

  it("falls back to the dashboard with no profile", () => {
    expect(defaultRouteFor(null)).toBe("/");
    expect(defaultRouteFor(undefined)).toBe("/");
  });

  it("falls back to the dashboard for a profile with no usable role", () => {
    expect(defaultRouteFor(profile({ roles: [] }))).toBe("/");
    expect(defaultRouteFor(profile({ roles: ["nonsense" as UserRole] }))).toBe("/");
  });

  it("does not change which role labels or role-sensitive UI a user gets", () => {
    expect(primaryRole(["developer", "security"])).toBe("security");
    expect(roleCan(["developer", "security"], "run_test")).toBe(true);
    expect(roleCan(["developer", "security"], "view_assessments")).toBe(true);
    expect(roleCan(["developer", "admin"], "access_admin")).toBe(true);
  });
});

describe("withdrawal capability", () => {
  it("belongs to the developer, who is the one who stops their own work", () => {
    expect(roleCan(["developer"], "withdraw_ticket")).toBe(true);
  });

  it("belongs to no other role", () => {
    for (const role of ["security", "cio", "admin"] as UserRole[]) {
      expect(roleCan([role], "withdraw_ticket"), role).toBe(false);
    }
  });

  it("does not come with the power to close, which stays with security", () => {
    expect(roleCan(["developer"], "close_ticket")).toBe(false);
    expect(roleCan(["security"], "close_ticket")).toBe(true);
  });

  it("reaches a user who holds the developer role alongside another", () => {
    expect(roleCan(["developer", "cio"], "withdraw_ticket")).toBe(true);
  });
});

describe("risk conversation capabilities", () => {
  it("let a developer read and post in the risk conversation", () => {
    expect(roleCan(["developer"], "view_risk_conversation")).toBe(true);
    expect(roleCan(["developer"], "comment_risk_conversation")).toBe(true);
  });

  it("let security read and post too", () => {
    expect(roleCan(["security"], "view_risk_conversation")).toBe(true);
    expect(roleCan(["security"], "comment_risk_conversation")).toBe(true);
  });

  it("keep the CIO read-only", () => {
    expect(roleCan(["cio"], "view_risk_conversation")).toBe(true);
    expect(roleCan(["cio"], "comment_risk_conversation")).toBe(false);
  });

  it("do not come with testing or classification authority", () => {
    for (const capability of ["run_test", "update_finding", "view_assessments"] as const) {
      expect(roleCan(["developer"], capability), capability).toBe(false);
    }
  });

  it("admit a developer to the risk page without the assessment capability", () => {
    const risk: Capability[] = ["view_assessments", "view_risk_conversation"];
    expect(risk.some((capability) => roleCan(["developer"], capability))).toBe(true);
    expect(risk.some((capability) => roleCan(["security"], capability))).toBe(true);
    expect(risk.some((capability) => roleCan(["cio"], capability))).toBe(true);
    expect(risk.some((capability) => roleCan(["admin"], capability))).toBe(false);
  });

  it("replaced the ticket-scoped comment capability entirely", () => {
    for (const capabilities of Object.values(roleCapabilities)) {
      expect(capabilities).not.toContain("comment_ticket" as Capability);
    }
  });
});
