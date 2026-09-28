/**
 * Pure selection and ordering helpers for assessments.
 */

import { createDebug } from "@/lib/debug";
import { compareByName } from "@/lib/utils";
import type { Application, Assessment, Finding, FindingStatus } from "@/data/types";

export type AssessmentRow = Assessment & { application: Application | null };

const debug = createDebug("lib:assessments");

/** Least reassuring first, so opening a completed assessment lands on work that still needs a decision. */
const RISK_PRIORITY: (FindingStatus | "untested")[] = ["at_risk", "inconclusive", "untested"];

/** The risk a completed assessment opens on: least reassuring status first, catalogue order breaking ties. */
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
    if (match) {
      debug("prefers assessment risk", { riskId: match.risk_id, status: wanted });
      return match.risk_id;
    }
  }
  debug("prefers first catalogue risk", { riskId: ordered[0].risk_id });
  return ordered[0].risk_id;
}

/** Keeps each application's most recently updated assessment, sorted by application name. */
export function latestAssessmentPerApp(assessments: AssessmentRow[] | undefined): AssessmentRow[] {
  const latestByApp = new Map<string, AssessmentRow>();
  for (const a of assessments ?? []) {
    const existing = latestByApp.get(a.application_id);
    if (!existing || a.updated_at > existing.updated_at) latestByApp.set(a.application_id, a);
  }
  debug("keeps latest assessment per app", { assessmentCount: assessments?.length ?? 0, appCount: latestByApp.size });
  return [...latestByApp.values()].sort((a, b) =>
    compareByName(a.application?.name, b.application?.name, a.application_id, b.application_id),
  );
}
