/**
 * Selecting automation results and turning their evidence refs into displayable evidence items.
 */

import type { AutomationResultRow, EvidenceRef } from "@/api/automation-types";
import type { EvidenceItem } from "@/lib/evidence-types";
import { createDebug } from "@/lib/debug";
import { formatDate, formatDuration } from "@/lib/utils";

const debug = createDebug("lib:automation-evidence");

export const AUTOMATION_SOURCE = "Automated test";
export const MANUAL_SOURCE = "Security team";

/** The most recently started result for this app and risk in the history. */
export function latestResult(
  history: AutomationResultRow[] | undefined,
  appExternalId: string | null | undefined,
  riskId: string | null | undefined,
): AutomationResultRow | undefined {
  if (!appExternalId || !riskId) return undefined;
  const newest = (history ?? [])
    .filter((row) => row.app_id === appExternalId && row.test_id === riskId)
    .reduce<AutomationResultRow | undefined>(
      (newest, row) =>
        !newest || (row.started_at ?? "") > (newest.started_at ?? "") ? row : newest,
      undefined,
    );
  debug("picks latest result", {
    appExternalId,
    riskId,
    historyCount: history?.length ?? 0,
    runTimestamp: newest?.run_timestamp ?? null,
  });
  return newest;
}

/** The viewer kind for an artifact: image, text, or its own kind. */
function displayKind(kind: string, label: string): string {
  const name = label.toLowerCase();
  if (kind === "screenshot" || /\.(png|jpe?g)\b/.test(name)) return "image";
  if (kind === "log" || kind === "report" || kind === "page_source") return "text";
  return kind;
}

export interface LatestResultDetail {
  verdict: string;
  status: string;
  runTimestamp: string;
  startedAt: string;
  duration: string | null;
  summary: string;
  testId: string;
  testName: string;
}

/** Display fields for a result, with formatted time and duration. */
export function latestResultDetail(
  row: AutomationResultRow | undefined,
): LatestResultDetail | undefined {
  if (!row) return undefined;
  return {
    verdict: row.verdict,
    status: row.status,
    runTimestamp: row.run_timestamp,
    startedAt: formatDate(row.started_at),
    duration: row.duration_seconds ? formatDuration(row.duration_seconds) : null,
    summary: row.summary?.trim() || "The run recorded no summary.",
    testId: row.test_id,
    testName: row.test_name,
  };
}

/** A result's evidence refs, dropping blank and duplicate refs. */
export function artifactsOf(row: AutomationResultRow | undefined): EvidenceRef[] {
  const seen = new Set<string>();
  const artifacts: EvidenceRef[] = [];
  for (const artifact of row?.evidence ?? []) {
    const ref = artifact.ref?.trim();
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    artifacts.push(artifact);
  }
  return artifacts;
}

/** The result's evidence artifact with this file name. */
export function artifactNamed(
  row: AutomationResultRow | undefined,
  fileName: string,
): EvidenceRef | undefined {
  return artifactsOf(row).find((artifact) => artifact.path.split("/").pop() === fileName);
}

/** Evidence items for a result's artifacts, downloadable by opaque ref. */
export function automationEvidence(
  row: AutomationResultRow | undefined,
  evidenceUrl: (runTimestamp: string, ref: string) => string,
): EvidenceItem[] {
  if (!row) return [];
  return artifactsOf(row).map((artifact) => {
    const fileName = artifact.path.split("/").pop() || artifact.path;
    return {
      id: `${row.run_timestamp}:${artifact.ref}`,
      name: artifact.label?.trim() || fileName,
      kind: displayKind(artifact.kind ?? "file", fileName),
      // The opaque ref is the download contract; `path` is display metadata only.
      url: evidenceUrl(row.run_timestamp, artifact.ref),
      downloadName: fileName,
      sizeBytes: artifact.size_bytes,
      source: AUTOMATION_SOURCE,
    };
  });
}

/** Automated evidence followed by manual evidence, each labelled with its source. */
export function combinedEvidence(
  row: AutomationResultRow | undefined,
  manual: EvidenceItem[] | undefined,
  evidenceUrl: (runTimestamp: string, ref: string) => string,
): EvidenceItem[] {
  const automated = automationEvidence(row, evidenceUrl);
  debug("combines evidence", {
    runTimestamp: row?.run_timestamp ?? null,
    automatedCount: automated.length,
    manualCount: manual?.length ?? 0,
  });
  return [
    ...automated,
    ...(manual ?? []).map((item) => ({ ...item, source: item.source ?? MANUAL_SOURCE })),
  ];
}
