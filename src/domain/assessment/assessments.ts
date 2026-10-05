/**
 * Pure selection and ordering helpers for assessments.
 */

import { createDebug } from "@/lib/debug";
import { compareByName } from "@/lib/utils";
import type { Application, Assessment, Finding, FindingStatus } from "@/database/types";

export type AssessmentRow = Assessment & { application: Application | null };

const debug = createDebug("domain:assessment:assessments");

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

/** Indexes findings by the risk they record, skipping findings with no risk. */
export function findingsByTestId<T extends Pick<Finding, "test_id">>(
  findings: T[] | undefined,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const finding of findings ?? []) {
    if (finding.test_id) map.set(finding.test_id, finding);
  }
  return map;
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

export const HISTORY_LIMIT = 5;

/** The assessments a history list shows: all when expanded, else the newest few plus the open one if it is older. */
export function visibleHistory<T extends { id: string }>(
  newestFirst: T[],
  currentId: string,
  expanded: boolean,
  limit = HISTORY_LIMIT,
): { shown: T[]; hidden: number } {
  if (expanded || newestFirst.length <= limit) return { shown: newestFirst, hidden: 0 };
  const shown = newestFirst.slice(0, limit);
  const current = newestFirst.find((item) => item.id === currentId);
  if (current && !shown.includes(current)) shown.push(current);
  return { shown, hidden: newestFirst.length - shown.length };
}
