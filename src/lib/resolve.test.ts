import { describe, expect, it } from "vitest";
import type { ControlDetail } from "@/api/playbook-types";
import type {
  ControlProgressStatus,
  Finding,
  Ticket,
  TicketControl,
  TicketControlStep,
  TicketStatus,
} from "@/data/types";
import {
  SECURITY_FINALISED,
  activeRemediationTicket,
  canRequestReassessment,
  reassessmentBlockedReason,
  canResumeTicket,
  canWithdrawTicket,
  resumableRemediationTicket,
  canSubmitFix,
  changedSinceCompleted,
  contentHashes,
  controlProgress,
  isReconciled,
  liveControlStatus,
  liveControls,
  effectiveSelectedControlId,
  selectableControls,
  selectedControlReconciliationPlan,
  selectionWasReplaced,
  selectedControlProgress,
  submitFixBlockedReason,
  developerTicketLabel,
  developerTicketLabels,
  findingProgress,
  preferredDeveloperRisk,
  summarizeApplication,
} from "./resolve";

const APP = "app-1";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding-1",
    external_id: null,
    application_id: APP,
    assessment_id: null,
    test_id: "example-feature-01-risk-01",
    latest_test_run_id: null,
    title: "Example finding",
    description: null,
    impact: null,
    severity: "high",
    status: "at_risk",
    platform: "ios",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "ticket-1",
    finding_id: "finding-1",
    application_id: APP,
    type: "remediation",
    status: "open",
    title: "Remediate: Example finding",
    description: null,
    created_by: "user-1",
    assigned_user_id: null,
    assigned_team_id: null,
    target_version: null,
    risk_conversation_id: "conversation-1",
    origin_assessment_id: "assessment-1",
    withdrawn_at: null,
    withdrawn_by: null,
    withdrawal_reason: null,
    selected_control_id: "example-feature-01-risk-01-control-01",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    closed_at: null,
    ...overrides,
  };
}

function control(overrides: Partial<TicketControl> = {}): TicketControl {
  return {
    id: "tc-1",
    ticket_id: "ticket-1",
    control_id: "example-feature-01-risk-01-control-01",
    status: "not_started",
    completed_at: null,
    completed_by: null,
    developer_note: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function step(
  ticketControlId: string,
  stepKey: string,
  status: ControlProgressStatus = "not_started",
): TicketControlStep {
  return {
    id: `${ticketControlId}-${stepKey}`,
    ticket_control_id: ticketControlId,
    step_key: stepKey,
    status,
    completed_at: null,
    completed_by: null,
    developer_note: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function definition(overrides: Partial<ControlDetail> = {}): ControlDetail {
  return {
    control_id: "example-feature-01-risk-01-control-01",
    risk_id: "example-feature-01-risk-01",
    platform: "ios",
    title: "Control 1",
    status: "active",
    required: true,
    step_count: 2,
    playbook_revision: "sha256:aaa",
    has_source_archive: false,
    summary: "Example control summary.",
    source_file: "example-feature-01-risk-01-control-01.md",
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

describe("developer labels", () => {
  it("renames every internal ticket status for a developer audience", () => {
    const expected: Record<TicketStatus, string> = {
      open: "Action required",
      in_progress: "In progress",
      fix_submitted: "Fix submitted",
      retest_requested: "Awaiting reassessment",
      retest_in_progress: "Security verification in progress",
      under_review: "Under security review",
      closed: "Resolved",
      rejected: "Changes requested",
      accepted: "Risk accepted",
      withdrawn: "Withdrawn by developer",
    };
    for (const [status, label] of Object.entries(expected)) {
      expect(developerTicketLabels[status as TicketStatus].label, status).toBe(label);
    }
  });

  it("has no label for a status that was never set", () => {
    expect(developerTicketLabel(undefined)).toBeUndefined();
  });
});

const ROTATE = "rotate-example-key";
const REVOKE = "revoke-example-key";

describe("liveControls", () => {
  it("pairs each playbook step with the progress row that carries its stable id", () => {
    const live = liveControls([definition()], [control()], [
      step("tc-1", ROTATE, "completed"),
      step("tc-1", REVOKE),
    ]);

    expect(live).toHaveLength(1);
    expect(live[0].definition.title).toBe("Control 1");
    expect(live[0].steps.map((entry) => entry.step.step_key)).toEqual([ROTATE, REVOKE]);
    expect(live[0].steps[0].row?.status).toBe("completed");
    expect(live[0].progress).toEqual({ completed: 1, total: 2, ratio: 0.5 });
  });

  it("shows a step the playbook has added but the ticket has not recorded yet", () => {
    const live = liveControls([definition()], [control()], [step("tc-1", ROTATE, "completed")]);

    expect(live[0].steps).toHaveLength(2);
    expect(live[0].steps[1].row).toBeUndefined();
    expect(live[0].progress).toEqual({ completed: 1, total: 2, ratio: 0.5 });
    expect(live[0].status).toBe("in_progress");
  });

  it("drops a progress row for a step the playbook no longer lists", () => {
    const live = liveControls([definition()], [control()], [
      step("tc-1", ROTATE, "completed"),
      step("tc-1", REVOKE, "completed"),
      step("tc-1", "removed-example-step", "completed"),
    ]);

    expect(live[0].steps).toHaveLength(2);
    expect(live[0].progress).toEqual({ completed: 2, total: 2, ratio: 1 });
    expect(live[0].status).toBe("completed");
  });

  it("follows the playbook's order, not the order rows came back in", () => {
    const live = liveControls([definition()], [control()], [
      step("tc-1", REVOKE, "completed"),
      step("tc-1", ROTATE),
    ]);

    expect(live[0].steps.map((entry) => entry.step.step_key)).toEqual([ROTATE, REVOKE]);
    expect(live[0].steps[0].row?.status).toBe("not_started");
    expect(live[0].steps[1].row?.status).toBe("completed");
  });

  it("takes the title and summary from the playbook, never from a stored row", () => {
    const live = liveControls([definition({ title: "Renamed in the playbook" })], [control()], []);
    expect(live[0].definition.title).toBe("Renamed in the playbook");
  });

  it("shows a control the playbook has added, with no progress yet", () => {
    const live = liveControls([definition()], [], []);
    expect(live).toHaveLength(1);
    expect(live[0].row).toBeUndefined();
    expect(live[0].status).toBe("not_started");
  });

  it("drops a control the playbook no longer lists, however much progress it holds", () => {
    const removed = control({ id: "tc-9", control_id: "example-removed-control" });
    const live = liveControls([definition()], [control(), removed], [
      step("tc-9", "some-step", "completed"),
    ]);

    expect(live.map((entry) => entry.definition.control_id)).toEqual([
      "example-feature-01-risk-01-control-01",
    ]);
  });

  it("renders exactly the definitions the caller selected, filtering nothing itself", () => {
    const chosen = definition();
    expect(liveControls([chosen], [], []).map((entry) => entry.definition.control_id)).toEqual([
      chosen.control_id,
    ]);
    expect(liveControls([], [control()], [step("tc-1", ROTATE, "completed")])).toEqual([]);
  });

  it("shows nothing at all while the backend definitions are unavailable", () => {
    expect(liveControls(undefined, [control()], [step("tc-1", ROTATE, "completed")])).toEqual([]);
  });
});

describe("controlProgress", () => {
  it("totals the steps the playbook currently lists across every control", () => {
    const second = definition({
      control_id: "example-feature-01-risk-01-control-02",
      steps: [definition().steps[0]],
    });
    const live = liveControls(
      [definition(), second],
      [control(), control({ id: "tc-2", control_id: second.control_id })],
      [step("tc-1", ROTATE, "completed"), step("tc-2", ROTATE, "completed")],
    );

    expect(controlProgress(live)).toEqual({ completed: 2, total: 3, ratio: 2 / 3 });
  });

  it("reports nothing rather than dividing by zero when there is no live work", () => {
    expect(controlProgress([])).toEqual({ completed: 0, total: 0, ratio: 0 });
  });
});

describe("liveControlStatus", () => {
  it("is complete only when every live step is complete", () => {
    const live = liveControls([definition()], [control()], [
      step("tc-1", ROTATE, "completed"),
      step("tc-1", REVOKE, "completed"),
    ]);
    expect(live[0].status).toBe("completed");
  });

  it("is in progress once any step has moved", () => {
    const live = liveControls([definition()], [control()], [step("tc-1", ROTATE, "completed")]);
    expect(live[0].status).toBe("in_progress");
  });

  it("is not started when nothing has moved", () => {
    const live = liveControls([definition()], [control()], [
      step("tc-1", ROTATE),
      step("tc-1", REVOKE),
    ]);
    expect(live[0].status).toBe("not_started");
  });

  it("keeps a security request for changes even when every step is ticked", () => {
    const live = liveControls([definition()], [control({ status: "needs_changes" })], [
      step("tc-1", ROTATE, "completed"),
      step("tc-1", REVOKE, "completed"),
    ]);
    expect(live[0].status).toBe("needs_changes");
  });

  it("falls back to the stored status when the control has no steps", () => {
    expect(liveControlStatus(control({ status: "in_progress" }), [])).toBe("in_progress");
  });
});

describe("findingProgress", () => {
  it("counts resolved findings over actionable findings", () => {
    const findings = [
      finding({ id: "f1", status: "at_risk" }),
      finding({ id: "f2", status: "reduced_risk" }),
      finding({ id: "f3", status: "reduced_risk" }),
    ];
    expect(findingProgress(findings)).toEqual({ completed: 2, total: 3, ratio: 2 / 3 });
  });

  it("leaves inconclusive findings out — they are security's call, not developer work", () => {
    const findings = [
      finding({ id: "f1", status: "at_risk" }),
      finding({ id: "f2", status: "inconclusive" }),
    ];
    expect(findingProgress(findings)).toEqual({ completed: 0, total: 1, ratio: 0 });
  });

  it("reports nothing rather than dividing by zero with no findings", () => {
    expect(findingProgress([])).toEqual({ completed: 0, total: 0, ratio: 0 });
  });
});

describe("summarizeApplication", () => {
  it("counts only the rows belonging to the application asked about", () => {
    const findings = [finding(), finding({ id: "f2", application_id: "app-2" })];
    const tickets = [ticket(), ticket({ id: "t2", application_id: "app-2" })];

    const summary = summarizeApplication(APP, findings, tickets, [], []);
    expect(summary.affectedFindings).toBe(1);
    expect(summary.findingsRequiringAction).toBe(1);
  });

  it("ignores risk-acceptance tickets when counting remediation work", () => {
    const tickets = [ticket({ id: "t2", type: "risk_acceptance", status: "under_review" })];
    const summary = summarizeApplication(APP, [finding()], tickets, [], []);
    expect(summary.awaitingReassessment).toBe(0);
  });

  it("counts fixes submitted and reassessments awaiting security separately", () => {
    const tickets = [
      ticket({ id: "t1", status: "fix_submitted" }),
      ticket({ id: "t2", status: "retest_requested" }),
      ticket({ id: "t3", status: "retest_in_progress" }),
      ticket({ id: "t4", status: "under_review" }),
    ];
    const summary = summarizeApplication(APP, [finding()], tickets, [], []);
    expect(summary.fixesSubmitted).toBe(1);
    expect(summary.awaitingReassessment).toBe(3);
  });

  it("counts only the ticket's selected approach, never its alternatives", () => {
    const controls = [control(), control({ id: "tc-2", control_id: "c2" })];
    const steps = [
      step("tc-1", "rotate-example-key", "completed"),
      step("tc-2", "rotate-example-key", "completed"),
      step("tc-2", "revoke-example-key", "not_started"),
    ];
    const summary = summarizeApplication(APP, [finding()], [ticket()], controls, steps);
    expect(summary.controls).toEqual({ completed: 1, total: 1, ratio: 1 });
  });

  it("counts nothing for a ticket that has not chosen an approach yet", () => {
    const summary = summarizeApplication(
      APP,
      [finding()],
      [ticket({ selected_control_id: null })],
      [control()],
      [step("tc-1", "rotate-example-key", "completed")],
    );
    expect(summary.controls).toEqual({ completed: 0, total: 0, ratio: 0 });
  });

  it("leaves progress from an abandoned approach as history that does not count", () => {
    const controls = [control(), control({ id: "tc-2", control_id: "c2" })];
    const steps = [
      step("tc-1", "rotate-example-key", "completed"),
      step("tc-1", "revoke-example-key", "completed"),
      step("tc-2", "rotate-example-key", "not_started"),
    ];
    const summary = summarizeApplication(
      APP,
      [finding()],
      [ticket({ selected_control_id: "c2" })],
      controls,
      steps,
    );

    expect(summary.controls).toEqual({ completed: 0, total: 1, ratio: 0 });
    expect(steps.filter((s) => s.status === "completed")).toHaveLength(2);
  });

  it("only counts controls belonging to this application's tickets", () => {
    const controls = [control({ id: "tc-9", ticket_id: "other-ticket" })];
    const summary = summarizeApplication(APP, [finding()], [ticket()], controls, []);
    expect(summary.controls.total).toBe(0);
  });

  describe("overall status", () => {
    it("is action required when a finding is at risk and nothing has started", () => {
      expect(summarizeApplication(APP, [finding()], [], [], []).status).toBe("action_required");
    });

    it("is in progress once a developer has started", () => {
      const summary = summarizeApplication(
        APP,
        [finding()],
        [ticket({ status: "in_progress" })],
        [],
        [],
      );
      expect(summary.status).toBe("in_progress");
    });

    it("is awaiting security once a reassessment is requested", () => {
      const summary = summarizeApplication(
        APP,
        [finding()],
        [ticket({ status: "retest_requested" })],
        [],
        [],
      );
      expect(summary.status).toBe("awaiting_security");
    });

    it("is changes requested when security sent work back", () => {
      const summary = summarizeApplication(
        APP,
        [finding()],
        [ticket({ status: "rejected" })],
        [],
        [],
      );
      expect(summary.status).toBe("changes_requested");
    });

    it("is resolved only when every actionable finding is reduced", () => {
      const summary = summarizeApplication(
        APP,
        [finding({ status: "reduced_risk" })],
        [ticket({ status: "closed" })],
        [],
        [],
      );
      expect(summary.status).toBe("resolved");
    });

    it("stays unresolved while one finding is still at risk", () => {
      const summary = summarizeApplication(
        APP,
        [finding({ id: "f1", status: "reduced_risk" }), finding({ id: "f2", status: "at_risk" })],
        [],
        [],
        [],
      );
      expect(summary.status).toBe("action_required");
    });

    it("says there is nothing to remediate when no finding is actionable", () => {
      const summary = summarizeApplication(APP, [finding({ status: "inconclusive" })], [], [], []);
      expect(summary.status).toBe("no_findings");
    });

    it("ignores a closed ticket when deciding whether work is under way", () => {
      const summary = summarizeApplication(
        APP,
        [finding()],
        [ticket({ status: "closed" })],
        [],
        [],
      );
      expect(summary.status).toBe("action_required");
    });
  });

  it("reports the most recent update across findings and tickets", () => {
    const summary = summarizeApplication(
      APP,
      [finding({ updated_at: "2026-01-02T00:00:00Z" })],
      [ticket({ updated_at: "2026-01-05T00:00:00Z" })],
      [],
      [],
    );
    expect(summary.lastUpdatedAt).toBe("2026-01-05T00:00:00Z");
  });
});

describe("dashboard totals against the live playbook", () => {
  const liveKeys = {
    controlIds: new Set(["example-feature-01-risk-01-control-01"]),
    stepKeys: new Set(["rotate-example-key", "revoke-example-key"]),
  };

  it("ignores progress rows for a control the playbook has dropped", () => {
    const controls = [control(), control({ id: "tc-9", control_id: "example-removed-control" })];
    const steps = [step("tc-1", "rotate-example-key", "completed"), step("tc-9", "gone", "completed")];

    const summary = summarizeApplication(APP, [finding()], [ticket()], controls, steps, liveKeys);
    expect(summary.controls).toEqual({ completed: 1, total: 1, ratio: 1 });
  });

  it("ignores progress rows for a step the playbook has dropped", () => {
    const steps = [
      step("tc-1", "rotate-example-key", "completed"),
      step("tc-1", "removed-example-step", "completed"),
    ];

    const summary = summarizeApplication(APP, [finding()], [ticket()], [control()], steps, liveKeys);
    expect(summary.controls).toEqual({ completed: 1, total: 1, ratio: 1 });
  });

  it("counts every stored row when the playbook could not be reached", () => {
    const steps = [
      step("tc-1", "rotate-example-key", "completed"),
      step("tc-1", "removed-example-step", "completed"),
    ];

    const summary = summarizeApplication(APP, [finding()], [ticket()], [control()], steps);
    expect(summary.controls).toEqual({ completed: 2, total: 2, ratio: 1 });
  });

  it("does not report a control complete on the strength of a removed step alone", () => {
    const steps = [step("tc-1", "removed-example-step", "completed")];

    const summary = summarizeApplication(APP, [finding()], [ticket()], [control()], steps, liveKeys);
    expect(summary.controls).toEqual({ completed: 0, total: 0, ratio: 0 });
  });
});

describe("selectedControlReconciliationPlan", () => {
  it("plans a row for every step of the selected control, and no playbook content", () => {
    expect(selectedControlReconciliationPlan(definition())).toEqual([
      {
        control_id: "example-feature-01-risk-01-control-01",
        step_keys: ["rotate-example-key", "revoke-example-key"],
      },
    ]);
  });

  it("carries no title, ordering, revision or step text into the database", () => {
    const [plan] = selectedControlReconciliationPlan(definition());
    expect(Object.keys(plan).sort()).toEqual(["control_id", "step_keys"]);
  });

  it("plans nothing when no approach is selected", () => {
    expect(selectedControlReconciliationPlan(undefined)).toEqual([]);
  });

  it("plans only the selected control, never its alternatives", () => {
    const other = definition({ control_id: "example-feature-01-risk-01-control-02" });
    const plan = selectedControlReconciliationPlan(definition());
    expect(plan).toHaveLength(1);
    expect(plan[0].control_id).not.toBe(other.control_id);
  });
});

describe("selectableControls", () => {
  it("offers an active remediation control as an approach", () => {
    expect(selectableControls([definition()]).map((c) => c.control_id)).toEqual([
      "example-feature-01-risk-01-control-01",
    ]);
  });

  it("never offers a deprioritized or deprecated control", () => {
    expect(selectableControls([definition({ status: "deprioritized", required: false })])).toEqual([]);
    expect(selectableControls([definition({ status: "deprecated", required: false })])).toEqual([]);
    expect(selectableControls([definition({ status: "deprecated", required: true })])).toEqual([]);
    expect(selectableControls([definition({ status: "deprioritized", required: true })])).toEqual([]);
  });

  it("never offers an active control the catalogue marked non-remediation", () => {
    expect(selectableControls([definition({ required: false })])).toEqual([]);
  });

  it("offers nothing when the risk has no controls", () => {
    expect(selectableControls([])).toEqual([]);
    expect(selectableControls(undefined)).toEqual([]);
  });

  it("keeps the backend's own order", () => {
    const first = definition({ control_id: "example-feature-01-risk-01-control-01" });
    const second = definition({ control_id: "example-feature-01-risk-01-control-02" });
    expect(selectableControls([second, first]).map((c) => c.control_id)).toEqual([
      "example-feature-01-risk-01-control-02",
      "example-feature-01-risk-01-control-01",
    ]);
  });
});

describe("effectiveSelectedControlId", () => {
  const first = definition({ control_id: "example-feature-01-risk-01-control-01" });
  const second = definition({ control_id: "example-feature-01-risk-01-control-02" });

  it("selects the only control when there is one", () => {
    expect(effectiveSelectedControlId(null, [first])).toBe(first.control_id);
  });

  it("defaults to the first control the backend returned", () => {
    expect(effectiveSelectedControlId(null, [second, first])).toBe(second.control_id);
  });

  it("keeps a stored selection that is still on offer", () => {
    expect(effectiveSelectedControlId(first.control_id, [second, first])).toBe(first.control_id);
  });

  it("is unaffected by the backend reordering its controls", () => {
    expect(effectiveSelectedControlId(second.control_id, [first, second])).toBe(second.control_id);
    expect(effectiveSelectedControlId(second.control_id, [second, first])).toBe(second.control_id);
  });

  it("replaces a stored selection the playbook no longer offers", () => {
    expect(effectiveSelectedControlId("example-removed-control", [first])).toBe(first.control_id);
    expect(selectionWasReplaced("example-removed-control", [first])).toBe(true);
    expect(selectionWasReplaced(first.control_id, [first])).toBe(false);
  });

  it("treats a blank stored id as no selection", () => {
    expect(effectiveSelectedControlId("   ", [first])).toBe(first.control_id);
    expect(selectionWasReplaced("   ", [first])).toBe(false);
  });

  it("selects nothing when no approach is available", () => {
    expect(effectiveSelectedControlId(null, [])).toBeNull();
    expect(effectiveSelectedControlId("example-removed-control", [])).toBeNull();
  });
});

describe("selected-control progress", () => {
  const first = definition({ control_id: "example-feature-01-risk-01-control-01" });
  const second = definition({
    control_id: "example-feature-01-risk-01-control-02",
    steps: [first.steps[0]],
  });

  it("counts only the selected control's current steps", () => {
    const live = selectedControlProgress(
      [first, second],
      first.control_id,
      [control(), control({ id: "tc-2", control_id: second.control_id })],
      [
        step("tc-1", ROTATE, "completed"),
        step("tc-1", REVOKE, "not_started"),
        step("tc-2", ROTATE, "completed"),
      ],
    );

    expect(live?.progress).toEqual({ completed: 1, total: 2, ratio: 0.5 });
  });

  it("shows the new totals immediately after switching approach", () => {
    const rows = [control(), control({ id: "tc-2", control_id: second.control_id })];
    const steps = [step("tc-1", ROTATE, "completed"), step("tc-1", REVOKE, "completed")];

    expect(selectedControlProgress([first, second], first.control_id, rows, steps)?.progress)
      .toEqual({ completed: 2, total: 2, ratio: 1 });
    expect(selectedControlProgress([first, second], second.control_id, rows, steps)?.progress)
      .toEqual({ completed: 0, total: 1, ratio: 0 });
  });

  it("counts a step the playbook has added as outstanding", () => {
    const grown = definition({ steps: [...first.steps, { ...first.steps[0], step_key: "new-step" }] });
    const live = selectedControlProgress(
      [grown],
      grown.control_id,
      [control()],
      [step("tc-1", ROTATE, "completed"), step("tc-1", REVOKE, "completed")],
    );

    expect(live?.progress).toEqual({ completed: 2, total: 3, ratio: 2 / 3 });
  });

  it("stops counting a step the playbook has removed", () => {
    const shrunk = definition({ steps: [first.steps[0]] });
    const live = selectedControlProgress(
      [shrunk],
      shrunk.control_id,
      [control()],
      [step("tc-1", ROTATE, "completed"), step("tc-1", REVOKE, "completed")],
    );

    expect(live?.progress).toEqual({ completed: 1, total: 1, ratio: 1 });
  });

  it("keeps progress when the playbook reorders the same stable steps", () => {
    const reordered = definition({ steps: [first.steps[1], first.steps[0]] });
    const live = selectedControlProgress(
      [reordered],
      reordered.control_id,
      [control()],
      [step("tc-1", ROTATE, "completed")],
    );

    expect(live?.progress).toEqual({ completed: 1, total: 2, ratio: 0.5 });
    expect(live?.steps.map((entry) => entry.step.step_key)).toEqual([REVOKE, ROTATE]);
  });

  it("has no progress at all when the selection is not on offer", () => {
    expect(selectedControlProgress([first], "example-removed-control", [control()], []))
      .toBeUndefined();
  });
});

describe("submitFixBlockedReason", () => {
  const first = definition();
  const rows = [control()];
  const done = [step("tc-1", ROTATE, "completed"), step("tc-1", REVOKE, "completed")];
  const partial = [step("tc-1", ROTATE, "completed"), step("tc-1", REVOKE, "not_started")];

  function reason(overrides: Parameters<typeof submitFixBlockedReason>[1], t = ticket()) {
    return submitFixBlockedReason(t, overrides);
  }

  it("allows submission once every current selected step is complete", () => {
    const live = selectedControlProgress([first], first.control_id, rows, done);
    expect(reason({ loading: false, replaced: false, control: live })).toBeNull();
  });

  it("blocks while any current selected step is outstanding", () => {
    const live = selectedControlProgress([first], first.control_id, rows, partial);
    expect(reason({ loading: false, replaced: false, control: live })).toContain("Complete all 2 steps");
  });

  it("ignores an incomplete alternative", () => {
    const second = definition({
      control_id: "example-feature-01-risk-01-control-02",
      steps: [first.steps[0]],
    });
    const live = selectedControlProgress(
      [first, second],
      first.control_id,
      [...rows, control({ id: "tc-2", control_id: second.control_id })],
      done,
    );

    expect(reason({ loading: false, replaced: false, control: live })).toBeNull();
  });

  it("blocks while the approaches are still loading", () => {
    expect(reason({ loading: true, replaced: false, control: undefined })).toContain("Loading");
  });

  it("blocks when the approaches could not be loaded", () => {
    expect(reason({ loading: false, failed: true, replaced: false, control: undefined }))
      .toContain("could not be loaded");
  });

  it("blocks until a replaced approach has been reviewed", () => {
    const live = selectedControlProgress([first], first.control_id, rows, done);
    expect(reason({ loading: false, replaced: true, control: live })).toContain("no longer in the playbook");
  });

  it("blocks when no approach is available at all", () => {
    expect(reason({ loading: false, replaced: false, control: undefined })).toContain("Select a remediation approach");
  });

  it("blocks when the ticket is no longer the developer's to submit", () => {
    const live = selectedControlProgress([first], first.control_id, rows, done);
    expect(reason({ loading: false, replaced: false, control: live }, ticket({ status: "under_review" })))
      .toContain("not yours to submit");
  });
});

describe("isReconciled", () => {
  const plan = selectedControlReconciliationPlan(definition());

  it("is satisfied once every live control and step has a row", () => {
    expect(
      isReconciled(plan, [control()], [step("tc-1", ROTATE), step("tc-1", REVOKE)]),
    ).toBe(true);
  });

  it("is unsatisfied while a newly added step has no row", () => {
    expect(isReconciled(plan, [control()], [step("tc-1", ROTATE)])).toBe(false);
  });

  it("is unsatisfied while a newly added control has no row", () => {
    expect(isReconciled(plan, [], [])).toBe(false);
  });

  it("is satisfied even when the ticket holds rows the playbook has dropped", () => {
    expect(
      isReconciled(plan, [control()], [
        step("tc-1", ROTATE),
        step("tc-1", REVOKE),
        step("tc-1", "removed-example-step", "completed"),
      ]),
    ).toBe(true);
  });
});

describe("changedSinceCompleted", () => {
  const live = () =>
    liveControls([definition()], [control()], [
      step("tc-1", ROTATE, "completed"),
      step("tc-1", REVOKE),
    ])[0].steps;

  it("flags a completed step whose content changed during the session", () => {
    const atLoad = new Map([[ROTATE, "sha256:before"]]);
    expect([...changedSinceCompleted(live(), atLoad)]).toEqual([ROTATE]);
  });

  it("says nothing when the content is unchanged", () => {
    expect([...changedSinceCompleted(live(), contentHashes(definition().steps))]).toEqual([]);
  });

  it("does not flag a step the developer has not completed", () => {
    const atLoad = new Map([[REVOKE, "sha256:before"]]);
    expect([...changedSinceCompleted(live(), atLoad)]).toEqual([]);
  });

  it("says nothing about a step that did not exist when the page loaded", () => {
    expect([...changedSinceCompleted(live(), new Map())]).toEqual([]);
  });

  it("says nothing before any content has been seen", () => {
    expect([...changedSinceCompleted(live(), undefined)]).toEqual([]);
  });
});

describe("workflow gates", () => {
  it("offers submit fix while the developer still owns the ticket", () => {
    for (const status of ["open", "in_progress", "rejected"] as TicketStatus[]) {
      expect(canSubmitFix(ticket({ status })), status).toBe(true);
    }
  });

  it("withdraws submit fix once security owns the next step", () => {
    for (const status of [
      "fix_submitted",
      "retest_requested",
      "retest_in_progress",
      "under_review",
      "closed",
      "accepted",
    ] as TicketStatus[]) {
      expect(canSubmitFix(ticket({ status })), status).toBe(false);
    }
  });

  it("offers a reassessment request only after a fix is submitted or sent back", () => {
    expect(canRequestReassessment(ticket({ status: "fix_submitted" }))).toBe(true);
    expect(canRequestReassessment(ticket({ status: "rejected" }))).toBe(true);
    expect(canRequestReassessment(ticket({ status: "open" }))).toBe(false);
    expect(canRequestReassessment(ticket({ status: "closed" }))).toBe(false);
  });

  it("offers neither on a risk-acceptance ticket", () => {
    const acceptance = ticket({ type: "risk_acceptance", status: "open" });
    expect(canSubmitFix(acceptance)).toBe(false);
    expect(canRequestReassessment(acceptance)).toBe(false);
  });

  it("offers neither with no ticket at all", () => {
    expect(canSubmitFix(null)).toBe(false);
    expect(canRequestReassessment(undefined)).toBe(false);
  });
});

describe("why a reassessment cannot be requested", () => {
  it("gives no reason when it can be", () => {
    expect(reassessmentBlockedReason(ticket({ status: "fix_submitted" }))).toBeNull();
    expect(reassessmentBlockedReason(ticket({ status: "rejected" }))).toBeNull();
  });

  it("points a developer with no ticket at starting a remediation", () => {
    expect(reassessmentBlockedReason(null)).toMatch(/start a remediation/i);
    expect(reassessmentBlockedReason(ticket({ type: "risk_acceptance" }))).toMatch(
      /start a remediation/i,
    );
  });

  it("asks for the fix first while the developer still holds the ticket", () => {
    for (const status of ["open", "in_progress"] as TicketStatus[]) {
      expect(reassessmentBlockedReason(ticket({ status })), status).toMatch(/submit your fix/i);
    }
  });

  it("says security already has it once verification has started", () => {
    for (const status of [
      "retest_requested",
      "retest_in_progress",
      "under_review",
    ] as TicketStatus[]) {
      expect(reassessmentBlockedReason(ticket({ status })), status).toMatch(/already verifying/i);
    }
  });

  it("says a withdrawn remediation has to be resumed first", () => {
    expect(reassessmentBlockedReason(ticket({ status: "withdrawn" }))).toMatch(/resume/i);
  });

  it("says security has finished once the ticket is closed or accepted", () => {
    for (const status of ["closed", "accepted"] as TicketStatus[]) {
      expect(reassessmentBlockedReason(ticket({ status })), status).toMatch(/finished/i);
    }
  });

  it("always explains itself rather than going quiet", () => {
    for (const status of [
      "open",
      "in_progress",
      "retest_requested",
      "retest_in_progress",
      "under_review",
      "accepted",
      "closed",
      "withdrawn",
    ] as TicketStatus[]) {
      const reason = reassessmentBlockedReason(ticket({ status }));
      expect(reason, status).toBeTruthy();
      expect((reason ?? "").length, status).toBeGreaterThan(10);
    }
  });
});

describe("withdrawal gates", () => {
  it("offers withdrawal while the developer still owns the ticket", () => {
    for (const status of ["open", "in_progress", "fix_submitted", "rejected"] as TicketStatus[]) {
      expect(canWithdrawTicket(ticket({ status })), status).toBe(true);
    }
  });

  it("refuses withdrawal once security verification has started", () => {
    for (const status of [
      "retest_requested",
      "retest_in_progress",
      "under_review",
    ] as TicketStatus[]) {
      expect(canWithdrawTicket(ticket({ status })), status).toBe(false);
    }
  });

  it("refuses withdrawal of a ticket security has finalised", () => {
    for (const status of SECURITY_FINALISED) {
      expect(canWithdrawTicket(ticket({ status })), status).toBe(false);
    }
  });

  it("never offers withdrawal twice", () => {
    expect(canWithdrawTicket(ticket({ status: "withdrawn" }))).toBe(false);
  });

  it("offers withdrawal on remediation tickets only", () => {
    expect(canWithdrawTicket(ticket({ type: "risk_acceptance", status: "open" }))).toBe(false);
    expect(canWithdrawTicket(ticket({ type: "app_provisioning", status: "open" }))).toBe(false);
    expect(canWithdrawTicket(null)).toBe(false);
  });

  it("offers resume only on a withdrawn remediation ticket", () => {
    expect(canResumeTicket(ticket({ status: "withdrawn" }))).toBe(true);
    for (const status of ["open", "in_progress", "closed", "accepted"] as TicketStatus[]) {
      expect(canResumeTicket(ticket({ status })), status).toBe(false);
    }
    expect(canResumeTicket(ticket({ type: "risk_acceptance", status: "withdrawn" }))).toBe(false);
  });

  it("labels a withdrawn ticket as the developer's own decision, not a resolution", () => {
    const label = developerTicketLabels.withdrawn;
    expect(label.label).toBe("Withdrawn by developer");
    expect(label.label).not.toBe(developerTicketLabels.closed.label);
    expect(label.tone).not.toBe("success");
  });
});

describe("finding to ticket resolution", () => {
  it("finds the remediation ticket a finding is currently being worked through", () => {
    const open = ticket({ id: "ticket-open", status: "in_progress" });
    expect(activeRemediationTicket("finding-1", [open])?.id).toBe("ticket-open");
  });

  it("treats a withdrawn ticket as not active, so a fresh one can be started", () => {
    expect(activeRemediationTicket("finding-1", [ticket({ status: "withdrawn" })])).toBeUndefined();
  });

  it("treats a closed or accepted ticket as not active", () => {
    for (const status of SECURITY_FINALISED) {
      expect(activeRemediationTicket("finding-1", [ticket({ status })]), status).toBeUndefined();
    }
  });

  it("ignores tickets belonging to another finding or of another type", () => {
    const other = ticket({ id: "other", finding_id: "finding-2" });
    const acceptance = ticket({ id: "acceptance", type: "risk_acceptance" });
    expect(activeRemediationTicket("finding-1", [other, acceptance])).toBeUndefined();
  });

  it("offers the most recently withdrawn ticket to resume rather than duplicate", () => {
    const older = ticket({
      id: "older",
      status: "withdrawn",
      updated_at: "2026-01-01T00:00:00Z",
    });
    const newer = ticket({
      id: "newer",
      status: "withdrawn",
      updated_at: "2026-02-01T00:00:00Z",
    });
    expect(resumableRemediationTicket("finding-1", [older, newer])?.id).toBe("newer");
  });

  it("offers nothing to resume when no ticket was withdrawn", () => {
    expect(resumableRemediationTicket("finding-1", [ticket({ status: "open" })])).toBeUndefined();
    expect(resumableRemediationTicket("finding-1", undefined)).toBeUndefined();
  });
});

describe("withdrawn tickets in the dashboard", () => {
  const withdrawnTicket = ticket({ status: "withdrawn" });

  it("counts a withdrawn ticket as withdrawn and nothing else", () => {
    const summary = summarizeApplication(APP, [finding()], [withdrawnTicket], [], []);
    expect(summary.withdrawnTickets).toBe(1);
    expect(summary.fixesSubmitted).toBe(0);
    expect(summary.awaitingReassessment).toBe(0);
    expect(summary.resolvedFindings).toBe(0);
  });

  it("drops the control progress of a withdrawn ticket from the active counts", () => {
    const controls = [control()];
    const steps = [step("tc-1", "rotate-example-key", "completed")];
    const active = summarizeApplication(APP, [finding()], [ticket()], controls, steps);
    const withdrawn = summarizeApplication(APP, [finding()], [withdrawnTicket], controls, steps);

    expect(active.controls).toEqual({ completed: 1, total: 1, ratio: 1 });
    expect(withdrawn.controls.total).toBe(0);
  });

  it("leaves the application needing action, because the finding is still at risk", () => {
    const summary = summarizeApplication(APP, [finding()], [withdrawnTicket], [], []);
    expect(summary.status).toBe("action_required");
    expect(summary.findingsRequiringAction).toBe(1);
  });
});

describe("the risk a developer lands on when they open an application", () => {
  const atRisk = finding({ id: "finding-1", test_id: "example-feature-01-risk-01" });
  const second = finding({ id: "finding-2", test_id: "example-feature-01-risk-02" });

  it("opens the first finding still needing action", () => {
    const resolved = finding({ id: "finding-0", test_id: "example-risk-00", status: "reduced_risk" });
    expect(preferredDeveloperRisk([resolved, atRisk], [])).toBe("example-feature-01-risk-01");
  });

  it("prefers an untouched finding over one already being remediated", () => {
    const started = ticket({ id: "ticket-1", finding_id: "finding-1", status: "in_progress" });
    expect(preferredDeveloperRisk([atRisk, second], [started])).toBe("example-feature-01-risk-02");
  });

  it("falls back to a remediation already under way when nothing else needs action", () => {
    const started = ticket({ id: "ticket-1", finding_id: "finding-1", status: "in_progress" });
    const resolved = finding({ id: "finding-2", test_id: "example-feature-01-risk-02", status: "reduced_risk" });
    expect(preferredDeveloperRisk([atRisk, resolved], [started])).toBe("example-feature-01-risk-01");
  });

  it("falls back to the first finding of any kind", () => {
    const resolved = finding({ id: "finding-1", test_id: "example-feature-01-risk-01", status: "reduced_risk" });
    expect(preferredDeveloperRisk([resolved], [])).toBe("example-feature-01-risk-01");
  });

  it("has nothing to open when no finding is linked to a security test", () => {
    expect(preferredDeveloperRisk([finding({ test_id: null })], [])).toBeNull();
    expect(preferredDeveloperRisk([], [])).toBeNull();
    expect(preferredDeveloperRisk(undefined, undefined)).toBeNull();
  });
});
