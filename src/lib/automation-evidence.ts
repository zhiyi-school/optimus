import type { AutomationResultRow, EvidenceRef } from "@/api/automation-types";
import type { EvidenceItem } from "@/lib/evidence-types";
import { formatDate, formatDuration } from "@/lib/utils";

export const AUTOMATION_SOURCE = "Automated test";
export const MANUAL_SOURCE = "Security team";

export const RAIL_ARTIFACT_LIMIT = 6;

export function latestResult(
  history: AutomationResultRow[] | undefined,
  appExternalId: string | null | undefined,
  riskId: string | null | undefined,
): AutomationResultRow | undefined {
  if (!appExternalId || !riskId) return undefined;
  return (history ?? [])
    .filter((row) => row.app_id === appExternalId && row.test_id === riskId)
    .reduce<AutomationResultRow | undefined>(
      (newest, row) =>
        !newest || (row.started_at ?? "") > (newest.started_at ?? "") ? row : newest,
      undefined,
    );
}

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

export function artifactNamed(
  row: AutomationResultRow | undefined,
  fileName: string,
): EvidenceRef | undefined {
  return artifactsOf(row).find((artifact) => artifact.path.split("/").pop() === fileName);
}

export function automationEvidence(
  row: AutomationResultRow | undefined,
  evidenceUrl: (runTimestamp: string, ref: string) => string,
  limit: number = RAIL_ARTIFACT_LIMIT,
): EvidenceItem[] {
  if (!row) return [];
  const artifacts = artifactsOf(row);
  const items: EvidenceItem[] = artifacts.slice(0, limit).map((artifact) => {
    const fileName = artifact.path.split("/").pop() || artifact.path;
    const label = artifact.label?.trim() || fileName;
    return {
      id: `${row.run_timestamp}:${artifact.ref}`,
      name: label,
      kind: displayKind(artifact.kind ?? "file", fileName),
      url: evidenceUrl(row.run_timestamp, artifact.ref),
      downloadName: fileName,
      sizeBytes: artifact.size_bytes,
      source: AUTOMATION_SOURCE,
    };
  });

  const remaining = artifacts.length - Math.min(artifacts.length, limit);
  if (remaining > 0) {
    items.push({
      id: `${row.run_timestamp}:more`,
      name: `${remaining} more artefact${remaining === 1 ? "" : "s"} in this run`,
      kind: "text",
      source: AUTOMATION_SOURCE,
    });
  }
  return items;
}

export function combinedEvidence(
  row: AutomationResultRow | undefined,
  manual: EvidenceItem[] | undefined,
  evidenceUrl: (runTimestamp: string, ref: string) => string,
  limit: number = RAIL_ARTIFACT_LIMIT,
): EvidenceItem[] {
  return [
    ...automationEvidence(row, evidenceUrl, limit),
    ...(manual ?? []).map((item) => ({ ...item, source: item.source ?? MANUAL_SOURCE })),
  ];
}
