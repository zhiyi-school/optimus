// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleCan, type Capability } from "@/auth/permissions";
import type { Finding, Ticket, UserRole } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APP = "example-app-id";
const RISK = "example-feature-01-risk-01";
const OTHER_RISK = "example-feature-01-risk-02";
const DEVELOPER = "00000000-0000-0000-0000-000000000001";

let roles: UserRole[] = ["developer"];
let findings: Finding[] = [];
let tickets: Ticket[] = [];
let conversationFound = true;

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
    selected_control_id: null,
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
  default: ({ ticketId, embedded }: { ticketId?: string; embedded?: boolean }) => (
    <p>{`remediation:${ticketId}:${embedded ? "embedded" : "standalone"}`}</p>
  ),
}));

vi.mock("@/hooks/queries", () => {
  const idle = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  const mutation = { mutateAsync: () => Promise.resolve(), isPending: false, isError: false };
  return {
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
    useProfiles: () => ({ ...idle, data: [] }),
    useTestRunHistory: () => ({ ...idle, data: [] }),
    useRiskConversation: () => ({
      ...idle,
      data: conversationFound ? { id: "example-conversation-id" } : null,
    }),
    useRiskConversationEntries: () => ({ ...idle, data: [] }),
    useRiskConversationAttachments: () => [],
    useSendRiskMessage: () => mutation,
    useFindingTickets: () => ({ ...idle, data: tickets }),
    useRiskControls: () => idle,
    useStartRemediation: () => mutation,
    useResumeTicket: () => mutation,
  };
});

const ResolveRisk = (await import("@/pages/ResolveRisk")).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  roles = ["developer"];
  findings = [finding()];
  tickets = [ticket()];
  conversationFound = true;
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
      <MemoryRouter initialEntries={[`/resolve/applications/${APP}/risks/${riskId}`]}>
        <Routes>
          <Route path="/resolve/applications/:applicationId/risks/:riskId" element={<ResolveRisk />} />
        </Routes>
      </MemoryRouter>,
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
    expect(text()).toContain("remediation:example-ticket-id:embedded");
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

  it("starts its composer empty, with no template and no placeholder", () => {
    render();
    const composer = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(composer.value).toBe("");
    expect(composer.getAttribute("placeholder")).toBeNull();
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
