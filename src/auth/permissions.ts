/**
 * Role capabilities and the pure access decisions built on them; the database still enforces authorization.
 */

import type { Profile, UserRole } from "@/data/types";
import { createDebug } from "@/lib/debug";

const debug = createDebug("auth:permissions");

export type Capability =
  | "view_dashboard"
  | "view_assessments"
  | "view_findings"
  | "view_tickets"
  | "view_resolve"
  | "create_ticket"
  | "view_risk_conversation"
  | "comment_risk_conversation"
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

/** True when any of the roles grants the capability. */
export function roleCan(roles: UserRole[] | undefined, capability: Capability): boolean {
  if (!roles) return false;
  return roles.some((role) => roleCapabilities[role]?.includes(capability) ?? false);
}

/** True when the roles include `role`; a mixed-role profile holds every role it lists. */
export function hasRole(roles: UserRole[] | undefined, role: UserRole): boolean {
  return roles?.includes(role) ?? false;
}

const rolePrecedence: UserRole[] = ["security", "cio", "developer", "admin"];

/** The highest-precedence role held (security, cio, developer, admin), else the first listed. */
export function primaryRole(roles: UserRole[] | undefined): UserRole | undefined {
  if (!roles || roles.length === 0) return undefined;
  return rolePrecedence.find((role) => roles.includes(role)) ?? roles[0];
}

export type ResolveAccess = "loading" | "unauthorized" | "inactive" | "no_team" | "ready";

type ProfileLike = Pick<Profile, "roles" | "team_id"> & Partial<Pick<Profile, "is_active">>;

/** Classifies a profile's access to Resolve; `no_team` is a setup state, never a grant to every app. */
export function resolveAccess(profile: ProfileLike | null | undefined, loading = false): ResolveAccess {
  if (loading) {
    debug("resolve access: loading");
    return "loading";
  }
  if (!profile) {
    debug("resolve access: unauthorized; no profile");
    return "unauthorized";
  }
  if (!roleCan(profile.roles, "view_resolve")) {
    debug("resolve access: unauthorized; role lacks view_resolve", { roles: profile.roles });
    return "unauthorized";
  }
  if (profile.is_active === false) {
    debug("resolve access: inactive profile", { roles: profile.roles });
    return "inactive";
  }
  if (!profile.team_id) {
    debug("resolve access: no team", { roles: profile.roles });
    return "no_team";
  }
  debug("resolve access: ready", { roles: profile.roles, teamId: profile.team_id });
  return "ready";
}

/** Post-login landing route: developers start in Resolve whatever else they hold, others at `/`. */
export function defaultRouteFor(profile: ProfileLike | null | undefined): string {
  if (!profile) {
    debug("default route: no profile; using /");
    return "/";
  }
  const isDeveloper = profile.roles?.includes("developer") ?? false;
  const route = isDeveloper && roleCan(profile.roles, "view_resolve") ? "/resolve" : "/";
  debug("default route", { roles: profile.roles, isDeveloper, route });
  return route;
}
