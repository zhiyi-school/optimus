import type { FindingStatus, TicketStatus, TicketType } from "@/data/types";

export type Tone = "danger" | "success" | "warning" | "neutral" | "info";

export const toneClasses: Record<Tone, string> = {
  danger: "bg-danger/10 text-danger border-danger/20",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-primary/10 text-primary border-primary/20",
};

export const findingStatusConfig: Record<
  FindingStatus,
  { label: string; tone: Tone }
> = {
  at_risk: { label: "At Risk", tone: "danger" },
  reduced_risk: { label: "Reduced Risk", tone: "success" },
  inconclusive: { label: "Inconclusive", tone: "warning" },
};

export const severityConfig: Record<string, { label: string; tone: Tone }> = {
  critical: { label: "Critical", tone: "danger" },
  high: { label: "High", tone: "danger" },
  medium: { label: "Medium", tone: "warning" },
  low: { label: "Low", tone: "info" },
  info: { label: "Info", tone: "neutral" },
};

export function severityToneOf(severity: string | null | undefined): Tone {
  if (!severity) return "neutral";
  return severityConfig[severity.toLowerCase()]?.tone ?? "neutral";
}

export function severityLabelOf(severity: string | null | undefined): string {
  if (!severity) return "Unrated";
  return (
    severityConfig[severity.toLowerCase()]?.label ??
    severity.charAt(0).toUpperCase() + severity.slice(1)
  );
}

export const platformConfig: Record<string, { label: string }> = {
  ios: { label: "iOS" },
  android: { label: "Android" },
};

export const testRunStatusConfig: Record<
  string,
  { label: string; tone: Tone }
> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export const ticketStatusConfig: Record<
  TicketStatus,
  { label: string; tone: Tone }
> = {
  open: { label: "Open", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "info" },
  fix_submitted: { label: "Fix Submitted", tone: "info" },
  retest_requested: { label: "Retest Requested", tone: "warning" },
  retest_in_progress: { label: "Retest In Progress", tone: "warning" },
  under_review: { label: "Under Review", tone: "warning" },
  accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  closed: { label: "Closed", tone: "neutral" },
};

export const ticketTypeConfig: Record<TicketType, { label: string }> = {
  remediation: { label: "Remediation" },
  risk_acceptance: { label: "Risk Acceptance" },
  retest_request: { label: "Retest Request" },
  app_provisioning: { label: "App Provisioning" },
};

export const assessmentStatusConfig: Record<
  string,
  { label: string; tone: Tone }
> = {
  queued: { label: "Not Started", tone: "neutral" },
  running: { label: "Assessing in progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};
