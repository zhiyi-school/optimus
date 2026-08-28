import type { Application, Assessment } from "@/data/types";

export type AssessmentRow = Assessment & { application: Application | null };

/**
 * One row per application. An app accumulates an assessment row per synced
 * automation run, so listing them raw shows the same app many times.
 */
export function latestAssessmentPerApp(assessments: AssessmentRow[] | undefined): AssessmentRow[] {
  const latestByApp = new Map<string, AssessmentRow>();
  for (const a of assessments ?? []) {
    const existing = latestByApp.get(a.application_id);
    if (!existing || a.updated_at > existing.updated_at) latestByApp.set(a.application_id, a);
  }
  return [...latestByApp.values()];
}
