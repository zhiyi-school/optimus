import { describe, expect, it } from "vitest";
import type { ControlDetail } from "@/api/playbook-types";
import type {
  Finding,
  Profile,
  Ticket,
  TicketControl,
  TicketControlStep,
  TicketStatus,
} from "@/data/types";
import { defaultRouteFor, resolveAccess, roleCan } from "@/auth/permissions";
import {
  activeRemediationTicket,
  canRequestReassessment,
  canResumeTicket,
  canSubmitFix,
  canWithdrawTicket,
  resumableRemediationTicket,
  controlProgress,
  liveControls,
  reconciliationPlan,
  developerTicketLabel,
  summarizeApplication,
} from "./resolve";

const APP = "example-app-id";
const TEAM = "example-team-id";

const developer: Profile = {
  id: "developer-1",
  display_name: "Example Developer",
  email: "developer@example.test",
  roles: ["developer"],
  team_id: TEAM,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const securityEngineer: Profile = {
  ...developer,
  id: "security-1",
  display_name: "Example Security Engineer",
  email: "security@example.test",
  roles: ["security"],
};

const controlDefinition: ControlDetail = {
  control_id: "example-feature-01-risk-01-control-01",
  risk_id: "example-feature-01-risk-01",
  platform: "ios",
  title: "Control 1",
  status: "active",
  required: true,
  step_count: 2,
  playbook_revision: "sha256:example",
  has_source_archive: true,
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
};

const deprioritized: ControlDetail = {
  ...controlDefinition,
  control_id: "example-feature-01-risk-01-control-02",
  status: "deprioritized",
  required: false,
};

function world() {
  const finding: Finding = {
    id: "finding-1",
    external_id: null,
    application_id: APP,
    assessment_id: null,
    test_id: "example-feature-01-risk-01",
    latest_test_run_id: null,
    title: "Example finding",
    description: "Example description.",
    impact: "Example impact.",
    severity: "high",
    status: "at_risk",
    platform: "ios",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  const ticket: Ticket = {
    id: "ticket-1",
    finding_id: finding.id,
    application_id: APP,
    type: "remediation",
    status: "open",
    title: "Remediate: Example finding",
    description: null,
    created_by: developer.id,
    withdrawn_at: null,
    withdrawn_by: null,
    withdrawal_reason: null,
    assigned_user_id: null,
    assigned_team_id: TEAM,
    target_version: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    closed_at: null,
  };

  const controls: TicketControl[] = [];
  const steps: TicketControlStep[] = [];

  return {
    finding,
    ticket,
    controls,
    steps,
    /** Mirrors controlProgressData.reconcile: add what is missing, remove nothing. */
    reconcile(definitions: ControlDetail[]) {
      for (const plan of reconciliationPlan(definitions)) {
        let row = controls.find((existing) => existing.control_id === plan.control_id);
        if (!row) {
          row = {
            id: `tc-${controls.length + 1}`,
            ticket_id: ticket.id,
            control_id: plan.control_id,
            status: "not_started",
            required: plan.required,
            completed_at: null,
            completed_by: null,
            developer_note: null,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          };
          controls.push(row);
        }
        for (const stepKey of plan.step_keys) {
          if (steps.some((s) => s.ticket_control_id === row!.id && s.step_key === stepKey)) continue;
          steps.push({
            id: `${row.id}-${stepKey}`,
            ticket_control_id: row.id,
            step_key: stepKey,
            status: "not_started",
            completed_at: null,
            completed_by: null,
            developer_note: null,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          });
        }
      }
    },
    completeStep(stepKey: string) {
      const step = steps.find((candidate) => candidate.step_key === stepKey);
      if (step) step.status = "completed";
    },
    move(status: TicketStatus) {
      ticket.status = status;
    },
    live(definitions: ControlDetail[] = [controlDefinition, deprioritized]) {
      return liveControls(definitions, controls, steps);
    },
  };
}

describe("developer remediation, end to end", () => {
  it("walks a finding from sign-in to closure without letting the developer close it", () => {
    const state = world();

    expect(resolveAccess(developer)).toBe("ready");
    expect(defaultRouteFor(developer)).toBe("/resolve");

    let summary = summarizeApplication(APP, [state.finding], [state.ticket], [], []);
    expect(summary.status).toBe("action_required");
    expect(developerTicketLabel(state.ticket.status)?.label).toBe("Action required");

    state.reconcile([controlDefinition, deprioritized]);
    expect(state.controls.map((control) => control.control_id)).toEqual([
      "example-feature-01-risk-01-control-01",
    ]);
    expect(state.steps).toHaveLength(2);

    state.reconcile([controlDefinition, deprioritized]);
    expect(state.controls).toHaveLength(1);
    expect(state.steps).toHaveLength(2);

    expect(roleCan(developer.roles, "update_control_progress")).toBe(true);
    state.completeStep("rotate-example-key");
    expect(state.live()[0].status).toBe("in_progress");
    expect(controlProgress(state.live())).toMatchObject({ completed: 1, total: 2 });

    state.completeStep("revoke-example-key");
    expect(state.live()[0].status).toBe("completed");
    expect(state.finding.status).toBe("at_risk");
    expect(state.ticket.status).toBe("open");

    expect(canSubmitFix(state.ticket)).toBe(true);
    state.move("fix_submitted");
    expect(developerTicketLabel(state.ticket.status)?.label).toBe("Fix submitted");
    expect(canSubmitFix(state.ticket)).toBe(false);

    expect(canRequestReassessment(state.ticket)).toBe(true);
    state.move("retest_requested");
    expect(developerTicketLabel(state.ticket.status)?.label).toBe("Awaiting reassessment");
    summary = summarizeApplication(APP, [state.finding], [state.ticket], state.controls, state.steps);
    expect(summary.status).toBe("awaiting_security");
    expect(summary.awaitingReassessment).toBe(1);

    expect(roleCan(developer.roles, "run_test")).toBe(false);
    expect(roleCan(securityEngineer.roles, "run_test")).toBe(true);
    state.move("retest_in_progress");
    expect(developerTicketLabel(state.ticket.status)?.label).toBe(
      "Security verification in progress",
    );

    expect(roleCan(developer.roles, "update_finding")).toBe(false);
    expect(roleCan(securityEngineer.roles, "update_finding")).toBe(true);
    state.finding.status = "reduced_risk";

    expect(roleCan(developer.roles, "close_ticket")).toBe(false);
    expect(roleCan(securityEngineer.roles, "close_ticket")).toBe(true);
    state.move("closed");

    expect(developerTicketLabel(state.ticket.status)?.label).toBe("Resolved");
    summary = summarizeApplication(APP, [state.finding], [state.ticket], state.controls, state.steps);
    expect(summary.status).toBe("resolved");
    expect(summary.resolvedFindings).toBe(1);
    expect(summary.findings).toMatchObject({ completed: 1, total: 1, ratio: 1 });
  });

  it("sends the work back to the developer when security requests changes", () => {
    const state = world();
    state.reconcile([controlDefinition]);
    state.completeStep("rotate-example-key");
    state.completeStep("revoke-example-key");
    state.move("fix_submitted");

    expect(roleCan(securityEngineer.roles, "request_changes")).toBe(true);
    expect(roleCan(developer.roles, "request_changes")).toBe(false);
    state.move("rejected");

    expect(developerTicketLabel(state.ticket.status)?.label).toBe("Changes requested");
    expect(canSubmitFix(state.ticket)).toBe(true);
    const summary = summarizeApplication(
      APP,
      [state.finding],
      [state.ticket],
      state.controls,
      state.steps,
    );
    expect(summary.status).toBe("changes_requested");
    expect(state.finding.status).toBe("at_risk");
  });

  it("shows a developer with no team a setup state rather than every application", () => {
    const unassigned = { ...developer, team_id: null };
    expect(resolveAccess(unassigned)).toBe("no_team");
    expect(defaultRouteFor(unassigned)).toBe("/resolve");
  });

  it("keeps a security-only account out of the developer workspace", () => {
    expect(resolveAccess(securityEngineer)).toBe("unauthorized");
    expect(defaultRouteFor(securityEngineer)).toBe("/");
  });

  it("gives a user holding both roles the developer workspace and the security actions", () => {
    const both = { ...developer, roles: ["developer", "security"] as Profile["roles"] };
    expect(resolveAccess(both)).toBe("ready");
    expect(roleCan(both.roles, "update_control_progress")).toBe(true);
    expect(roleCan(both.roles, "close_ticket")).toBe(true);
    expect(defaultRouteFor(both)).toBe("/");
  });
});

describe("developer remediation from a control preview, end to end", () => {
  const previewable = [controlDefinition, deprioritized];

  it("walks a finding with no ticket through a read-only preview into tracked work", () => {
    const state = world();
    const tickets: Ticket[] = [];

    expect(resolveAccess(developer)).toBe("ready");
    expect(activeRemediationTicket(state.finding.id, tickets)).toBeUndefined();
    expect(resumableRemediationTicket(state.finding.id, tickets)).toBeUndefined();

    let summary = summarizeApplication(APP, [state.finding], tickets, state.controls, state.steps);
    expect(summary.status).toBe("action_required");
    expect(summary.requiredControls).toBe(0);

    expect(previewable).toHaveLength(2);
    expect(state.controls).toHaveLength(0);
    expect(state.steps).toHaveLength(0);

    tickets.push(state.ticket);
    state.reconcile(previewable);

    expect(activeRemediationTicket(state.finding.id, tickets)?.id).toBe(state.ticket.id);
    expect(state.controls.map((control) => control.control_id)).toEqual([
      "example-feature-01-risk-01-control-01",
    ]);
    expect(state.steps).toHaveLength(2);

    state.reconcile(previewable);
    expect(state.controls).toHaveLength(1);
    expect(state.steps).toHaveLength(2);

    state.completeStep("rotate-example-key");
    state.completeStep("revoke-example-key");
    expect(state.live()[0].status).toBe("completed");
    expect(state.finding.status).toBe("at_risk");

    state.move("fix_submitted");
    expect(canRequestReassessment(state.ticket)).toBe(true);
    state.move("retest_requested");

    summary = summarizeApplication(APP, [state.finding], tickets, state.controls, state.steps);
    expect(summary.status).toBe("awaiting_security");
    expect(summary.awaitingReassessment).toBe(1);
  });

  it("offers to continue rather than start again once a ticket is open", () => {
    const state = world();
    state.move("in_progress");
    const tickets = [state.ticket];

    expect(activeRemediationTicket(state.finding.id, tickets)?.id).toBe(state.ticket.id);
    expect(resumableRemediationTicket(state.finding.id, tickets)).toBeUndefined();
  });
});

describe("developer withdrawal, end to end", () => {
  function withdraw(ticket: Ticket, reason: string) {
    ticket.status = "withdrawn";
    ticket.withdrawn_at = "2026-03-01T00:00:00Z";
    ticket.withdrawn_by = developer.id;
    ticket.withdrawal_reason = reason;
    ticket.updated_at = "2026-03-01T00:00:00Z";
  }

  it("withdraws a remediation, leaves the finding unresolved, and resumes it later", () => {
    const state = world();
    const tickets = [state.ticket];
    state.reconcile([controlDefinition]);
    state.completeStep("rotate-example-key");
    state.move("in_progress");

    expect(roleCan(developer.roles, "withdraw_ticket")).toBe(true);
    expect(roleCan(securityEngineer.roles, "withdraw_ticket")).toBe(false);
    expect(canWithdrawTicket(state.ticket)).toBe(true);

    withdraw(state.ticket, "The affected feature is being removed in the next release.");

    expect(state.ticket.status).toBe("withdrawn");
    expect(state.ticket.closed_at).toBeNull();
    expect(state.finding.status).toBe("at_risk");
    expect(developerTicketLabel(state.ticket.status)?.label).toBe("Withdrawn by developer");

    expect(state.controls).toHaveLength(1);
    expect(state.steps.filter((step) => step.status === "completed")).toHaveLength(1);

    let summary = summarizeApplication(APP, [state.finding], tickets, state.controls, state.steps);
    expect(summary.withdrawnTickets).toBe(1);
    expect(summary.requiredControls).toBe(0);
    expect(summary.awaitingReassessment).toBe(0);
    expect(summary.resolvedFindings).toBe(0);
    expect(summary.status).toBe("action_required");

    expect(activeRemediationTicket(state.finding.id, tickets)).toBeUndefined();
    expect(resumableRemediationTicket(state.finding.id, tickets)?.id).toBe(state.ticket.id);

    expect(canWithdrawTicket(state.ticket)).toBe(false);
    expect(canResumeTicket(state.ticket)).toBe(true);
    state.move("in_progress");

    expect(state.ticket.withdrawal_reason).toBe(
      "The affected feature is being removed in the next release.",
    );
    expect(state.ticket.withdrawn_by).toBe(developer.id);
    expect(state.steps.filter((step) => step.status === "completed")).toHaveLength(1);

    summary = summarizeApplication(APP, [state.finding], tickets, state.controls, state.steps);
    expect(summary.withdrawnTickets).toBe(0);
    expect(summary.requiredControls).toBe(1);
    expect(summary.status).toBe("in_progress");

    expect(canSubmitFix(state.ticket)).toBe(true);
  });

  it("refuses withdrawal once the developer has asked for a reassessment", () => {
    const state = world();
    state.move("retest_requested");
    expect(canWithdrawTicket(state.ticket)).toBe(false);
    expect(canResumeTicket(state.ticket)).toBe(false);
  });

  it("keeps closure with security even on a withdrawn ticket", () => {
    const state = world();
    withdraw(state.ticket, "Not proceeding.");

    expect(roleCan(developer.roles, "close_ticket")).toBe(false);
    expect(roleCan(securityEngineer.roles, "close_ticket")).toBe(true);

    state.move("closed");
    expect(canResumeTicket(state.ticket)).toBe(false);
    expect(canWithdrawTicket(state.ticket)).toBe(false);
  });
});

describe("a playbook that changes while a ticket is open", () => {
  const ROTATE = "rotate-example-key";
  const REVOKE = "revoke-example-key";

  function started() {
    const state = world();
    state.reconcile([controlDefinition, deprioritized]);
    state.completeStep(ROTATE);
    return state;
  }

  it("shows rewritten wording against the progress already recorded", () => {
    const state = started();
    const reworded: ControlDetail = {
      ...controlDefinition,
      steps: [
        { ...controlDefinition.steps[0], text: "Rotate the key using the new console." },
        controlDefinition.steps[1],
      ],
    };

    const live = state.live([reworded]);
    expect(live[0].steps[0].step.text).toBe("Rotate the key using the new console.");
    expect(live[0].steps[0].row?.status).toBe("completed");
    expect(controlProgress(live)).toMatchObject({ completed: 1, total: 2 });
  });

  it("shows a renamed control by its new title without touching progress", () => {
    const state = started();
    const renamed: ControlDetail = { ...controlDefinition, title: "Key rotation and revocation" };

    expect(state.live([renamed])[0].definition.title).toBe("Key rotation and revocation");
    expect(state.live([renamed])[0].progress).toMatchObject({ completed: 1, total: 2 });
  });

  it("shows an added step as not started and counts it against completion", () => {
    const state = started();
    const extended: ControlDetail = {
      ...controlDefinition,
      steps: [
        ...controlDefinition.steps,
        {
          step_key: "audit-example-key",
          step_id_source: "declared",
          content_hash: "sha256:three",
          step_index: 2,
          number: 3,
          step_title: "Third",
          text: "Third",
          content: [],
        },
      ],
    };

    const live = state.live([extended]);
    expect(live[0].steps).toHaveLength(3);
    expect(live[0].steps[2].row).toBeUndefined();
    expect(controlProgress(live)).toMatchObject({ completed: 1, total: 3 });

    state.reconcile([extended]);
    expect(state.live([extended])[0].steps[2].row?.status).toBe("not_started");
  });

  it("drops a removed step from view and from completion, keeping its row", () => {
    const state = started();
    state.completeStep(REVOKE);
    const trimmed: ControlDetail = { ...controlDefinition, steps: [controlDefinition.steps[0]] };

    const live = state.live([trimmed]);
    expect(live[0].steps.map((entry) => entry.step.step_key)).toEqual([ROTATE]);
    expect(controlProgress(live)).toMatchObject({ completed: 1, total: 1 });
    expect(state.steps.some((step) => step.step_key === REVOKE)).toBe(true);
  });

  it("keeps progress attached when the steps are reordered", () => {
    const state = started();
    const reordered: ControlDetail = {
      ...controlDefinition,
      steps: [controlDefinition.steps[1], controlDefinition.steps[0]],
    };

    const live = state.live([reordered]);
    expect(live[0].steps.map((entry) => entry.step.step_key)).toEqual([REVOKE, ROTATE]);
    expect(live[0].steps[0].row?.status).toBe("not_started");
    expect(live[0].steps[1].row?.status).toBe("completed");
  });

  it("shows an added control as outstanding work on the open ticket", () => {
    const state = started();
    const added: ControlDetail = {
      ...controlDefinition,
      control_id: "example-feature-01-risk-01-control-03",
      title: "Control 3",
    };

    state.reconcile([controlDefinition, added]);
    const live = state.live([controlDefinition, added]);
    expect(live).toHaveLength(2);
    expect(live[1].status).toBe("not_started");
    expect(controlProgress(live)).toMatchObject({ completed: 1, total: 4 });
  });

  it("reconciling twice never duplicates a control or step row", () => {
    const state = started();
    state.reconcile([controlDefinition, deprioritized]);
    state.reconcile([controlDefinition, deprioritized]);

    expect(state.controls).toHaveLength(1);
    expect(state.steps).toHaveLength(2);
    expect(state.live()[0].steps[0].row?.status).toBe("completed");
  });

  it("leaves the developer's other workflow state alone throughout", () => {
    const state = started();
    state.move("fix_submitted");
    state.reconcile([controlDefinition, deprioritized]);

    expect(state.ticket.status).toBe("fix_submitted");
    expect(state.finding.status).toBe("at_risk");
    expect(canRequestReassessment(state.ticket)).toBe(true);
  });
});
