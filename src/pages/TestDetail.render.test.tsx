// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleCan, type Capability } from "@/auth/permissions";
import type { AutomationResultRow } from "@/api/automation-types";
import type { RiskConversationEntry, UserRole } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ASSESSMENT = "example-assessment-id";
const APPLICATION = "example-app-id";
const RISK = "example-feature-01-risk-01";
const CONVERSATION = "example-conversation-id";
const FINDING = "example-finding-id";
const TICKET = "example-ticket-id";
const DEVELOPER = "00000000-0000-0000-0000-000000000001";

let roles: UserRole[] = ["security"];
let assessmentFound = true;
let entries: RiskConversationEntry[] = [];
let history: AutomationResultRow[] = [];
let historyFailed = false;
let findingFound = true;
let conversationFound = true;
let conversationFailed = false;
let ticketStatus: string | null = "fix_submitted";
let retestStatus: string | null = null;
let createRequested: boolean | undefined;
let conversationOwner: { applicationId?: string; originAssessmentId?: string | null } = {};

function entry(
  kind: RiskConversationEntry["kind"],
  overrides: Partial<RiskConversationEntry> = {},
): RiskConversationEntry {
  return {
    id: `entry-${kind}`,
    conversation_id: CONVERSATION,
    kind,
    author_id: DEVELOPER,
    message: null,
    metadata: {},
    source_ticket_id: null,
    created_at: "2026-01-01T00:00:00Z",
    seq: 1,
    ...overrides,
  };
}

const finding = {
  id: FINDING,
  external_id: `example_app::${RISK}`,
  application_id: "example-app-id",
  assessment_id: ASSESSMENT,
  test_id: RISK,
  latest_test_run_id: null,
  title: "Example finding",
  description: "Example description.",
  impact: null,
  severity: "high",
  status: "at_risk",
  platform: "ios",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const application = {
  id: "example-app-id",
  external_id: "example_app",
  name: "Example Application",
  platform: "ios",
  version: "1.0",
  identifier: "test.example.app",
  developer_team_id: "example-team-id",
  app_type: null,
  contact_emails: [],
  owner_name: null,
  owner_email: null,
  developer_contact_name: null,
  developer_contact_email: null,
  provisioning_status: "ready",
  provisioning_error: null,
  artifact_sha256: null,
  icon_ref: null,
  icon_extraction_status: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: { from: () => ({}), auth: {}, storage: { from: () => ({}) } },
}));

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    profile: { id: DEVELOPER, display_name: "Example Person", roles },
    can: (capability: Capability) => roleCan(roles, capability),
  }),
}));

vi.mock("@/hooks/queries", () => {
  const idle = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  const mutation = {
    mutate: () => {},
    mutateAsync: () => Promise.resolve(),
    isPending: false,
    isError: false,
    error: undefined,
  };
  return {
    useAssessment: () => ({
      ...idle,
      isSuccess: true,
      data: assessmentFound
        ? { id: ASSESSMENT, external_id: "run::example_app", application_id: "example-app-id", application, status: "completed", total_tests: 1, completed_tests: 1 }
        : null,
    }),
    useRiskCatalogue: () => ({
      ...idle,
      data: [{ risk_id: RISK, name: "Example Risk", description: "Example risk description.", test_cases: [{ id: "example_case" }] }],
    }),
    useFindings: () => ({ ...idle, data: findingFound ? [finding] : [] }),
    useProfiles: () => ({ ...idle, data: [{ id: DEVELOPER, display_name: "Example Person", email: "person@example.test", roles }] }),
    useRiskConversation: (
      applicationId: string,
      _riskId: string,
      _findingId: string,
      opts: { create: boolean; originAssessmentId?: string | null },
    ) => {
      createRequested = opts.create;
      conversationOwner = {
        applicationId,
        originAssessmentId: opts.originAssessmentId,
      };
      return {
        ...idle,
        isError: conversationFailed,
        data:
          conversationFound && !conversationFailed
            ? {
                id: CONVERSATION,
                application_id: APPLICATION,
                origin_assessment_id: ASSESSMENT,
                risk_id: RISK,
                finding_id: FINDING,
              }
            : null,
      };
    },
    useRiskConversationEntries: () => ({ ...idle, data: entries }),
    useRiskConversationAttachments: () => [],
    useSendRiskMessage: () => mutation,
    useFindingTickets: () => ({
      ...idle,
      data: ticketStatus
        ? [{ id: TICKET, finding_id: FINDING, type: "remediation", status: ticketStatus }]
        : [],
    }),
    useFindingRetests: () => ({
      ...idle,
      data: retestStatus ? [{ id: "example-retest-id", status: retestStatus }] : [],
    }),
    useFindingEvidenceItems: () => ({ ...idle, data: [] }),
    useTestRunHistory: () => ({ ...idle, isError: historyFailed, data: history }),
    useActiveRun: () => ({ run: undefined, platformRun: undefined }),
    useRunEvents: () => ({ events: [], streamState: "idle" }),
    useRunSyncStatus: () => idle,
    useResyncRun: () => mutation,
    useClassifyRisk: () => mutation,
    useRequestReassessment: () => mutation,
    useUpdateTicketStatus: () => mutation,
    useRiskControls: () => idle,
    useStartRemediation: () => mutation,
    useResumeTicket: () => mutation,
    useWithdrawTicket: () => mutation,
    useSubmitFix: () => mutation,
    useCreateRiskAcceptanceTicket: () => mutation,
    useReviewRiskAcceptance: () => mutation,
  };
});

const TestDetail = (await import("@/pages/TestDetail")).default;

let container: HTMLDivElement;
let root: Root;

function historyRun(overrides: Partial<AutomationResultRow> = {}): AutomationResultRow {
  return {
    app_id: "example_app",
    app_name: "Example Application",
    platform: "ios",
    package_or_bundle_id: "test.example.app",
    test_id: RISK,
    test_name: "Example Risk",
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

beforeEach(() => {
  roles = ["security"];
  assessmentFound = true;
  findingFound = true;
  conversationFound = true;
  conversationFailed = false;
  entries = [];
  history = [];
  historyFailed = false;
  ticketStatus = "fix_submitted";
  retestStatus = null;
  createRequested = undefined;
  conversationOwner = {};
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render() {
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/assessments/${ASSESSMENT}/tests/${RISK}`]}>
          <Routes>
            <Route path="/assessments/:assessmentId/tests/:testId" element={<TestDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}

function text() {
  return container.textContent ?? "";
}

function panels() {
  return [...container.querySelectorAll("h2")].filter(
    (heading) => heading.textContent === "Risk conversation",
  );
}

function links() {
  return [...container.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href"));
}

function buttonLabels() {
  return [...container.querySelectorAll("button")].map((button) => button.textContent?.trim());
}

function usableButtonLabels() {
  return [...container.querySelectorAll("button")]
    .filter((button) => !button.disabled)
    .map((button) => button.textContent?.trim());
}

function feedItems() {
  return [...container.querySelectorAll("ol > li")].map((item) => item.textContent ?? "");
}

describe("the risk page is the one conversation location", () => {
  it("renders exactly one risk conversation", () => {
    render();
    expect(panels()).toHaveLength(1);
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
  });

  it("shows the risk, its classification and its severity", () => {
    render();
    expect(text()).toContain("Example Risk");
    expect(text()).toContain("Example risk description.");
    expect(text()).toContain("At Risk");
    expect(text()).toContain("High");
  });

  it("points at the developer's workspace for the same risk, not a tickets page", () => {
    roles = ["security", "developer"];
    render();
    expect(links()).toContain(`/resolve/applications/example-app-id/risks/${RISK}`);
    expect(links().some((href) => href?.startsWith("/findings"))).toBe(false);
    expect(links().some((href) => href?.startsWith("/tickets"))).toBe(false);
  });

  it("offers a security-only user no cross-link into Resolve", () => {
    render();
    expect(links().some((href) => href?.startsWith("/resolve"))).toBe(false);
  });

  it("resolves the conversation by application, carrying the assessment as context", () => {
    render();
    expect(conversationOwner).toEqual({
      applicationId: APPLICATION,
      originAssessmentId: ASSESSMENT,
    });
  });

  it("has no standalone automated test history card left", () => {
    history = [historyRun()];
    render();
    expect(text()).not.toContain("Automated Test History");
    // The run still shows — inside the one conversation, not in a card of its own.
    expect(panels()).toHaveLength(1);
    expect(text()).toContain("The example check did not pass.");
  });

  it("puts the automated runs in the conversation, in order with the discussion", () => {
    entries = [
      entry("message", { message: "Looking into this.", created_at: "2026-01-01T00:00:00Z" }),
      entry("fix_submitted", {
        id: "fixed",
        message: "Shipped 2.1.",
        created_at: "2026-01-03T00:00:00Z",
      }),
    ];
    history = [historyRun({ started_at: "2026-01-02T00:00:00Z", summary: "Run in between." })];
    render();

    const items = feedItems();
    expect(items).toHaveLength(3);
    expect(items[0]).toContain("Looking into this.");
    expect(items[1]).toContain("Run in between.");
    expect(items[2]).toContain("Shipped 2.1.");
  });

  it("keeps the live progress panel separate from the history", () => {
    history = [historyRun()];
    render();
    expect(text()).not.toContain("Automated test is running");
  });

  it("shows the workflow events recorded against this risk", () => {
    entries = [
      entry("retest_requested"),
      entry("retest_started", { id: "started" }),
      entry("retest_completed", { id: "completed", message: "Reduced Risk." }),
    ];
    render();

    expect(text()).toContain("Reassessment requested");
    expect(text()).toContain("Reassessment started");
    expect(text()).toContain("Reassessment completed");
  });

  it("shows a failed reassessment as such", () => {
    entries = [entry("retest_failed", { message: "The device dropped off." })];
    render();
    expect(text()).toContain("Reassessment did not complete");
    expect(text()).toContain("The device dropped off.");
  });
});

describe("security", () => {
  it("can change the classification and run the tests", () => {
    render();
    expect(buttonLabels()).toContain("Change classification");
    expect(buttonLabels()).toContain("Run Again");
  });

  it("can run a reassessment a developer has requested", () => {
    retestStatus = "queued";
    render();
    expect(usableButtonLabels()).toContain("Run Retest");
  });

  it("is told why the classification cannot be changed when no result exists yet", () => {
    findingFound = false;
    render();

    expect(buttonLabels()).toContain("Change classification");
    expect(usableButtonLabels()).not.toContain("Change classification");
    expect(text()).toContain("No result has been published for this risk yet");
  });

  it("does not offer to request a reassessment of its own work", () => {
    render();
    expect(buttonLabels()).not.toContain("Request reassessment");
  });
});

describe("a developer", () => {
  beforeEach(() => {
    roles = ["developer"];
  });

  it("can open the conversation and post in it", () => {
    render();
    expect(panels()).toHaveLength(1);
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
    expect(createRequested).toBe(true);
  });

  it("cannot run a test", () => {
    render();
    expect(buttonLabels()).not.toContain("Run Automated Test");
    expect(buttonLabels()).not.toContain("Run Again");
    expect(text()).not.toContain("Run automated test");
  });

  it("cannot change the classification", () => {
    render();
    expect(buttonLabels()).not.toContain("Change classification");
  });

  it("cannot run a reassessment even when one is queued", () => {
    retestStatus = "queued";
    render();
    expect(buttonLabels()).not.toContain("Run Retest");
  });

  it("can request a reassessment once a fix is submitted", () => {
    render();
    expect(usableButtonLabels()).toContain("Request reassessment");
  });

  it("is told to submit the fix first rather than shown nothing", () => {
    ticketStatus = "in_progress";
    render();

    expect(buttonLabels()).toContain("Request reassessment");
    expect(usableButtonLabels()).not.toContain("Request reassessment");
    expect(text()).toContain("Submit your fix on the remediation ticket first");
  });

  it("is told to start a remediation when there is no ticket, and can still ask a question", () => {
    ticketStatus = null;
    render();

    expect(buttonLabels()).toContain("Request reassessment");
    expect(usableButtonLabels()).not.toContain("Request reassessment");
    expect(text()).toContain("Start a remediation for this risk");
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
  });

  it("sees that a reassessment is already under way instead of asking twice", () => {
    retestStatus = "queued";
    render();

    expect(usableButtonLabels()).not.toContain("Request reassessment");
    expect(text()).toContain("A reassessment has been requested");
  });

  it("is refused an assessment outside their application scope", () => {
    assessmentFound = false;
    render();
    expect(text()).toContain("You do not have access to this assessment.");
    expect(panels()).toHaveLength(0);
  });
});

describe("a read-only viewer", () => {
  beforeEach(() => {
    roles = ["cio"];
  });

  it("reads the conversation without a composer", () => {
    render();
    expect(panels()).toHaveLength(1);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("is never the reason a conversation gets created", () => {
    render();
    expect(createRequested).toBe(false);
  });

  it("gets no classification or test controls", () => {
    retestStatus = "queued";
    render();
    expect(buttonLabels()).not.toContain("Change classification");
    expect(buttonLabels()).not.toContain("Run Retest");
    expect(buttonLabels()).not.toContain("Run Automated Test");
  });
});

describe("a conversation that does not exist yet", () => {
  it("shows the thread without a composer rather than failing", () => {
    conversationFound = false;
    roles = ["cio"];
    render();
    expect(panels()).toHaveLength(1);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
  });
});

describe("a conversation that could not be loaded", () => {
  it("says so and offers a retry rather than showing an empty thread", () => {
    conversationFailed = true;
    render();

    expect(panels()).toHaveLength(1);
    expect(text()).toContain("Unable to load this risk conversation.");
    expect(buttonLabels()).toContain("Retry");
  });

  it("explains the missing composer instead of quietly dropping it", () => {
    conversationFailed = true;
    roles = ["developer"];
    render();

    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    expect(text()).toContain("This conversation could not be opened");
  });
});

describe("the automated history the backend serves", () => {
  it("keeps the conversation usable when the history cannot be fetched", () => {
    historyFailed = true;
    entries = [entry("message", { message: "Still readable." })];
    render();

    expect(text()).toContain("Still readable.");
    expect(text()).toContain("Unable to load the automated test history.");
  });
});
