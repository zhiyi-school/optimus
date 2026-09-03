// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlDetail } from "@/api/playbook-types";
import type { Ticket, TicketControl, TicketControlStep, TicketStatus } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TICKET = "example-ticket-id";
const FIRST = "example-feature-01-risk-01-control-01";
const SECOND = "example-feature-01-risk-01-control-02";

function definition(overrides: Partial<ControlDetail> = {}): ControlDetail {
  return {
    control_id: FIRST,
    risk_id: "example-feature-01-risk-01",
    platform: "ios",
    title: "Approach one",
    status: "active",
    required: true,
    step_count: 2,
    playbook_revision: "sha256:example",
    has_source_archive: false,
    summary: "Example approach summary.",
    source_file: "example-control.md",
    status_source: "default",
    intro: [],
    steps: [
      {
        step_key: "rotate-example-key",
        step_id_source: "declared",
        content_hash: "sha256:one",
        step_index: 0,
        number: 1,
        step_title: "First",
        text: "First",
        content: [],
      },
      {
        step_key: "revoke-example-key",
        step_id_source: "declared",
        content_hash: "sha256:two",
        step_index: 1,
        number: 2,
        step_title: "Second",
        text: "Second",
        content: [],
      },
    ],
    references: [],
    source_archives: [],
    source_download_url: null,
    ...overrides,
  };
}

let definitions: ControlDetail[] = [];
let storedSelection: string | null = null;
let ticketStatus: TicketStatus = "in_progress";
let controlRows: TicketControl[] = [];
let stepRows: TicketControlStep[] = [];
let capabilities: string[] = ["update_control_progress", "submit_fix", "view_resolve"];

let selected: string[] = [];
let reconciled: { control_id: string; step_keys: string[] }[][] = [];

function ticket(): Ticket {
  return {
    id: TICKET,
    finding_id: "example-finding-id",
    application_id: "example-app-id",
    type: "remediation",
    status: ticketStatus,
    title: "Remediate: Example finding",
    description: null,
    created_by: "example-user-id",
    assigned_user_id: null,
    assigned_team_id: "example-team-id",
    target_version: null,
    risk_conversation_id: null,
    origin_assessment_id: null,
    selected_control_id: storedSelection,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    closed_at: null,
    withdrawn_at: null,
    withdrawn_by: null,
    withdrawal_reason: null,
  };
}

function controlRow(controlId: string, id: string): TicketControl {
  return {
    id,
    ticket_id: TICKET,
    control_id: controlId,
    status: "not_started",
    completed_at: null,
    completed_by: null,
    developer_note: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function stepRow(controlRowId: string, stepKey: string, status = "not_started"): TicketControlStep {
  return {
    id: `${controlRowId}-${stepKey}`,
    ticket_control_id: controlRowId,
    step_key: stepKey,
    status: status as TicketControlStep["status"],
    completed_at: null,
    completed_by: null,
    developer_note: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: { from: () => ({}), auth: {}, storage: { from: () => ({}) } },
}));

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    profile: { id: "example-user-id", display_name: "Example Developer", roles: ["developer"] },
    can: (capability: string) => capabilities.includes(capability),
  }),
}));

vi.mock("@/hooks/queries", () => {
  const idle = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  return {
    useTicket: () => ({
      ...idle,
      data: {
        ...ticket(),
        finding: {
          id: "example-finding-id",
          platform: "ios",
          test_id: "example-feature-01-risk-01",
          title: "Example finding",
          description: null,
          impact: null,
          severity: "high",
          status: "at_risk",
        },
        application: null,
      },
    }),
    useRiskControls: () => ({ ...idle, data: definitions }),
    useTicketControls: () => ({ ...idle, data: controlRows }),
    useTicketControlSteps: () => ({ ...idle, data: stepRows }),
    useRiskConversationById: () => idle,
    useProfiles: () => ({ ...idle, data: [] }),
    useActivity: () => ({ ...idle, data: [] }),
    useFindingEvidenceItems: () => ({ ...idle, data: [] }),
    useTicketEvidenceItems: () => ({ ...idle, data: [] }),
    useUploadTicketEvidence: () => ({ mutateAsync: () => Promise.resolve(), isPending: false, isError: false }),
    usePlaybookRevisionWatch: () => ({ updated: false, dismiss: () => {} }),
    useSubmitFix: () => ({ mutateAsync: () => Promise.resolve(), isPending: false, isError: false }),
    useSelectRemediationControl: () => ({
      mutate: (controlId: string, options?: { onSettled?: () => void }) => {
        selected.push(controlId);
        storedSelection = controlId;
        options?.onSettled?.();
      },
      isPending: false,
      isError: false,
      error: undefined,
    }),
    useReconcileTicketControls: () => ({
      mutate: (plan: { control_id: string; step_keys: string[] }[], options?: { onSettled?: () => void }) => {
        reconciled.push(plan);
        for (const entry of plan) {
          let row = controlRows.find((candidate) => candidate.control_id === entry.control_id);
          if (!row) {
            row = controlRow(entry.control_id, `tc-${controlRows.length + 1}`);
            controlRows = [...controlRows, row];
          }
          for (const key of entry.step_keys) {
            if (stepRows.some((s) => s.ticket_control_id === row!.id && s.step_key === key)) continue;
            stepRows = [...stepRows, stepRow(row.id, key)];
          }
        }
        options?.onSettled?.();
      },
      isPending: false,
      isError: false,
    }),
  };
});

const ResolveTicket = (await import("@/pages/ResolveTicket")).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  definitions = [definition()];
  storedSelection = null;
  ticketStatus = "in_progress";
  controlRows = [];
  stepRows = [];
  capabilities = ["update_control_progress", "submit_fix", "view_resolve"];
  selected = [];
  reconciled = [];
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
      <MemoryRouter initialEntries={[`/resolve/tickets/${TICKET}`]}>
        <Routes>
          <Route path="/resolve/tickets/:ticketId" element={<ResolveTicket />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

function text() {
  return container.textContent ?? "";
}

function buttonNamed(label: string) {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
}

function twoApproaches() {
  definitions = [definition(), definition({ control_id: SECOND, title: "Approach two", step_count: 1, steps: [definition().steps[0]] })];
}

describe("choosing the remediation approach", () => {
  it("selects the only approach automatically and persists it", () => {
    render();

    expect(selected).toEqual([FIRST]);
    expect(text()).toContain("Approach one");
  });

  it("creates progress rows only for the selected approach", () => {
    twoApproaches();
    render();

    expect(reconciled.flat().map((entry) => entry.control_id)).toEqual([FIRST]);
    expect(controlRows.map((row) => row.control_id)).toEqual([FIRST]);
  });

  it("defaults to the first approach the backend returned when there are several", () => {
    twoApproaches();
    render();

    expect(selected).toEqual([FIRST]);
    expect(text()).toContain("multiple remediation approaches");
  });

  it("says nothing about alternatives when there is only one approach", () => {
    render();
    expect(text()).not.toContain("multiple remediation approaches");
  });

  it("does not overwrite a selection that is already stored", () => {
    twoApproaches();
    storedSelection = SECOND;
    render();

    expect(selected).toEqual([]);
    expect(text()).toContain("Approach two");
  });

  it("keeps a stored selection when the backend reorders its controls", () => {
    storedSelection = SECOND;
    definitions = [
      definition({ control_id: SECOND, title: "Approach two", steps: [definition().steps[0]] }),
      definition(),
    ];
    render();

    expect(selected).toEqual([]);
    expect(text()).toContain("Approach two");
  });

  it("initialises once rather than on every render", () => {
    twoApproaches();
    render();
    render();

    expect(selected).toEqual([FIRST]);
  });

  it("records nothing while the developer may not edit the ticket", () => {
    capabilities = ["view_resolve"];
    render();

    expect(selected).toEqual([]);
    expect(reconciled).toEqual([]);
  });

  it("records nothing once security verification has started", () => {
    ticketStatus = "retest_requested";
    render();

    expect(selected).toEqual([]);
    expect(reconciled).toEqual([]);
  });

  it("shows an empty state and selects nothing when the risk has no approaches", () => {
    definitions = [];
    render();

    expect(selected).toEqual([]);
    expect(text()).toContain("no developer controls for this risk");
  });

  it("never offers a deprecated or deprioritised control as an approach", () => {
    definitions = [
      definition({ control_id: SECOND, title: "Approach two", status: "deprecated" }),
      definition(),
    ];
    render();

    expect(selected).toEqual([FIRST]);
    expect(text()).not.toContain("Approach two");
  });
});

describe("switching approach", () => {
  it("offers the alternatives with a preview and a way to adopt each", () => {
    twoApproaches();
    render();
    act(() => buttonNamed("View other approaches (1)")?.click());

    expect(text()).toContain("Approach two");
    expect(buttonNamed("Use this approach")).not.toBeUndefined();
    const preview = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(preview).toContain(`/findings/example-finding-id/controls/${SECOND}`);
  });

  it("switches straight away when nothing has been recorded yet", () => {
    twoApproaches();
    render();
    act(() => buttonNamed("View other approaches (1)")?.click());
    act(() => buttonNamed("Use this approach")?.click());

    expect(selected).toEqual([FIRST, SECOND]);
    expect(text()).not.toContain("Change remediation approach?");
  });

  it("asks first when progress has been recorded, and explains what happens to it", () => {
    twoApproaches();
    storedSelection = FIRST;
    controlRows = [controlRow(FIRST, "tc-1")];
    stepRows = [
      stepRow("tc-1", "rotate-example-key", "completed"),
      stepRow("tc-1", "revoke-example-key", "not_started"),
    ];
    render();
    act(() => buttonNamed("View other approaches (1)")?.click());
    act(() => buttonNamed("Use this approach")?.click());

    expect(selected).toEqual([]);
    expect(document.body.textContent).toContain("Change remediation approach?");
    expect(document.body.textContent).toContain("no longer count");
  });

  it("keeps the old progress rows after a confirmed switch", () => {
    twoApproaches();
    storedSelection = FIRST;
    controlRows = [controlRow(FIRST, "tc-1")];
    stepRows = [stepRow("tc-1", "rotate-example-key", "completed")];
    render();
    act(() => buttonNamed("View other approaches (1)")?.click());
    act(() => buttonNamed("Use this approach")?.click());
    act(() => {
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "Change approach")
        ?.click();
    });

    expect(selected).toEqual([SECOND]);
    expect(stepRows.some((row) => row.step_key === "rotate-example-key" && row.status === "completed")).toBe(true);
  });

  it("offers no switch at all while security holds the ticket", () => {
    twoApproaches();
    storedSelection = FIRST;
    ticketStatus = "under_review";
    render();

    act(() => buttonNamed("View other approaches (1)")?.click());
    expect(buttonNamed("Use this approach")?.disabled).toBe(true);
  });
});

describe("an approach the playbook has withdrawn", () => {
  beforeEach(() => {
    storedSelection = "example-removed-control";
    controlRows = [controlRow("example-removed-control", "tc-1")];
    stepRows = [stepRow("tc-1", "rotate-example-key", "completed")];
  });

  it("explains that the approach is gone and moves to the replacement", () => {
    render();

    expect(text()).toContain("no longer in the playbook");
    expect(text()).toContain("Approach one");
  });

  it("stops counting the withdrawn approach's progress without deleting it", () => {
    render();

    expect(text()).toContain("0 of 2");
    expect(stepRows[0].status).toBe("completed");
  });

  it("says so plainly when no replacement exists", () => {
    definitions = [];
    render();

    expect(text()).toContain("No replacement approach is available");
  });
});

describe("submitting the fix", () => {
  function completeSelected() {
    storedSelection = FIRST;
    controlRows = [controlRow(FIRST, "tc-1")];
    stepRows = [
      stepRow("tc-1", "rotate-example-key", "completed"),
      stepRow("tc-1", "revoke-example-key", "completed"),
    ];
  }

  it("is available once every step of the selected approach is done", () => {
    completeSelected();
    render();

    expect(buttonNamed("Submit fix")?.disabled).toBe(false);
  });

  it("is blocked while a step of the selected approach is outstanding", () => {
    storedSelection = FIRST;
    controlRows = [controlRow(FIRST, "tc-1")];
    stepRows = [stepRow("tc-1", "rotate-example-key", "completed"), stepRow("tc-1", "revoke-example-key")];
    render();

    expect(buttonNamed("Submit fix")?.disabled).toBe(true);
    expect(text()).toContain("Complete all 2 steps");
  });

  it("does not require the alternatives to be completed", () => {
    twoApproaches();
    completeSelected();
    controlRows = [...controlRows, controlRow(SECOND, "tc-2")];
    stepRows = [...stepRows, stepRow("tc-2", "rotate-example-key")];
    render();

    expect(buttonNamed("Submit fix")?.disabled).toBe(false);
  });

  it("is blocked while a withdrawn approach still needs review", () => {
    storedSelection = "example-removed-control";
    render();

    expect(buttonNamed("Submit fix")?.disabled).toBe(true);
  });
});
