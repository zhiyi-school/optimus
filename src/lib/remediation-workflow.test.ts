import { describe, expect, it } from "vitest";
import { remediationWorkflow } from "./remediation-workflow";
import type { ControlDetail } from "@/api/playbook-types";
import type { Ticket, TicketControl, TicketControlStep } from "@/data/types";

const CONTROL = "example-control";

function definition(stepKeys = ["one"]): ControlDetail {
  return {
    control_id: CONTROL,
    title: "Example approach",
    summary: "Example approach",
    status: "active",
    required: true,
    intro: [],
    references: [],
    steps: stepKeys.map((step_key, index) => ({
      step_key,
      step_index: index,
      number: index + 1,
      content_hash: `sha256:${step_key}`,
      content: [],
    })),
  } as unknown as ControlDetail;
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "ticket-1",
    type: "remediation",
    status: "in_progress",
    selected_control_id: CONTROL,
    ...overrides,
  } as Ticket;
}

function calculate(input: Partial<Parameters<typeof remediationWorkflow>[0]> = {}) {
  const controls = [{ id: "row-1", ticket_id: "ticket-1", control_id: CONTROL }] as TicketControl[];
  const steps = [{ ticket_control_id: "row-1", step_key: "one", status: "completed" }] as TicketControlStep[];
  return remediationWorkflow({
    ticket: ticket(),
    definitions: [definition()],
    definitionsState: "ready",
    controls,
    steps,
    controlsLoading: false,
    stepsLoading: false,
    retests: [],
    mayEdit: true,
    mayRequest: true,
    ...input,
  });
}

describe("remediation workflow calculation", () => {
  it("uses the stored approach when it is still offered", () => {
    const state = calculate();
    expect(state.selectedControlId).toBe(CONTROL);
    expect(state.replaced).toBe(false);
    expect(state.complete).toBe(true);
    expect(state.reassessmentBlock).toBeNull();
  });

  it("selects the replacement but does not count removed progress as complete", () => {
    const replacement = { ...definition(), control_id: "replacement" };
    const state = calculate({ definitions: [replacement] });
    expect(state.selectedControlId).toBe("replacement");
    expect(state.replaced).toBe(true);
    expect(state.complete).toBe(false);
  });

  it("does not treat an unavailable playbook as zero work or complete", () => {
    const loading = calculate({ definitions: undefined, definitionsState: "loading" });
    const failed = calculate({ definitions: undefined, definitionsState: "error" });
    expect(loading.complete).toBe(false);
    expect(failed.complete).toBe(false);
  });

  it("still reports a newly added step as unreconciled progress, without blocking the request", () => {
    const state = calculate({ definitions: [definition(["one", "two"])] });
    expect(state.complete).toBe(false);
    expect(state.reconciled).toBe(false);
    expect(state.reassessmentBlock).toBeNull();
  });

  it("keeps historical fix_submitted tickets eligible", () => {
    const state = calculate({ ticket: ticket({ status: "fix_submitted" }) });
    expect(state.approachChangeBlock).toBeNull();
    expect(state.reassessmentBlock).toBeNull();
  });

  it("blocks a reassessment on permission alone, whatever the remediation says", () => {
    expect(calculate({ mayRequest: false }).reassessmentBlock?.code).toBe("reassessment_permission");
    for (const state of [
      calculate({ ticket: null }),
      calculate({ ticket: ticket({ status: "withdrawn" }) }),
      calculate({ ticket: ticket({ type: "risk_acceptance" }) }),
      calculate({ definitions: [], definitionsState: "error" }),
    ]) {
      expect(state.reassessmentBlock).toBeNull();
    }
  });
});
