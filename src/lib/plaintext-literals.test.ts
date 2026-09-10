import { describe, expect, it } from "vitest";
import { plaintextLiterals } from "@/lib/plaintext-literals";

const RUN = "2026-01-02_00-00-00";

/** Every value here is synthetic and already masked, as the dashboard only ever reads masked_value. */
function finding(overrides: Record<string, unknown> = {}) {
  return {
    path: "Example-Info.plist",
    key_path: "$.API_KEY",
    context: null,
    match_type: "GOOGLE_API_KEY",
    masked_value: "AIza...0000",
    severity: "HIGH",
    value_revealed: false,
    ...overrides,
  };
}

function document(findings: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    analysis_provider: "builtin",
    sensitive_scan: { enabled: true, reveal_values: false },
    sensitive_information_findings: findings,
    ...overrides,
  };
}

function parse(findings: unknown[], overrides: Record<string, unknown> = {}) {
  const analysis = plaintextLiterals(document(findings, overrides), RUN);
  if (analysis.state !== "ready") throw new Error(`expected ready, got ${analysis.state}`);
  return analysis;
}

describe("which detections count as plaintext literals", () => {
  it.each([
    ["GOOGLE_API_KEY", "secret_key"],
    ["AWS_ACCESS_KEY_ID", "secret_key"],
    ["SLACK_TOKEN", "secret_key"],
    ["PRIVATE_KEY_MARKER", "secret_key"],
    ["JWT", "secret_key"],
    ["BASIC_AUTH_URL", "credential_url"],
    ["SENSITIVE_KEY_VALUE", "sensitive_value"],
  ])("includes %s as %s", (matchType, category) => {
    const [item] = parse([finding({ match_type: matchType })]).literals;
    expect(item.category).toBe(category);
  });

  it("reads a password-named key as a credential and any other as merely suspected", () => {
    const items = parse([
      finding({ match_type: "SENSITIVE_KEY_NAME", key_path: "$.loginPassword" }),
      finding({ match_type: "SENSITIVE_KEY_NAME", key_path: "$.tuningParameter", masked_value: "ab...yz" }),
    ]).literals;

    expect(items[0].category).toBe("credential");
    expect(items[1].category).toBe("sensitive_value");
  });

  it.each([
    "PACKAGE_INSPECTABLE",
    "SECURITY_SCORE",
    "PERMISSION_USAGE",
    "ENCRYPTION_METADATA",
    "RESTRICTED_OR_DENIED",
    "ZERO_RESULTS",
    "REUSABLE_FROM_WORKSTATION",
  ])("excludes the unrelated %s detection", (matchType) => {
    expect(parse([finding({ match_type: matchType })]).literals).toEqual([]);
  });

  it("does not treat an ordinary URL or public identifier as a secret on its own", () => {
    const items = parse([
      finding({ match_type: "URL", masked_value: "https://example.test/docs" }),
      finding({ match_type: "BUNDLE_ID", masked_value: "test.example.app" }),
    ]).literals;
    expect(items).toEqual([]);
  });

  it("keeps every category label hedged rather than asserting a live credential", () => {
    const items = parse([
      finding({ match_type: "GOOGLE_API_KEY" }),
      finding({ match_type: "SENSITIVE_KEY_NAME", key_path: "$.password", masked_value: "pw...99" }),
    ]).literals;
    for (const item of items) {
      expect(item.categoryLabel).toMatch(/^(Potential|Suspected|URL carrying)/);
    }
    expect(items.some((item) => /valid|exploitable|confirmed/i.test(item.categoryLabel))).toBe(false);
  });
});

describe("what each literal carries", () => {
  it("keeps the masked value and never reads a revealed one", () => {
    const [item] = parse([
      finding({ masked_value: "AIza...0000", value: "AIzaNOT-REAL-SYNTHETIC", reported_value: "AIzaNOT-REAL-SYNTHETIC", value_revealed: true }),
    ]).literals;

    expect(item.maskedValue).toBe("AIza...0000");
    expect(JSON.stringify(item)).not.toContain("AIzaNOT-REAL-SYNTHETIC");
  });

  it("drops a finding with no masked value rather than falling back", () => {
    expect(parse([finding({ masked_value: "" , value: "SYNTHETIC-RAW" })]).literals).toEqual([]);
  });

  it("records a bundle file as its own location", () => {
    const [item] = parse([finding({ path: "Example-Info.plist", key_path: "$.API_KEY" })]).literals;
    expect(item.sourceKind).toBe("bundle_file");
    expect(item.sourcePath).toBe("Example-Info.plist");
    expect(item.keyPath).toBe("$.API_KEY");
  });

  it("never invents a source file for an analyzer-report match", () => {
    const [item] = parse([finding({ path: "mobsf_report_json" })]).literals;
    expect(item.sourceKind).toBe("analyzer_report");
    expect(item.sourcePath).toBeNull();
  });

  it("treats a finding with no path as analyzer-only rather than guessing", () => {
    const [item] = parse([finding({ path: null })]).literals;
    expect(item.sourceKind).toBe("analyzer_report");
    expect(item.sourcePath).toBeNull();
  });

  it("carries the provider and the run it came from", () => {
    const [item] = parse([finding()], { analysis_provider: "mobsf" }).literals;
    expect(item.provider).toBe("mobsf");
    expect(item.runTimestamp).toBe(RUN);
  });

  it("gives a concise reason drawn from the detection, not free text", () => {
    const [item] = parse([finding({ match_type: "BASIC_AUTH_URL" })]).literals;
    expect(item.reason).toBe("URL embeds a username and password");
  });

  it("keeps identity stable across parses and distinct across runs", () => {
    const first = plaintextLiterals(document([finding()]), RUN);
    const again = plaintextLiterals(document([finding()]), RUN);
    const other = plaintextLiterals(document([finding()]), "2026-02-02_00-00-00");
    if (first.state !== "ready" || again.state !== "ready" || other.state !== "ready") throw new Error("ready");

    expect(first.literals[0].id).toBe(again.literals[0].id);
    expect(first.literals[0].id).not.toBe(other.literals[0].id);
  });

  it("collapses a literal the analyzer reported twice", () => {
    expect(parse([finding(), finding()]).literals).toHaveLength(1);
  });

  it("links a plist literal to the resource control and other bundle files to the code control", () => {
    const items = parse([
      finding({ path: "Example-Info.plist" }),
      finding({ path: "Resources/config.json", masked_value: "AIza...1111" }),
      finding({ path: "mobsf_report_json", masked_value: "AIza...2222" }),
    ]).literals;

    expect(items[0].controlId).toBe("ios-feature-01-risk-01-control-02");
    expect(items[1].controlId).toBe("ios-feature-01-risk-01-control-01");
    expect(items[2].controlId).toBeNull();
  });
});

describe("telling apart the ways an analysis can be unhelpful", () => {
  it("reports an empty result when the scan ran and matched nothing", () => {
    const analysis = plaintextLiterals(document([]), RUN);
    expect(analysis).toMatchObject({ state: "ready", literals: [] });
  });

  it("reports a scan that did not run as unknown, not as empty", () => {
    const analysis = plaintextLiterals(
      document([], { sensitive_scan: { enabled: false } }),
      RUN,
    );
    expect(analysis.state).toBe("not_scanned");
  });

  it.each([undefined, null, "not a report", 42, {}, { sensitive_information_findings: "nope" }])(
    "reports an unreadable or unsupported document as unsupported (%s)",
    (input) => {
      expect(plaintextLiterals(input, RUN).state).toBe("unsupported");
    },
  );

  it("passes on a truncation the analyzer itself declares", () => {
    const analysis = plaintextLiterals(
      document([finding()], { sensitive_scan: { enabled: true, truncated: true } }),
      RUN,
    );
    expect(analysis).toMatchObject({ state: "ready", truncated: true });
  });

  it("does not claim truncation the analyzer did not report", () => {
    expect(parse([finding()]).truncated).toBe(false);
  });

  it("skips a malformed entry without losing the rest", () => {
    expect(parse([null, "nonsense", { match_type: "GOOGLE_API_KEY" }, finding()]).literals).toHaveLength(1);
  });
});
