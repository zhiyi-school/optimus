import type { AutomationResultRow } from "@/api/automation-types";
import { artifactNamed } from "@/lib/automation-evidence";

export type PlaintextCategory = "credential" | "secret_key" | "credential_url" | "sensitive_value";

/** Where a match was seen: a file inside the bundle, or only inside the analyzer's own report. */
export type PlaintextSourceKind = "bundle_file" | "analyzer_report";

export interface PlaintextLiteral {
  id: string;
  category: PlaintextCategory;
  categoryLabel: string;
  sourceKind: PlaintextSourceKind;
  sourcePath: string | null;
  keyPath: string | null;
  maskedValue: string;
  reason: string;
  provider: string;
  runTimestamp: string;
  controlId: string | null;
}

export type PlaintextAnalysis =
  | { state: "ready"; literals: PlaintextLiteral[]; truncated: boolean; provider: string }
  | { state: "not_scanned"; provider: string }
  | { state: "unsupported" };

export const CATEGORY_LABEL: Record<PlaintextCategory, string> = {
  credential: "Potential embedded credential",
  secret_key: "Potential hardcoded secret key",
  credential_url: "URL carrying credentials",
  sensitive_value: "Suspected sensitive value",
};

/**
 * Only detections the plaintext-literal risk is about. Package inspectability,
 * permissions, encryption metadata, scores and API-key reuse outcomes are other
 * subjects and are deliberately absent.
 */
const CATEGORY_BY_MATCH: Record<string, PlaintextCategory> = {
  GOOGLE_API_KEY: "secret_key",
  AWS_ACCESS_KEY_ID: "secret_key",
  SLACK_TOKEN: "secret_key",
  PRIVATE_KEY_MARKER: "secret_key",
  JWT: "secret_key",
  BASIC_AUTH_URL: "credential_url",
  SENSITIVE_KEY_VALUE: "sensitive_value",
};

const REASON_BY_MATCH: Record<string, string> = {
  GOOGLE_API_KEY: "Matches the Google API key format",
  AWS_ACCESS_KEY_ID: "Matches the AWS access key id format",
  SLACK_TOKEN: "Matches the Slack token format",
  PRIVATE_KEY_MARKER: "Contains a private key header",
  JWT: "Matches the JSON Web Token format",
  BASIC_AUTH_URL: "URL embeds a username and password",
  SENSITIVE_KEY_VALUE: "Value looks like a secret",
  SENSITIVE_KEY_NAME: "Stored under a key that names a secret",
};

const CREDENTIAL_KEY_TERMS = ["password", "passwd", "pwd", "credential", "auth", "login"];

const ANALYZER_REPORT_PATHS = new Set(["mobsf_report_json"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function categoryOf(matchType: string, keyPath: string | null): PlaintextCategory | null {
  const mapped = CATEGORY_BY_MATCH[matchType];
  if (mapped) return mapped;
  if (matchType !== "SENSITIVE_KEY_NAME") return null;
  const key = (keyPath ?? "").toLowerCase();
  return CREDENTIAL_KEY_TERMS.some((term) => key.includes(term)) ? "credential" : "sensitive_value";
}

/** A plist literal is what control 02 addresses; anything else in the bundle is control 01's subject. */
function controlFor(sourceKind: PlaintextSourceKind, sourcePath: string | null): string | null {
  if (sourceKind !== "bundle_file" || !sourcePath) return null;
  return sourcePath.toLowerCase().endsWith(".plist")
    ? "ios-feature-01-risk-01-control-02"
    : "ios-feature-01-risk-01-control-01";
}

/**
 * Reads the run's structured findings. `masked_value` is the only value ever
 * read: the raw and reported fields are never a fallback, so a report captured
 * with values revealed cannot leak one into the dashboard.
 */
export function plaintextLiterals(
  document: unknown,
  runTimestamp: string,
): PlaintextAnalysis {
  const root = record(document);
  if (!root || !Array.isArray(root.sensitive_information_findings)) return { state: "unsupported" };

  const provider = text(root.analysis_provider) ?? "unknown analyzer";
  const scan = record(root.sensitive_scan);
  if (scan && scan.enabled === false) return { state: "not_scanned", provider };

  const literals: PlaintextLiteral[] = [];
  const seen = new Set<string>();

  for (const entry of root.sensitive_information_findings) {
    const finding = record(entry);
    if (!finding) continue;
    const matchType = text(finding.match_type);
    const masked = text(finding.masked_value);
    if (!matchType || !masked) continue;

    const keyPath = text(finding.key_path);
    const category = categoryOf(matchType, keyPath);
    if (!category) continue;

    const rawPath = text(finding.path);
    const analyzerOnly = !rawPath || ANALYZER_REPORT_PATHS.has(rawPath);
    const sourceKind: PlaintextSourceKind = analyzerOnly ? "analyzer_report" : "bundle_file";
    const sourcePath = analyzerOnly ? null : rawPath;

    const id = [runTimestamp, provider, rawPath ?? "", keyPath ?? "", matchType, masked].join("|");
    if (seen.has(id)) continue;
    seen.add(id);

    literals.push({
      id,
      category,
      categoryLabel: CATEGORY_LABEL[category],
      sourceKind,
      sourcePath,
      keyPath,
      maskedValue: masked,
      reason: REASON_BY_MATCH[matchType] ?? "Reported by the analyzer",
      provider,
      runTimestamp,
      controlId: controlFor(sourceKind, sourcePath),
    });
  }

  return { state: "ready", literals, truncated: scan?.truncated === true, provider };
}

export function analysisArtifact(row: AutomationResultRow | undefined) {
  return artifactNamed(row, "ipa_analysis.json");
}
