// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleCan, type Capability } from "@/auth/permissions";
import type { Finding, RetestRun, Ticket, UserRole } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APP = "example-app-id";
const RISK = "example-feature-01-risk-01";
const OTHER_RISK = "example-feature-01-risk-02";
const DEVELOPER = "00000000-0000-0000-0000-000000000001";

let roles: UserRole[] = ["developer"];
let findings: Finding[] = [];
let tickets: Ticket[] = [];
let retests: RetestRun[] = [];
let conversationFound = true;
let runHistory: unknown[] = [];
let analysisDocument: unknown = undefined;

const CONTROL = "example-feature-01-risk-01-control-01";
let definitions: unknown[] = [];
let controlRows: unknown[] = [];
let stepRows: unknown[] = [];

/** A selected approach whose only step is done, so a reassessment may be asked for. */
function completedApproach() {
  definitions = [
    {
      control_id: CONTROL,
      status: "active",
      required: true,
      steps: [{ step_key: "step-one", step_index: 0, number: 1, content_hash: "sha256:one", content: [] }],
    },
  ];
  controlRows = [{ id: "tc-1", ticket_id: "example-ticket-id", control_id: CONTROL, status: "completed" }];
  stepRows = [{ id: "tc-1-step-one", ticket_control_id: "tc-1", step_key: "step-one", status: "completed" }];
}

const application = {
  id: APP,
  external_id: "example_app",
  name: "Example Application",
  platform: "ios",
  version: "1.0",
  app_type: null,
  artifact_sha256: null,
  icon_ref: null,
  icon_extraction_status: null,
};

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "example-finding-id",
    external_id: null,
    application_id: APP,
    assessment_id: "example-assessment-id",
    test_id: RISK,
    latest_test_run_id: null,
    title: "Example finding",
    description: "Example description.",
    impact: "Example impact.",
    severity: "high",
    status: "at_risk",
    platform: "ios",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Finding;
}

function retest(overrides: Partial<RetestRun> = {}): RetestRun {
  return {
    id: "example-retest-id",
    conversation_id: "example-conversation-id",
    ticket_id: "example-ticket-id",
    finding_id: "example-finding-id",
    external_test_run_id: null,
    requested_by: DEVELOPER,
    executed_by: null,
    status: "queued",
    result: null,
    created_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_reason: null,
    previous_ticket_status: "fix_submitted",
    ...overrides,
  } as RetestRun;
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "example-ticket-id",
    finding_id: "example-finding-id",
    application_id: APP,
    type: "remediation",
    status: "in_progress",
    title: "Remediate: Example finding",
    description: null,
    created_by: DEVELOPER,
    assigned_user_id: null,
    assigned_team_id: "example-team-id",
    target_version: null,
    risk_conversation_id: "example-conversation-id",
    origin_assessment_id: "example-assessment-id",
    selected_control_id: CONTROL,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    closed_at: null,
    withdrawn_at: null,
    withdrawn_by: null,
    withdrawal_reason: null,
    ...overrides,
  } as Ticket;
}

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: { from: () => ({}), auth: {}, storage: { from: () => ({}) } },
}));

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    profile: { id: DEVELOPER, display_name: "Example Developer", roles },
    can: (capability: Capability) => roleCan(roles, capability),
  }),
}));

vi.mock("@/pages/ResolveTicket", () => ({
  default: ({ ticketId }: { ticketId: string }) => <p>{`remediation:${ticketId}`}</p>,
}));

vi.mock("@/hooks/queries/assessments", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/automation", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/conversations", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/evidence", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/reference", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/tickets", async () => await import("@/test-support/query-hooks"));

vi.mock("@/test-support/query-hooks", () => {
  const idle = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  const mutation = {
    mutateAsync: () => Promise.resolve(),
    isPending: false,
    isError: false,
    error: undefined,
    reset: () => {},
  };
  return {
    ConversationAttachmentFailure: class ConversationAttachmentFailure extends Error {},
    useClassifyRisk: () => mutation,
    useApplications: () => ({ ...idle, data: [application] }),
    useFindings: () => ({ ...idle, data: findings }),
    useTickets: () => ({ ...idle, data: tickets }),
    useRiskCatalogue: () => ({
      ...idle,
      data: [
        { risk_id: RISK, name: "Example Risk", description: "Example risk description." },
        { risk_id: OTHER_RISK, name: "Example Second Risk", description: "Another risk." },
      ],
    }),
    useFindingEvidenceItems: () => ({ ...idle, data: [] }),
    useFindingRetests: () => ({ ...idle, data: retests }),
    useRequestReassessment: () => mutation,
    useWithdrawReassessment: () => mutation,
    useProfiles: () => ({ ...idle, data: [] }),
    useTestRunHistory: () => ({ ...idle, data: runHistory }),
    useIpaAnalysis: () => ({ ...idle, data: analysisDocument }),
    useRiskConversation: () => ({
      ...idle,
      data: conversationFound ? { id: "example-conversation-id" } : null,
    }),
    useRiskConversationEntries: () => ({ ...idle, data: [] }),
    useRiskConversationAttachments: () => ({ data: [], isError: false, refetch: () => {} }),
    useSendRiskMessage: () => mutation,
    useSaveConversationAttachment: () => mutation,
    useFindingTickets: () => ({ ...idle, data: tickets }),
    useRiskControls: () => ({ ...idle, data: definitions }),
    useTicketControls: () => ({ ...idle, data: controlRows }),
    useTicketControlSteps: () => ({ ...idle, data: stepRows }),
    useStartRemediation: () => mutation,
    useResumeTicket: () => mutation,
    useUpdateTicketStatus: () => mutation,
    useWithdrawTicket: () => mutation,
    useReviewRiskAcceptance: () => mutation,
    useActiveRun: () => ({ run: undefined, platformRun: undefined }),
    useRunEvents: () => ({ events: [], streamState: "idle" }),
  };
});

const ResolveRisk = (await import("@/pages/ResolveRisk")).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  roles = ["developer"];
  findings = [finding()];
  tickets = [ticket()];
  retests = [];
  conversationFound = true;
  runHistory = [];
  analysisDocument = undefined;
  completedApproach();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(riskId = RISK) {
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/resolve/applications/${APP}/risks/${riskId}`]}>
          <Routes>
            <Route path="/resolve/applications/:applicationId/risks/:riskId" element={<ResolveRisk />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}

function text() {
  return container.textContent ?? "";
}

function sidebarLinks() {
  return [...container.querySelectorAll("button[aria-current], nav button")];
}

describe("the developer feature-risk workspace", () => {
  it("shows the risk, its finding and why it matters without a separate page", () => {
    render();
    expect(text()).toContain("Example Risk");
    expect(text()).toContain("Example risk description.");
    expect(text()).toContain("High");
    expect(text()).toContain("At Risk");
  });

  it("shows the related ticket state alongside the risk", () => {
    render();
    expect(text()).toContain("In progress");
  });

  it("embeds the remediation for the ticket this risk already has", () => {
    render();
    expect(text()).toContain("remediation:example-ticket-id");
  });

  it("offers to start remediation when no ticket exists yet", () => {
    tickets = [];
    render();
    expect(text()).not.toContain("remediation:");
    expect(
      [...container.querySelectorAll("button")].some((b) => b.textContent === "Start remediation"),
    ).toBe(true);
  });

  it("lists the application's risks in the sidebar and marks the open one", () => {
    findings = [finding(), finding({ id: "second-finding-id", test_id: OTHER_RISK })];
    render();
    const current = [...container.querySelectorAll("[aria-current='page']")];
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Example Risk");
  });

  it("lists the sidebar risks in the catalogue's order, as Assess does", () => {
    // The findings come back in the opposite order to the catalogue.
    findings = [finding({ id: "second-finding-id", test_id: OTHER_RISK }), finding()];
    render();

    const names = [...container.querySelectorAll("ul li button")].map((button) =>
      button.textContent?.trim(),
    );
    const first = names.findIndex((name) => name?.includes("Example Risk"));
    const second = names.findIndex((name) => name?.includes("Example Second Risk"));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(second);
  });

  it("navigates between risks by route, from the sidebar", () => {
    findings = [finding(), finding({ id: "second-finding-id", test_id: OTHER_RISK })];
    render(OTHER_RISK);
    const current = [...container.querySelectorAll("[aria-current='page']")];
    expect(current[0].textContent).toContain("Example Second Risk");
  });

  it("goes back to Resolve, never to a findings or tickets list", () => {
    render();
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/resolve");
    expect(hrefs.some((href) => href?.startsWith("/findings"))).toBe(false);
    expect(hrefs.some((href) => href?.startsWith("/tickets"))).toBe(false);
  });

  it("renders exactly one conversation for the risk", () => {
    render();
    expect(container.querySelectorAll("[role='log']")).toHaveLength(1);
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
  });

  it("says so plainly when security has not raised this risk", () => {
    render(OTHER_RISK);
    expect(text()).toContain("Security has not raised this risk");
    expect(container.querySelector("[role='log']")).toBeNull();
  });

  it("gives a read-only viewer the thread without a composer", () => {
    roles = ["cio"];
    render();
    expect(container.querySelectorAll("[role='log']")).toHaveLength(1);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("shows no conversation at all to someone without the capability", () => {
    roles = ["admin"];
    render();
    expect(container.querySelector("[role='log']")).toBeNull();
  });
});

describe("the conversation card inside the workspace", () => {
  it("stays bounded so a long thread cannot lengthen the page", () => {
    render();
    const card = container.querySelector("[role='log']")?.closest(".rounded-xl") as HTMLElement;
    expect(card.className).toContain("lg:h-[65vh]");
  });

  it("starts its composer empty behind the placeholder, with no template", () => {
    render();
    const composer = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(composer.value).toBe("");
    expect(composer.getAttribute("placeholder")).toBe("Write a message...");
    expect(composer.getAttribute("aria-label")).toBe("Write a message");
    expect(text()).not.toContain("Status: [At Risk");
  });

  it("keeps Send disabled until something is typed", () => {
    render();
    const send = container.querySelector("button[type='submit']") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("explains itself rather than going blank when the conversation cannot open", () => {
    conversationFound = false;
    render();
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    expect(text()).toContain("could not be opened");
  });
});

describe("sidebar entries", () => {
  it("does not offer navigation that leaves the workspace", () => {
    render();
    expect(sidebarLinks().every((button) => button.tagName === "BUTTON")).toBe(true);
  });
});

describe("the automated evidence a developer is shown", () => {
  function completedRun() {
    runHistory = [
      {
        app_id: "example_app",
        app_name: "Example Application",
        platform: "ios",
        package_or_bundle_id: "test.example.app",
        test_id: RISK,
        test_name: "Example risk",
        category: "example",
        status: "IPA_ANALYSIS_COMPLETE",
        verdict: "At Risk",
        severity: "high",
        summary: "The example check did not pass.",
        started_at: "2026-01-02T00:00:00Z",
        completed_at: "2026-01-02T00:01:00Z",
        duration_seconds: 42,
        evidence: [
          {
            kind: "json",
            label: "Critical findings",
            path: "reports/example/critical_findings.json",
            ref: "example-json-ref",
            size_bytes: 128,
          },
          {
            kind: "image",
            label: "Home screen",
            path: "reports/example/home.png",
            ref: "example-image-ref",
            size_bytes: 2048,
          },
        ],
        report_path: "reports/example/report.json",
        run_timestamp: "2026-01-02_00-00-00",
        raw: {},
      },
    ];
  }

  it("does not repeat the run summary card the assessment page shows", () => {
    completedRun();
    render();

    expect(text()).not.toContain("Latest automated result");
  });

  const analysisFixture = {
    analysis_provider: "builtin",
    sensitive_scan: { enabled: true },
    sensitive_information_findings: [
      {
        path: "Example-Info.plist",
        key_path: "$.API_KEY",
        match_type: "GOOGLE_API_KEY",
        masked_value: "AIza...0000",
      },
      { path: "Example-Info.plist", key_path: "$.score", match_type: "SECURITY_SCORE", masked_value: "42" },
    ],
  };

  it("shows the run's plaintext literals to the developer, and only those", () => {
    completedRun();
    analysisDocument = analysisFixture;
    render();

    expect(text()).toContain("Exposed plaintext literals");
    expect(text()).toContain("Potential hardcoded secret key");
    expect(text()).toContain("AIza...0000");
    expect(text()).not.toContain("SECURITY_SCORE");
  });

  it("says nothing matched rather than claiming the app has no secrets", () => {
    completedRun();
    analysisDocument = { ...analysisFixture, sensitive_information_findings: [] };
    render();

    expect(text()).toContain("No matching plaintext literals reported in this run.");
  });

  it("shows no static-analysis findings table", () => {
    completedRun();
    render();

    expect(container.querySelector("table")).toBeNull();
    expect(text()).not.toContain("Static analysis findings");
    expect(text()).not.toContain("Download Markdown");
  });

  it("still lists the run's artefacts in the evidence rail", () => {
    completedRun();
    render();

    expect(text()).toContain("Critical findings");
    expect(text()).toContain("Home screen");
    expect(
      container.querySelector("button[aria-label='Download critical_findings.json']"),
    ).not.toBeNull();
  });

  function runOfEight() {
    completedRun();
    (runHistory[0] as { evidence: unknown[] }).evidence = Array.from(
      { length: 8 },
      (_, index) => ({
        kind: "json",
        label: `Artefact ${index}`,
        path: `reports/example/file-${index}.json`,
        ref: `example-ref-${index}`,
        size_bytes: 128,
      }),
    );
  }

  /** The rail is the list the expansion control owns; the thread renders runs separately. */
  function railToggle() {
    return [...container.querySelectorAll("button")].find((button) =>
      /^Show (\d+ more artefacts?|fewer artefacts)$/.test(button.textContent?.trim() ?? ""),
    );
  }

  function railNames() {
    const listId = railToggle()?.getAttribute("aria-controls");
    const list = listId ? document.getElementById(listId) : null;
    return [...(list?.querySelectorAll("li") ?? [])].map((row) => row.textContent ?? "");
  }

  it("counts every artefact but shows the first five", () => {
    runOfEight();
    render();

    expect(text()).toContain("8 items");
    expect(railNames()).toHaveLength(5);
    expect(railNames()[4]).toContain("Artefact 4");
    expect(railNames().join()).not.toContain("Artefact 5");
    expect(railToggle()?.textContent?.trim()).toBe("Show 3 more artefacts");
  });

  it("reveals the rest on request, each with its own download", () => {
    runOfEight();
    render();
    act(() => railToggle()?.click());

    expect(railNames()).toHaveLength(8);
    expect(railNames()[7]).toContain("Artefact 7");
    expect(text()).toContain("8 items");
    for (const index of [5, 6, 7]) {
      expect(
        container.querySelector(`button[aria-label='Download file-${index}.json']`),
      ).not.toBeNull();
    }

    act(() => railToggle()?.click());
    expect(railNames()).toHaveLength(5);
    expect(text()).toContain("8 items");
  });

  it("keeps no dead 'more artefacts in this run' row", () => {
    runOfEight();
    render();
    expect(text()).not.toContain("more artefacts in this run");
  });
});

describe("what the workspace no longer repeats", () => {
  it("has no 'What was found' card beside the risk header", () => {
    render();
    expect(text()).not.toContain("What was found");
    expect(text()).not.toContain("Why it matters");
  });

  it("still carries the risk's identity in the header", () => {
    render();
    const header = container.querySelector("h1")?.parentElement?.parentElement?.textContent ?? "";
    expect(header).toContain("Example Risk");
    expect(header).toContain("Example risk description.");
    expect(header).toContain("At Risk");
    expect(header).toContain("High");
    expect(header).toContain("iOS");
  });

  it("names the thread 'Conversation', dropping the old wording", () => {
    render();
    expect(container.querySelector("[role='log']")?.getAttribute("aria-label")).toBe(
      "Conversation",
    );
    expect(text().toLowerCase()).not.toContain("risk conversation");
  });
});

describe("the reassessment actions in the developer's conversation", () => {
  function buttonLabelled(label: string) {
    return [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(label),
    );
  }

  it("offers the request from inside the composer, not above the thread", () => {
    tickets = [ticket({ status: "fix_submitted" })];
    render();

    const request = buttonLabelled("Request reassessment")!;
    expect(request.disabled).toBe(false);
    expect(container.querySelector("form")?.contains(request)).toBe(true);
  });

  it("offers a developer no classification control at all", () => {
    render();
    expect(buttonLabelled("Change classification")).toBeUndefined();
  });

  it("keeps withdrawal outside the composer, where it acts immediately", () => {
    tickets = [ticket({ status: "retest_requested" })];
    retests = [retest()];
    render();

    const withdraw = buttonLabelled("Withdraw reassessment")!;
    expect(container.querySelector("form")?.contains(withdraw)).toBe(false);
  });

  it("offers the request with the approach's steps still outstanding", () => {
    stepRows = [
      { id: "tc-1-step-one", ticket_control_id: "tc-1", step_key: "step-one", status: "not_started" },
    ];
    render();

    const request = buttonLabelled("Request reassessment")!;
    expect(request.disabled).toBe(false);
    expect(request.getAttribute("aria-describedby")).toBeNull();
  });

  it("offers the request when no progress rows exist at all", () => {
    controlRows = [];
    stepRows = [];
    render();

    expect(buttonLabelled("Request reassessment")!.disabled).toBe(false);
  });

  it("offers the request straight from an in-progress remediation once its steps are done", () => {
    tickets = [ticket({ status: "in_progress" })];
    render();

    const request = buttonLabelled("Request reassessment")!;
    expect(request.disabled).toBe(false);
    expect(text()).not.toContain("Submit");
  });

  it("offers the requester no withdrawal, only the queued state", () => {
    tickets = [ticket({ status: "retest_requested" })];
    retests = [retest()];
    render();

    expect(buttonLabelled("Withdraw reassessment")).toBeUndefined();
    expect(text()).toContain("Awaiting reassessment");
  });

  it("offers no withdrawal to a developer who did not request it either", () => {
    tickets = [ticket({ status: "retest_requested" })];
    retests = [retest({ requested_by: "00000000-0000-0000-0000-0000000000ff" })];
    render();

    expect(buttonLabelled("Withdraw reassessment")).toBeUndefined();
    expect(buttonLabelled("Request reassessment")?.disabled).toBe(false);
  });

  it("offers no withdrawal to a reader who also holds the security role", () => {
    roles = ["developer", "security"];
    tickets = [ticket({ status: "retest_requested" })];
    retests = [retest()];
    render();

    expect(buttonLabelled("Withdraw reassessment")).toBeUndefined();
  });

  it("keeps a historical withdrawal event readable in the conversation", () => {
    tickets = [ticket({ status: "in_progress" })];
    retests = [retest({ status: "cancelled", cancellation_reason: "Found another defect." })];
    render();

    expect(buttonLabelled("Withdraw reassessment")).toBeUndefined();
    expect(buttonLabelled("Request reassessment")?.disabled).toBe(false);
  });

  it("offers another request even while security is running one", () => {
    tickets = [ticket({ status: "retest_in_progress" })];
    retests = [retest({ status: "running" })];
    render();

    expect(buttonLabelled("Withdraw reassessment")).toBeUndefined();
    expect(buttonLabelled("Request reassessment")?.disabled).toBe(false);
  });

  it("treats a cancelled request as history, offering the reassessment again", () => {
    tickets = [ticket({ status: "fix_submitted" })];
    retests = [
      retest({
        status: "cancelled",
        cancelled_at: "2026-01-02T00:00:00Z",
        cancelled_by: DEVELOPER,
        cancellation_reason: "Reworking the fix.",
      }),
    ];
    render();

    expect(buttonLabelled("Withdraw reassessment")).toBeUndefined();
    const request = buttonLabelled("Request reassessment");
    expect(request).toBeDefined();
    expect(request?.disabled).toBe(false);
  });

  it("does not offer withdrawal on a remediation that is no longer awaiting one", () => {
    tickets = [ticket({ status: "fix_submitted" })];
    retests = [retest()];
    render();

    expect(buttonLabelled("Withdraw reassessment")).toBeUndefined();
  });

  it("shows a read-only viewer no reassessment actions at all", () => {
    roles = ["cio"];
    tickets = [ticket({ status: "retest_requested" })];
    retests = [retest()];
    render();

    expect(buttonLabelled("Withdraw reassessment")).toBeUndefined();
    expect(buttonLabelled("Request reassessment")).toBeUndefined();
  });
});
