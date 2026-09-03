import { compareByName } from "@/lib/utils";
import type { Application, Assessment, Finding, FindingStatus } from "@/data/types";

export type AssessmentRow = Assessment & { application: Application | null };

/** Least reassuring first, so opening a completed assessment lands on work that still needs a decision. */
const RISK_PRIORITY: (FindingStatus | "untested")[] = ["at_risk", "inconclusive", "untested"];

/**
 * The feature-risk a completed assessment should open on. Catalogue order is the
 * tie-breaker, so the same assessment always lands on the same risk.
 */
export function preferredAssessmentRisk(
  catalogue: { risk_id: string }[] | undefined,
  findings: Finding[] | undefined,
): string | null {
  const ordered = catalogue ?? [];
  if (ordered.length === 0) return null;
  const statusByRisk = new Map<string, FindingStatus>();
  for (const finding of findings ?? []) {
    if (finding.test_id) statusByRisk.set(finding.test_id, finding.status);
  }
  for (const wanted of RISK_PRIORITY) {
    const match = ordered.find(
      (risk) => (statusByRisk.get(risk.risk_id) ?? "untested") === wanted,
    );
    if (match) return match.risk_id;
  }
  return ordered[0].risk_id;
}

/**
 * One row per application. An app accumulates an assessment row per synced
 * automation run, so listing them raw shows the same app many times. Sorted
 * alphabetically by application name, so every list built from this shares
 * one order.
 */
export function latestAssessmentPerApp(assessments: AssessmentRow[] | undefined): AssessmentRow[] {
  const latestByApp = new Map<string, AssessmentRow>();
  for (const a of assessments ?? []) {
    const existing = latestByApp.get(a.application_id);
    if (!existing || a.updated_at > existing.updated_at) latestByApp.set(a.application_id, a);
  }
  return [...latestByApp.values()].sort((a, b) =>
    compareByName(a.application?.name, b.application?.name, a.application_id, b.application_id),
  );
}
