import type { Profile, UserRole } from "@/data/types";

export type Capability =
  | "view_dashboard"
  | "view_assessments"
  | "view_findings"
  | "view_tickets"
  | "view_resolve"
  | "create_ticket"
  | "view_risk_conversation"
  | "comment_risk_conversation"
  | "submit_fix"
  | "request_retest"
  | "update_control_progress"
  | "withdraw_ticket"
  | "run_test"
  | "update_finding"
  | "request_changes"
  | "review_risk_acceptance"
  | "close_ticket"
  | "view_executive_metrics"
  | "access_admin";

export const roleCapabilities: Record<UserRole, Capability[]> = {
  developer: [
    "view_dashboard",
    "view_findings",
    "view_tickets",
    "view_resolve",
    "create_ticket",
    "view_risk_conversation",
    "comment_risk_conversation",
    "submit_fix",
    "request_retest",
    "update_control_progress",
    "withdraw_ticket",
  ],

  security: [
    "view_dashboard",
    "view_assessments",
    "view_findings",
    "view_tickets",
    "view_risk_conversation",
    "comment_risk_conversation",
    "run_test",
    "update_finding",
    "request_changes",
    "review_risk_acceptance",
    "close_ticket",
  ],

  cio: [
    "view_dashboard",
    "view_assessments",
    "view_findings",
    "view_tickets",
    "view_risk_conversation",
    "view_executive_metrics",
  ],

  admin: ["view_dashboard", "access_admin"],
};

export function roleCan(roles: UserRole[] | undefined, capability: Capability): boolean {
  if (!roles) return false;
  return roles.some((role) => roleCapabilities[role]?.includes(capability) ?? false);
}

const rolePrecedence: UserRole[] = ["security", "cio", "developer", "admin"];

export function primaryRole(roles: UserRole[] | undefined): UserRole | undefined {
  if (!roles || roles.length === 0) return undefined;
  return rolePrecedence.find((role) => roles.includes(role)) ?? roles[0];
}

export type ResolveAccess = "loading" | "unauthorized" | "inactive" | "no_team" | "ready";

type ProfileLike = Pick<Profile, "roles" | "team_id"> & Partial<Pick<Profile, "is_active">>;

/** `no_team` is a setup state, not a grant — it never falls back to every application. */
export function resolveAccess(profile: ProfileLike | null | undefined, loading = false): ResolveAccess {
  if (loading) return "loading";
  if (!profile) return "unauthorized";
  if (!roleCan(profile.roles, "view_resolve")) return "unauthorized";
  if (profile.is_active === false) return "inactive";
  if (!profile.team_id) return "no_team";
  return "ready";
}

/** Post-login landing route: holding the developer role starts you in Resolve, whatever else you hold. */
export function defaultRouteFor(profile: ProfileLike | null | undefined): string {
  if (!profile) return "/";
  const isDeveloper = profile.roles?.includes("developer") ?? false;
  return isDeveloper && roleCan(profile.roles, "view_resolve") ? "/resolve" : "/";
}
