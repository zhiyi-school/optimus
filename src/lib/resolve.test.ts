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
  reconciliationPlan,
  developerTicketLabel,
  developerTicketLabels,
  findingProgress,
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
    withdrawn_at: null,
    withdrawn_by: null,
    withdrawal_reason: null,
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
    required: true,
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

  it("leaves a deprioritised or deprecated control out of current work", () => {
    expect(liveControls([definition({ status: "deprioritized", required: false })], [], [])).toEqual([]);
    expect(liveControls([definition({ status: "deprecated", required: true })], [], [])).toEqual([]);
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

  it("counts required controls by their derived step state", () => {
    const controls = [control(), control({ id: "tc-2", control_id: "c2" })];
    const steps = [
      step("tc-1", "rotate-example-key", "completed"),
      step("tc-2", "rotate-example-key", "completed"),
      step("tc-2", "revoke-example-key", "not_started"),
    ];
    const summary = summarizeApplication(APP, [finding()], [ticket()], controls, steps);
    expect(summary.requiredControls).toBe(2);
    expect(summary.controlsCompleted).toBe(1);
    expect(summary.controlsInProgress).toBe(1);
  });

  it("only counts controls belonging to this application's tickets", () => {
    const controls = [control({ id: "tc-9", ticket_id: "other-ticket" })];
    const summary = summarizeApplication(APP, [finding()], [ticket()], controls, []);
    expect(summary.requiredControls).toBe(0);
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
    expect(summary.requiredControls).toBe(1);
    expect(summary.controls).toEqual({ completed: 1, total: 1, ratio: 1 });
  });

  it("ignores progress rows for a step the playbook has dropped", () => {
    const steps = [
      step("tc-1", "rotate-example-key", "completed"),
      step("tc-1", "removed-example-step", "completed"),
    ];

    const summary = summarizeApplication(APP, [finding()], [ticket()], [control()], steps, liveKeys);
    expect(summary.controls).toEqual({ completed: 1, total: 1, ratio: 1 });
    expect(summary.controlsCompleted).toBe(1);
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
    expect(summary.controlsCompleted).toBe(0);
    expect(summary.controls).toEqual({ completed: 0, total: 0, ratio: 0 });
  });
});

describe("reconciliationPlan", () => {
  it("plans a row for every step of an active required control, and no playbook content", () => {
    expect(reconciliationPlan([definition()])).toEqual([
      {
        control_id: "example-feature-01-risk-01-control-01",
        required: true,
        step_keys: ["rotate-example-key", "revoke-example-key"],
      },
    ]);
  });

  it("carries no title, ordering, revision or step text into the database", () => {
    const [plan] = reconciliationPlan([definition()]);
    expect(Object.keys(plan).sort()).toEqual(["control_id", "required", "step_keys"]);
  });

  it("never plans a deprioritized or deprecated control as required work", () => {
    expect(reconciliationPlan([definition({ status: "deprioritized", required: false })])).toEqual([]);
    expect(reconciliationPlan([definition({ status: "deprecated", required: false })])).toEqual([]);
  });

  it("still refuses a deprecated control that the catalogue left marked required", () => {
    expect(reconciliationPlan([definition({ status: "deprecated", required: true })])).toEqual([]);
    expect(reconciliationPlan([definition({ status: "deprioritized", required: true })])).toEqual([]);
  });

  it("never plans an active control the catalogue marked optional", () => {
    expect(reconciliationPlan([definition({ required: false })])).toEqual([]);
  });

  it("plans nothing when the risk has no controls", () => {
    expect(reconciliationPlan([])).toEqual([]);
  });
});

describe("isReconciled", () => {
  const plan = reconciliationPlan([definition()]);

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

    expect(active.requiredControls).toBe(1);
    expect(active.controlsCompleted).toBe(1);
    expect(withdrawn.requiredControls).toBe(0);
    expect(withdrawn.controlsCompleted).toBe(0);
    expect(withdrawn.controls.total).toBe(0);
  });

  it("leaves the application needing action, because the finding is still at risk", () => {
    const summary = summarizeApplication(APP, [finding()], [withdrawnTicket], [], []);
    expect(summary.status).toBe("action_required");
    expect(summary.findingsRequiringAction).toBe(1);
  });
});
