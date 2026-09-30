import { describe, expect, it } from "vitest";
import type { RetestRun, TicketStatus } from "@/database/types";
import { canWithdrawReassessment } from "@/domain/remediation/reassessments";
import { ticket } from "@/test-support/resolve-fixtures";

const DEVELOPER = "00000000-0000-0000-0000-000000000001";
const OTHER_DEVELOPER = "00000000-0000-0000-0000-000000000002";

function retest(overrides: Partial<RetestRun> = {}): RetestRun {
  return {
    id: "retest-1",
    conversation_id: "conversation-1",
    ticket_id: "ticket-1",
    finding_id: "finding-1",
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
    previous_ticket_status: "in_progress",
    ...overrides,
  } as RetestRun;
}

describe("canWithdrawReassessment", () => {
  const awaiting = ticket({ id: "ticket-1", status: "retest_requested" });

  it("lets the requester take back a queued request on their own remediation", () => {
    expect(canWithdrawReassessment(retest(), awaiting, DEVELOPER)).toBe(true);
  });

  it("allows it just as well when the request came from a rejected fix", () => {
    expect(
      canWithdrawReassessment(retest({ previous_ticket_status: "rejected" }), awaiting, DEVELOPER),
    ).toBe(true);
  });

  it("refuses a request that security has already started", () => {
    expect(canWithdrawReassessment(retest({ status: "running" }), awaiting, DEVELOPER)).toBe(false);
  });

  it("refuses a completed or failed request", () => {
    for (const status of ["completed", "failed"] as const) {
      expect(canWithdrawReassessment(retest({ status }), awaiting, DEVELOPER), status).toBe(false);
    }
  });

  it("refuses one that is already cancelled", () => {
    expect(canWithdrawReassessment(retest({ status: "cancelled" }), awaiting, DEVELOPER)).toBe(
      false,
    );
  });

  it("refuses anyone but the developer who asked for it", () => {
    expect(canWithdrawReassessment(retest(), awaiting, OTHER_DEVELOPER)).toBe(false);
    expect(canWithdrawReassessment(retest(), awaiting, undefined)).toBe(false);
  });

  it("refuses a security-created request that has no remediation to restore", () => {
    expect(canWithdrawReassessment(retest({ ticket_id: null }), null, DEVELOPER)).toBe(false);
  });

  it("refuses when the request belongs to a different remediation", () => {
    expect(
      canWithdrawReassessment(retest({ ticket_id: "ticket-9" }), awaiting, DEVELOPER),
    ).toBe(false);
  });

  it("refuses once the remediation has moved past waiting for the reassessment", () => {
    for (const status of ["retest_in_progress", "closed", "withdrawn"] as TicketStatus[]) {
      expect(
        canWithdrawReassessment(retest(), ticket({ id: "ticket-1", status }), DEVELOPER),
        status,
      ).toBe(false);
    }
  });

  it("refuses on a ticket that is not a remediation", () => {
    expect(
      canWithdrawReassessment(
        retest(),
        ticket({ id: "ticket-1", status: "retest_requested", type: "risk_acceptance" }),
        DEVELOPER,
      ),
    ).toBe(false);
  });
});
