/**
 * Labels and choices for assessing a new version of an already-assessed app.
 */

import type { AppBuild } from "@/automation-api/types";
import type { Assessment } from "@/database/types";

const IN_PROGRESS = new Set<Assessment["status"]>(["queued", "waiting", "running"]);

/** Labels one intake build by version, build number and file, as the version picker lists it. */
export function buildOptionLabel(build: AppBuild): string {
  const version = build.version ?? "Unknown version";
  const number = build.build_number && build.build_number !== build.version ? ` (build ${build.build_number})` : "";
  return `${version}${number} — ${build.file}`;
}

/** The distinct versions the picker offers, in the backend's highest-first order. */
export function selectableVersions(builds: AppBuild[]): string[] {
  const versions: string[] = [];
  for (const build of builds) {
    if (build.version && !versions.includes(build.version)) versions.push(build.version);
  }
  return versions;
}

/** True when none of the application's assessments is still queued, waiting or running. */
export function canStartNewAssessment(assessments: Pick<Assessment, "status">[]): boolean {
  return !assessments.some((assessment) => IN_PROGRESS.has(assessment.status));
}

/** The application's newest completed assessment, the one a rerun of any of its risks updates. */
export function newestCompletedAssessment<T extends Pick<Assessment, "id" | "status" | "created_at">>(
  assessments: T[],
): T | null {
  let newest: T | null = null;
  for (const assessment of assessments) {
    if (assessment.status !== "completed") continue;
    if (!newest || assessment.created_at > newest.created_at) newest = assessment;
  }
  return newest;
}

/** The version an assessment tested, else the version recorded on its application. */
export function assessmentVersion(
  assessment: Pick<Assessment, "app_version">,
  application: { version: string | null } | null | undefined,
): string | null {
  return assessment.app_version ?? application?.version ?? null;
}
