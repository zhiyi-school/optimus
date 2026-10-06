/**
 * Labels and tones for finding, severity, test run, ticket, conversation and assessment statuses, and platform labels.
 */

import type { RiskVerdict } from "@/automation-api/types";
import type {
  FindingStatus,
  Platform,
  RiskConversationEntryKind,
} from "@/database/types";

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

/** Maps an automation verdict to a finding status; anything unrecognised is inconclusive. */
export function mapVerdictToFindingStatus(verdict: RiskVerdict | string): FindingStatus {
  switch (verdict) {
    case "At Risk":
      return "at_risk";
    case "Reduced Risk":
      return "reduced_risk";
    case "Inconclusive":
    default:
      return "inconclusive";
  }
}

export const severityConfig: Record<string, { label: string; tone: Tone }> = {
  critical: { label: "Critical", tone: "danger" },
  high: { label: "High", tone: "danger" },
  medium: { label: "Medium", tone: "warning" },
  low: { label: "Low", tone: "info" },
  info: { label: "Info", tone: "neutral" },
};

/** The tone for a severity, neutral when unknown or missing. */
export function severityToneOf(severity: string | null | undefined): Tone {
  if (!severity) return "neutral";
  return severityConfig[severity.toLowerCase()]?.tone ?? "neutral";
}

/** The label for a severity, capitalising unknown values; "Unrated" when missing. */
export function severityLabelOf(severity: string | null | undefined): string {
  if (!severity) return "Unrated";
  return (
    severityConfig[severity.toLowerCase()]?.label ??
    severity.charAt(0).toUpperCase() + severity.slice(1)
  );
}

export const testRunStatusConfig: Record<
  string,
  { label: string; tone: Tone }
> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export type ConversationEventKind = Exclude<RiskConversationEntryKind, "message">;

export const conversationEventConfig: Record<
  ConversationEventKind,
  { label: string; tone: Tone }
> = {
  classification_changed: { label: "Classification changed", tone: "info" },
  retest_requested: { label: "Reassessment requested", tone: "warning" },
  retest_started: { label: "Reassessment started", tone: "warning" },
  retest_completed: { label: "Reassessment completed", tone: "success" },
  retest_failed: { label: "Reassessment did not complete", tone: "danger" },
  retest_withdrawn: { label: "Reassessment withdrawn", tone: "neutral" },
  remediation_started: { label: "Remediation started", tone: "info" },
  remediation_withdrawn: { label: "Remediation withdrawn", tone: "neutral" },
  fix_submitted: { label: "Fix submitted for review", tone: "info" },
  risk_accepted: { label: "Risk accepted", tone: "success" },
  risk_acceptance_retracted: { label: "Risk acceptance retracted", tone: "neutral" },
  risk_acceptance_ended: { label: "Risk acceptance ended", tone: "info" },
};

/** Summarises a conversation event from its recorded status values, never by showing raw metadata. */
export function conversationEventSummary(
  kind: ConversationEventKind,
  metadata: Record<string, unknown> | null | undefined,
): string {
  if (kind === "risk_acceptance_ended") {
    const to = findingStatusLabelOf(metadata?.new_status);
    return to
      ? `Risk acceptance ended: the risk is now ${to}`
      : conversationEventConfig[kind].label;
  }
  if (kind !== "classification_changed") return conversationEventConfig[kind].label;
  const to = findingStatusLabelOf(metadata?.new_status);
  if (!to) return conversationEventConfig[kind].label;
  const from = findingStatusLabelOf(metadata?.previous_status);
  return from
    ? `Classification changed from ${from} to ${to}`
    : `Classification set to ${to}`;
}

/** The label of a known finding status, or null. */
function findingStatusLabelOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return findingStatusConfig[value as FindingStatus]?.label ?? null;
}

export const assessmentStatusConfig: Record<
  string,
  { label: string; tone: Tone }
> = {
  queued: { label: "Not Started", tone: "neutral" },
  waiting: { label: "Waiting to start", tone: "warning" },
  running: { label: "Assessing in progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

/** The display name of a platform. */
export function platformLabel(platform: Platform | string): string {
  return platform === "ios" ? "iOS" : "Android";
}

/** An application's name qualified by its platform, telling apart the iOS and Android builds of one app. */
export function applicationLabel(application: { name: string; platform: Platform | string }): string {
  return `${application.name} (${platformLabel(application.platform)})`;
}
