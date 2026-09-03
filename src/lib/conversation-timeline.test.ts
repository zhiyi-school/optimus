import { describe, expect, it } from "vitest";
import { conversationTimeline } from "@/lib/conversation-timeline";
import type { AutomationResultRow } from "@/api/automation-types";
import type { RiskConversationEntry } from "@/data/types";

function entry(
  id: string,
  createdAt: string,
  overrides: Partial<RiskConversationEntry> = {},
): RiskConversationEntry {
  return {
    id,
    conversation_id: "example-conversation-id",
    kind: "message",
    author_id: null,
    message: id,
    metadata: {},
    source_ticket_id: null,
    created_at: createdAt,
    seq: 1,
    ...overrides,
  };
}

function run(timestamp: string, startedAt: string): AutomationResultRow {
  return {
    app_id: "example_app",
    app_name: "Example Application",
    platform: "ios",
    package_or_bundle_id: "test.example.app",
    test_id: "example-feature-01-risk-01",
    test_name: "Example risk",
    category: "example",
    status: "completed",
    verdict: "At Risk",
    severity: "high",
    summary: "Example summary.",
    started_at: startedAt,
    completed_at: startedAt,
    duration_seconds: 1,
    evidence: [],
    report_path: "example/report.json",
    run_timestamp: timestamp,
    raw: {},
  };
}

function keys(items: ReturnType<typeof conversationTimeline>) {
  return items.map((item) => item.key);
}

describe("the combined timeline", () => {
  it("puts stored entries and automated runs in one chronological order", () => {
    const items = conversationTimeline(
      [entry("a", "2026-01-01T00:00:00Z"), entry("c", "2026-01-05T00:00:00Z")],
      [run("r1", "2026-01-03T00:00:00Z")],
    );

    expect(keys(items)).toEqual(["entry:a", "run:r1", "entry:c"]);
  });

  it("compares the two sources as instants, not as strings", () => {
    // The same moment written two ways: a naive string sort puts +01:00 first.
    const items = conversationTimeline(
      [entry("later", "2026-01-01T01:30:00+00:00")],
      [run("earlier", "2026-01-01T02:00:00+01:00")],
    );

    expect(keys(items)).toEqual(["run:earlier", "entry:later"]);
  });

  it("orders entries written in one transaction by their recorded sequence", () => {
    const items = conversationTimeline(
      [
        entry("second", "2026-01-01T00:00:00Z", { seq: 9 }),
        entry("first", "2026-01-01T00:00:00Z", { seq: 4 }),
      ],
      [],
    );

    expect(keys(items)).toEqual(["entry:first", "entry:second"]);
  });

  it("puts a run before the events written about it when they share a timestamp", () => {
    const items = conversationTimeline(
      [entry("classified", "2026-01-01T00:00:00Z", { kind: "classification_changed" })],
      [run("r1", "2026-01-01T00:00:00Z")],
    );

    expect(keys(items)).toEqual(["run:r1", "entry:classified"]);
  });

  it("is deterministic when two runs report the same start", () => {
    const forwards = conversationTimeline(
      [],
      [run("r-b", "2026-01-01T00:00:00Z"), run("r-a", "2026-01-01T00:00:00Z")],
    );
    const backwards = conversationTimeline(
      [],
      [run("r-a", "2026-01-01T00:00:00Z"), run("r-b", "2026-01-01T00:00:00Z")],
    );

    expect(keys(forwards)).toEqual(["run:r-a", "run:r-b"]);
    expect(keys(backwards)).toEqual(keys(forwards));
  });

  it("keeps each item's own source, so a run is never mistaken for an entry", () => {
    const items = conversationTimeline([entry("a", "2026-01-01T00:00:00Z")], [
      run("r1", "2026-01-02T00:00:00Z"),
    ]);

    expect(items.map((item) => item.kind)).toEqual(["entry", "test_run"]);
  });

  it("copes with either source being absent", () => {
    expect(conversationTimeline(undefined, undefined)).toEqual([]);
    expect(keys(conversationTimeline([entry("a", "2026-01-01T00:00:00Z")], undefined))).toEqual([
      "entry:a",
    ]);
    expect(keys(conversationTimeline(undefined, [run("r1", "2026-01-01T00:00:00Z")]))).toEqual([
      "run:r1",
    ]);
  });

  it("leaves the caller's arrays untouched", () => {
    const entries = [entry("b", "2026-01-02T00:00:00Z"), entry("a", "2026-01-01T00:00:00Z")];
    conversationTimeline(entries, []);

    expect(entries.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
