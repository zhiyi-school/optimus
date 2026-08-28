import type { UserRole } from "@/data/types";

export type Capability =
  | "view_dashboard"
  | "view_assessments"
  | "view_findings"
  | "view_tickets"
  | "create_ticket"
  | "comment_ticket"
  | "submit_fix"
  | "request_retest"
  | "run_test"
  | "update_finding"
  | "review_risk_acceptance"
  | "close_ticket"
  | "view_executive_metrics"
  | "access_admin";

export const roleCapabilities: Record<UserRole, Capability[]> = {
  developer: [
    "view_dashboard",
    "view_findings",
    "view_tickets",
    "create_ticket",
    "comment_ticket",
    "submit_fix",
    "request_retest",
  ],

  security: [
    "view_dashboard",
    "view_assessments",
    "view_findings",
    "view_tickets",
    "comment_ticket",
    "run_test",
    "update_finding",
    "review_risk_acceptance",
    "close_ticket",
  ],

  cio: [
    "view_dashboard",
    "view_assessments",
    "view_findings",
    "view_tickets",
    "view_executive_metrics",
  ],

  admin: ["view_dashboard", "access_admin"],
};

export function roleCan(roles: UserRole[] | undefined, capability: Capability): boolean {
  if (!roles) return false;
  return roles.some((role) => roleCapabilities[role].includes(capability));
}

const rolePrecedence: UserRole[] = ["security", "cio", "developer", "admin"];

export function primaryRole(roles: UserRole[] | undefined): UserRole | undefined {
  if (!roles || roles.length === 0) return undefined;
  return rolePrecedence.find((role) => roles.includes(role)) ?? roles[0];
}
