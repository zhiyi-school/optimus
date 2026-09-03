// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RiskConversationPanel } from "@/components/conversation-panel";
import { conversationTimeline } from "@/lib/conversation-timeline";
import type { AutomationResultRow } from "@/api/automation-types";
import type {
  Profile,
  RiskConversationAttachment,
  RiskConversationEntry,
  RiskConversationEntryKind,
} from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DEVELOPER = "00000000-0000-0000-0000-000000000001";
const SECURITY = "00000000-0000-0000-0000-000000000002";

const profiles = new Map<string, Profile>([
  [
    DEVELOPER,
    {
      id: DEVELOPER,
      display_name: "Example Developer",
      email: "developer@example.test",
      roles: ["developer"],
      team_id: "example-team-id",
      is_active: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ],
  [
    SECURITY,
    {
      id: SECURITY,
      display_name: "Example Security Reviewer",
      email: "security@example.test",
      roles: ["security"],
      team_id: null,
      is_active: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ],
]);

let nextEntry = 0;

function entry(
  kind: RiskConversationEntryKind,
  overrides: Partial<RiskConversationEntry> = {},
): RiskConversationEntry {
  nextEntry += 1;
  return {
    id: `entry-${nextEntry}`,
    conversation_id: "example-conversation-id",
    kind,
    author_id: DEVELOPER,
    message: null,
    metadata: {},
    source_ticket_id: null,
    created_at: `2026-01-0${nextEntry}T00:00:00Z`,
    seq: nextEntry,
    ...overrides,
  };
}

function run(overrides: Partial<AutomationResultRow> = {}): AutomationResultRow {
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
    summary: "The example check did not pass.",
    started_at: "2026-01-02T00:00:00Z",
    completed_at: "2026-01-02T00:01:00Z",
    duration_seconds: 42,
    evidence: [],
    report_path: "example/report.json",
    run_timestamp: "2026-01-02_00-00-00",
    raw: {},
    ...overrides,
  };
}

function attachment(entryId: string): RiskConversationAttachment {
  return {
    id: `attachment-${entryId}`,
    entry_id: entryId,
    uploaded_by: DEVELOPER,
    storage_path: `conversation-example/example-evidence.png`,
    file_name: "example-evidence.png",
    mime_type: "image/png",
    created_at: "2026-01-01T00:00:00Z",
  };
}

let container: HTMLDivElement;
let root: Root;
let sent: { message: string; file?: File }[];

beforeEach(() => {
  nextEntry = 0;
  sent = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

type RenderProps = Partial<Parameters<typeof RiskConversationPanel>[0]> & {
  entries?: RiskConversationEntry[];
  runs?: AutomationResultRow[];
};

/** Callers name the two sources; the panel is handed the merged timeline. */
function render({ entries, runs, ...props }: RenderProps = {}) {
  act(() =>
    root.render(
      <RiskConversationPanel
        items={props.items ?? conversationTimeline(entries, runs)}
        currentProfileId={DEVELOPER}
        profileMap={profiles}
        canComment
        onSend={(input) => {
          sent.push(input);
          return Promise.resolve();
        }}
        {...props}
      />,
    ),
  );
}

function text() {
  return container.textContent ?? "";
}

function feedItems() {
  return [...container.querySelectorAll("ol > li")];
}

function card() {
  return container.firstElementChild as HTMLElement;
}

function feed() {
  return container.querySelector<HTMLDivElement>("[role='log']")!;
}

/** jsdom has no layout, so the feed is told how tall it would have been. */
function sizeFeed({ scrollHeight = 1000, clientHeight = 400 } = {}) {
  for (const [key, value] of [
    ["scrollHeight", scrollHeight],
    ["clientHeight", clientHeight],
  ] as const) {
    Object.defineProperty(feed(), key, { configurable: true, value });
  }
}

function scrollFeedTo(top: number) {
  const element = feed();
  element.scrollTop = top;
  act(() => element.dispatchEvent(new Event("scroll", { bubbles: false })));
}

function composer() {
  return container.querySelector<HTMLTextAreaElement>("textarea");
}

// React tracks the value it set, so a plain assignment is ignored as a no-op.
function type(field: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("one chronological feed", () => {
  it("renders messages and workflow events in the order they were recorded", () => {
    render({
      entries: [
        entry("message", { message: "Where should I start?" }),
        entry("fix_submitted", { message: "Rotated the key." }),
        entry("retest_requested"),
        entry("classification_changed", {
          author_id: SECURITY,
          message: "Verified on the current build.",
          metadata: { previous_status: "at_risk", new_status: "reduced_risk" },
        }),
      ],
    });

    const items = feedItems();
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain("Where should I start?");
    expect(items[1].textContent).toContain("Fix submitted for review");
    expect(items[2].textContent).toContain("Reassessment requested");
    expect(items[3].textContent).toContain("Classification changed from At Risk to Reduced Risk");
  });

  it("has exactly one composer, however many entries there are", () => {
    render({ entries: [entry("message", { message: "One." }), entry("message", { message: "Two." })] });

    expect(container.querySelectorAll("textarea")).toHaveLength(1);
    expect(container.querySelectorAll("form")).toHaveLength(1);
  });

  it("makes an automated entry visually distinct from a message", () => {
    render({
      entries: [
        entry("message", { message: "A message." }),
        entry("retest_completed", { author_id: null, message: "Reduced Risk." }),
      ],
    });

    const items = feedItems();
    expect(items[0].querySelector(".border-dashed")).toBeNull();
    expect(items[1].querySelector(".border-dashed")).not.toBeNull();
    expect(items[1].textContent).toContain("Automation");
  });

  it("shows every retest outcome by name", () => {
    for (const [kind, label] of [
      ["retest_started", "Reassessment started"],
      ["retest_completed", "Reassessment completed"],
      ["retest_failed", "Reassessment did not complete"],
      ["remediation_started", "Remediation started"],
      ["remediation_withdrawn", "Remediation withdrawn"],
    ] as const) {
      render({ entries: [entry(kind)] });
      expect(text(), kind).toContain(label);
    }
  });

  it("never puts the stored metadata on screen", () => {
    render({
      entries: [
        entry("classification_changed", {
          metadata: { previous_status: "at_risk", new_status: "inconclusive" },
        }),
        entry("retest_started", { metadata: { run_timestamp: "2026-01-01_00-00-00" } }),
      ],
    });

    expect(text()).not.toContain("previous_status");
    expect(text()).not.toContain("new_status");
    expect(text()).not.toContain("{");
    expect(text()).toContain("Classification changed from At Risk to Inconclusive");
  });

  it("falls back to the plain label when a classification event names no status", () => {
    render({ entries: [entry("classification_changed", { metadata: {} })] });
    expect(text()).toContain("Classification changed");
    expect(text()).not.toContain("undefined");
  });

  it("names the author of a message and marks the reader's own", () => {
    render({
      entries: [
        entry("message", { message: "Mine." }),
        entry("message", { author_id: SECURITY, message: "Theirs." }),
      ],
    });

    expect(feedItems()[0].textContent).toContain("You");
    expect(feedItems()[1].textContent).toContain("Example Security Reviewer");
    expect(feedItems()[1].textContent).toContain("Security Team");
  });

  it("lists a message's attachments under it", () => {
    const withFile = entry("message", { message: "See the screenshot." });
    render({
      entries: [withFile],
      attachmentsByEntry: new Map([[withFile.id, [attachment(withFile.id)]]]),
    });

    expect(text()).toContain("example-evidence.png");
  });
});

describe("automated test history inside the conversation", () => {
  it("interleaves automated runs with the discussion, in time order", () => {
    render({
      entries: [
        entry("message", { message: "Starting on this.", created_at: "2026-01-01T00:00:00Z" }),
        entry("fix_submitted", { message: "Rotated the key.", created_at: "2026-01-03T00:00:00Z" }),
      ],
      runs: [
        run({ run_timestamp: "run-b", started_at: "2026-01-04T00:00:00Z", summary: "Later run." }),
        run({ run_timestamp: "run-a", started_at: "2026-01-02T00:00:00Z", summary: "Earlier run." }),
      ],
    });

    const items = feedItems();
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain("Starting on this.");
    expect(items[1].textContent).toContain("Earlier run.");
    expect(items[2].textContent).toContain("Rotated the key.");
    expect(items[3].textContent).toContain("Later run.");
  });

  it("shows a run's verdict, duration and the run it came from", () => {
    render({ runs: [run({ verdict: "Reduced Risk", duration_seconds: 42 })] });

    const item = feedItems()[0];
    expect(item.textContent).toContain("Automated test");
    expect(item.textContent).toContain("Reduced Risk");
    expect(item.textContent).toContain("completed");
    expect(item.textContent).toContain("2026-01-02_00-00-00");
  });

  it("offers a run's evidence through the caller's own URL builder", () => {
    render({
      runs: [
        run({
          evidence: [{ label: "Example screenshot", kind: "image", path: "shot.png" }],
        }),
      ],
      evidenceUrl: (timestamp, path) => `/example/${timestamp}/${path}`,
    });

    expect(text()).toContain("Example screenshot");
  });

  it("tells an automated run apart from a message and from a workflow event", () => {
    render({
      entries: [
        entry("message", { message: "A message.", created_at: "2026-01-01T00:00:00Z" }),
        entry("retest_completed", {
          author_id: null,
          message: "Reduced Risk.",
          created_at: "2026-01-03T00:00:00Z",
        }),
      ],
      runs: [run({ started_at: "2026-01-02T00:00:00Z" })],
    });

    const [message, automated, event] = feedItems();
    expect(message.textContent).toContain("A message.");
    expect(automated.textContent).toContain("Automated test");
    expect(automated.querySelector(".border-dashed")).toBeNull();
    expect(event.querySelector(".border-dashed")).not.toBeNull();
  });

  it("outlines the run the URL names and leaves the others plain", () => {
    render({
      runs: [
        run({ run_timestamp: "run-a", started_at: "2026-01-02T00:00:00Z" }),
        run({ run_timestamp: "run-b", started_at: "2026-01-03T00:00:00Z" }),
      ],
      highlightRunTimestamp: "run-b",
    });

    const items = feedItems();
    expect(items[0].className).not.toContain("ring-2");
    expect(items[1].className).toContain("ring-2");
  });

  it("keeps the conversation readable when the run history cannot be loaded", () => {
    const retry = vi.fn();
    render({
      entries: [entry("message", { message: "Still here." })],
      historyError: true,
      onRetryHistory: retry,
    });

    expect(text()).toContain("Still here.");
    expect(text()).toContain("Unable to load the automated test history.");
    const button = container.querySelector("button");
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(retry).toHaveBeenCalled();
  });
});

describe("states", () => {
  it("shows a loading state instead of an empty thread", () => {
    render({ entries: undefined, isLoading: true });
    expect(text()).toContain("Loading conversation…");
    expect(text()).not.toContain("Nothing here yet");
  });

  it("shows an empty state with the caller's prompt", () => {
    render({ emptyStateDescription: "Discuss this risk with the other team." });
    expect(text()).toContain("Nothing here yet");
    expect(text()).toContain("Discuss this risk with the other team.");
  });

  it("shows an error state with a retry", () => {
    const retry = vi.fn();
    render({ entries: undefined, isError: true, onRetry: retry });

    expect(text()).toContain("Unable to load this risk conversation.");
    const button = container.querySelector("button");
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(retry).toHaveBeenCalled();
  });

  it("shows the send in flight and reports a failure to post", () => {
    render({
      sending: true,
      sendError: { userFacing: true, message: "You cannot post in this conversation." },
    });

    expect(text()).toContain("Sending…");
    expect(text()).toContain("You cannot post in this conversation.");
  });
});

describe("composing", () => {
  it("hides the composer from a reader who may not comment", () => {
    render({ canComment: false });
    expect(composer()).toBeNull();
  });

  it("says why there is no composer rather than leaving a blank space", () => {
    render({
      canComment: false,
      composerNote: "This conversation could not be opened, so there is nothing to post to yet.",
    });

    expect(composer()).toBeNull();
    expect(text()).toContain("This conversation could not be opened");
  });

  it("keeps the composer reachable and labelled for a keyboard user", () => {
    render();
    const field = composer();
    expect(field?.getAttribute("aria-label")).toBe("Write a message");
    expect(container.querySelector("button[type='submit']")?.textContent).toContain("Send");
    expect(container.querySelector("input[type='file']")?.closest("label")).not.toBeNull();
  });

  it("refuses to send an empty message", () => {
    render();
    const submit = container.querySelector<HTMLButtonElement>("button[type='submit']");
    expect(submit?.disabled).toBe(true);
  });

  it("sends what was typed and clears the field", async () => {
    render();
    const field = composer()!;
    await act(async () => type(field, "  Please retest this.  "));
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(sent).toEqual([{ message: "Please retest this.", file: undefined }]);
    expect(composer()?.value).toBe("");
  });

  it("starts empty and offers no template or placeholder to fill in", () => {
    render();
    const field = composer()!;
    expect(field.value).toBe("");
    expect(field.getAttribute("placeholder")).toBeNull();
    expect(text()).not.toContain("Status: [At Risk");
    expect(text()).not.toContain("Add your observations here");
  });

  it("keeps what was typed when the send fails", async () => {
    render({
      onSend: () => Promise.reject(new Error("Example transport failure.")),
    });
    const field = composer()!;
    await act(async () => type(field, "Please retest this."));
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(composer()?.value).toBe("Please retest this.");
  });

  it("keeps multiline input intact", async () => {
    render();
    const field = composer()!;
    await act(async () => type(field, "First line.\nSecond line."));
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(sent).toEqual([{ message: "First line.\nSecond line.", file: undefined }]);
  });

  it("renders the actions the caller supplies above the feed", () => {
    render({ actions: <button type="button">Change classification</button> });
    expect(text()).toContain("Change classification");
  });
});

describe("the card is bounded and only the feed scrolls", () => {
  it("sizes itself against the viewport rather than the conversation's length", () => {
    render({ entries: [entry("message", { message: "One." })] });

    expect(card().className).toContain("lg:h-[65vh]");
    expect(card().className).toContain("max-h-[calc(100vh-8rem)]");
    expect(card().className).toContain("min-h-[20rem]");
    expect(card().className).toContain("flex-col");
  });

  it("does not grow as the conversation does", () => {
    render({ entries: [entry("message", { message: "One." })] });
    const short = card().className;

    render({
      entries: Array.from({ length: 60 }, (_, i) => entry("message", { message: `Message ${i}.` })),
    });

    expect(feedItems()).toHaveLength(60);
    expect(card().className).toBe(short);
  });

  it("puts the scroll on the feed and nowhere else", () => {
    render({ entries: [entry("message", { message: "One." })] });

    expect(feed().className).toContain("overflow-y-auto");
    expect(container.querySelectorAll(".overflow-y-auto")).toHaveLength(1);
  });

  it("keeps the header and the caller's actions outside the scrolling feed", () => {
    render({
      entries: [entry("message", { message: "One." })],
      actions: <button type="button">Change classification</button>,
    });

    const heading = container.querySelector("h2")!;
    const action = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Change classification",
    )!;
    expect(feed().contains(heading)).toBe(false);
    expect(feed().contains(action)).toBe(false);
  });

  it("keeps the composer outside the scrolling feed", () => {
    render({ entries: [entry("message", { message: "One." })] });

    expect(feed().contains(composer()!)).toBe(false);
    expect(feed().contains(container.querySelector("form")!)).toBe(false);
  });

  it("keeps a read-only reader's note outside it too", () => {
    render({ canComment: false, composerNote: "You may read this conversation." });
    expect(feed().textContent).not.toContain("You may read this conversation.");
  });

  it("lets a keyboard user reach and scroll the feed", () => {
    render({ entries: [entry("message", { message: "One." })] });

    expect(feed().getAttribute("tabindex")).toBe("0");
    expect(feed().getAttribute("role")).toBe("log");
    expect(feed().getAttribute("aria-label")).toBe("Risk conversation");
  });

  it("wraps long words instead of scrolling sideways", () => {
    render({ entries: [entry("message", { message: "x".repeat(400) })] });

    expect(feed().className).toContain("overflow-x-hidden");
    expect(feedItems()[0].querySelector("p")?.className).toContain("break-words");
  });
});

describe("where the feed sits when things change", () => {
  it("opens at the newest item rather than the oldest", () => {
    render({ entries: [entry("message", { message: "Old." })] });
    sizeFeed();

    render({
      entries: [entry("message", { message: "Old." }), entry("message", { message: "New." })],
    });

    expect(feed().scrollTop).toBe(feed().scrollHeight);
  });

  it("follows a new arrival while the reader is already at the bottom", () => {
    render({ entries: [entry("message", { message: "One." })] });
    sizeFeed();
    scrollFeedTo(600);

    render({
      entries: [entry("message", { message: "One." }), entry("message", { message: "Two." })],
    });

    expect(feed().scrollTop).toBe(1000);
    expect(text()).not.toContain("New messages");
  });

  it("leaves a reader who has scrolled up where they are", () => {
    render({ entries: [entry("message", { message: "One." })] });
    sizeFeed();
    scrollFeedTo(0);

    render({
      entries: [entry("message", { message: "One." }), entry("message", { message: "Two." })],
    });

    expect(feed().scrollTop).toBe(0);
    expect(text()).toContain("New messages");
  });

  it("offers that reader a way to catch up, and takes it back once used", () => {
    render({ entries: [entry("message", { message: "One." })] });
    sizeFeed();
    scrollFeedTo(0);
    render({
      entries: [entry("message", { message: "One." }), entry("message", { message: "Two." })],
    });

    const jump = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("New messages"),
    )!;
    act(() => jump.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(feed().scrollTop).toBe(1000);
    expect(text()).not.toContain("New messages");
  });

  it("clears the notice when the reader scrolls back down themselves", () => {
    render({ entries: [entry("message", { message: "One." })] });
    sizeFeed();
    scrollFeedTo(0);
    render({
      entries: [entry("message", { message: "One." }), entry("message", { message: "Two." })],
    });
    expect(text()).toContain("New messages");

    scrollFeedTo(600);

    expect(text()).not.toContain("New messages");
  });

  it("goes to the newest item after the reader sends one", async () => {
    render({ entries: [entry("message", { message: "One." })] });
    sizeFeed();
    scrollFeedTo(0);

    const field = composer()!;
    await act(async () => type(field, "Please retest this."));
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(feed().scrollTop).toBe(1000);
  });

  it("does not jump when a refetch returns the same conversation", () => {
    const items = [entry("message", { message: "One." }), entry("message", { message: "Two." })];
    render({ entries: items });
    sizeFeed();
    scrollFeedTo(120);

    render({ entries: items });

    expect(feed().scrollTop).toBe(120);
  });
});

