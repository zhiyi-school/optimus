import type { Tone } from "@/lib/status";

/** The shape `critical_findings.json` records. Anything unrecognised is ignored. */
export interface CriticalFinding {
  id: string;
  severity: string;
  title: string;
  evidence: string[];
  recommendation: string;
}

export interface CriticalFindings {
  status: string | null;
  highestSeverity: string | null;
  owaspReference: string | null;
  findings: CriticalFinding[];
}

export const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

export const severityTone: Record<string, Tone> = {
  CRITICAL: "danger",
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "info",
  INFO: "neutral",
};

export function severityRank(severity: string): number {
  const index = SEVERITY_ORDER.indexOf(severity.toUpperCase());
  return index === -1 ? SEVERITY_ORDER.length : index;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Parse the report defensively: a malformed field loses that field, not the table. */
export function parseCriticalFindings(raw: unknown): CriticalFindings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const document = raw as Record<string, unknown>;
  const flags = Array.isArray(document.flags) ? document.flags : [];

  const findings: CriticalFinding[] = flags.flatMap((flag, index) => {
    if (!flag || typeof flag !== "object") return [];
    const entry = flag as Record<string, unknown>;
    const title = text(entry.title);
    const severity = text(entry.severity).toUpperCase() || "INFO";
    if (!title) return [];
    return [
      {
        id: text(entry.id) || `finding-${index}`,
        severity,
        title,
        evidence: Array.isArray(entry.evidence)
          ? entry.evidence.map((line) => text(line)).filter(Boolean)
          : [],
        recommendation: text(entry.recommendation),
      },
    ];
  });

  if (findings.length === 0 && !text(document.status)) return undefined;

  return {
    status: text(document.status) || null,
    highestSeverity: text(document.highest_severity).toUpperCase() || highestOf(findings),
    owaspReference: text(document.owasp_reference) || null,
    findings: [...findings].sort(
      (a, b) => severityRank(a.severity) - severityRank(b.severity) || a.title.localeCompare(b.title),
    ),
  };
}

function highestOf(findings: CriticalFinding[]): string | null {
  if (findings.length === 0) return null;
  return findings.reduce(
    (worst, finding) => (severityRank(finding.severity) < severityRank(worst) ? finding.severity : worst),
    findings[0].severity,
  );
}

/** Counts by severity, worst first, for the filter row. */
export function severityCounts(findings: CriticalFinding[]): { severity: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([severity, count]) => ({ severity, count }))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

/** One finding as text, for a copy action. Same data as the table, nothing extra. */
export function findingAsText(finding: CriticalFinding): string {
  return [
    `${finding.severity}: ${finding.title}`,
    ...finding.evidence.map((line) => `  - ${line}`),
    finding.recommendation ? `  Recommendation: ${finding.recommendation}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
