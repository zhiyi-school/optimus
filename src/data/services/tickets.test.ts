import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ticket, TicketStatus } from "@/data/types";

const DEVELOPER = "00000000-0000-0000-0000-000000000001";
const SECURITY = "00000000-0000-0000-0000-000000000002";

const STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "fix_submitted",
  "retest_requested",
  "retest_in_progress",
  "under_review",
  "accepted",
  "rejected",
  "withdrawn",
  "closed",
];

const DEVELOPER_STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "fix_submitted",
  "retest_requested",
  "withdrawn",
];

const WITHDRAWABLE_FROM: TicketStatus[] = ["open", "in_progress", "fix_submitted", "rejected"];

let actor = DEVELOPER;
let actorIsSecurity = false;
let ticketRow: Ticket;
let activity: Record<string, unknown>[] = [];
let ticketWrites = 0;

function baseTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "example-ticket-id",
    finding_id: "example-finding-id",
    application_id: "example-app-id",
    type: "remediation",
    status: "in_progress",
    title: "Remediate: Example finding",
    description: null,
    created_by: DEVELOPER,
    assigned_user_id: null,
    assigned_team_id: "example-team-id",
    target_version: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    closed_at: null,
    withdrawn_at: null,
    withdrawn_by: null,
    withdrawal_reason: null,
    ...overrides,
  };
}

// Mirrors 0018_ticket_withdrawal.sql so a client bug that sends a forbidden
// update fails here rather than only against a live database.
function applyTicketRules(old: Ticket, next: Ticket): Ticket {
  if (!STATUSES.includes(next.status)) {
    throw new Error(`tickets_status_check violated by ${next.status}`);
  }
  if (actorIsSecurity) return next;

  if (old.status === "closed" || old.status === "accepted") {
    throw new Error("only the security team can reopen a ticket it has finalised");
  }
  if (next.status !== old.status && !DEVELOPER_STATUSES.includes(next.status)) {
    throw new Error(`only the security team can move a ticket to ${next.status}`);
  }
  if (old.status === "withdrawn" && next.status !== old.status && next.status !== "in_progress") {
    throw new Error("a withdrawn remediation ticket resumes as in_progress");
  }

  const withdrawing = next.status === "withdrawn" && old.status !== "withdrawn";
  if (withdrawing) {
    if (next.type !== "remediation") throw new Error("only a remediation ticket can be withdrawn");
    if (!WITHDRAWABLE_FROM.includes(old.status)) {
      throw new Error(
        "a remediation ticket cannot be withdrawn once security verification has started",
      );
    }
    if (!next.withdrawal_reason?.trim()) {
      throw new Error("withdrawing a remediation ticket needs a reason");
    }
    if (next.withdrawn_by !== actor) {
      throw new Error("the developer withdrawing the ticket must be recorded as withdrawn_by");
    }
    if (!next.withdrawn_at) {
      throw new Error("withdrawing a remediation ticket must record withdrawn_at");
    }
  } else if (
    next.withdrawn_at !== old.withdrawn_at ||
    next.withdrawn_by !== old.withdrawn_by ||
    next.withdrawal_reason !== old.withdrawal_reason
  ) {
    throw new Error("withdrawal details are recorded once, when the ticket is withdrawn");
  }

  if (next.closed_at !== old.closed_at) {
    throw new Error("only the security team can close or reopen a ticket");
  }
  return next;
}

function table(name: string) {
  if (name === "activity_log") {
    return {
      insert(payload: Record<string, unknown>) {
        activity.push(payload);
        return Promise.resolve({ error: null });
      },
    };
  }
  if (name !== "tickets") throw new Error(`unexpected table ${name}`);

  let pending: Partial<Ticket> = {};
  const chain = {
    update(payload: Partial<Ticket>) {
      pending = payload;
      return chain;
    },
    eq() {
      return chain;
    },
    select() {
      return chain;
    },
    single() {
      ticketWrites += 1;
      try {
        ticketRow = applyTicketRules(ticketRow, { ...ticketRow, ...pending });
        return Promise.resolve({ data: ticketRow, error: null });
      } catch (err) {
        return Promise.resolve({ data: null, error: { message: (err as Error).message } });
      }
    },
  };
  return chain;
}

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "attachments",
  supabase: {
    from: (name: string) => table(name),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: actor } }, error: null }) },
  },
}));

const { ticketData } = await import("./tickets");

beforeEach(() => {
  actor = DEVELOPER;
  actorIsSecurity = false;
  ticketRow = baseTicket();
  activity = [];
  ticketWrites = 0;
});

describe("ticketData.withdraw", () => {
  it("records the reason, the actor and the time", async () => {
    const before = Date.now();
    const ticket = await ticketData.withdraw("example-ticket-id", "Feature is being removed.");

    expect(ticket.status).toBe("withdrawn");
    expect(ticket.withdrawal_reason).toBe("Feature is being removed.");
    expect(ticket.withdrawn_by).toBe(DEVELOPER);
    expect(new Date(ticket.withdrawn_at as string).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("leaves closed_at alone, so the ticket is never mistaken for verified", async () => {
    const ticket = await ticketData.withdraw("example-ticket-id", "Not proceeding.");
    expect(ticket.closed_at).toBeNull();
  });

  it("writes an activity entry naming the withdrawal", async () => {
    await ticketData.withdraw("example-ticket-id", "Not proceeding.");
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      entity_type: "ticket",
      entity_id: "example-ticket-id",
      action: "remediation_withdrawn",
      actor_id: DEVELOPER,
    });
  });

  it("refuses an empty reason before it reaches the database", async () => {
    await expect(ticketData.withdraw("example-ticket-id", "   ")).rejects.toThrow(/reason/i);
    expect(ticketWrites).toBe(0);
    expect(ticketRow.status).toBe("in_progress");
    expect(activity).toHaveLength(0);
  });

  it("trims the reason it stores", async () => {
    const ticket = await ticketData.withdraw("example-ticket-id", "  Deferred to next release.  ");
    expect(ticket.withdrawal_reason).toBe("Deferred to next release.");
  });

  it("is refused once security verification has started", async () => {
    for (const status of ["retest_requested", "retest_in_progress", "under_review"] as const) {
      ticketRow = baseTicket({ status });
      await expect(ticketData.withdraw("example-ticket-id", "Changed my mind.")).rejects.toThrow(
        /security verification has started/,
      );
    }
  });

  it("is refused on a ticket security has closed", async () => {
    ticketRow = baseTicket({ status: "closed", closed_at: "2026-02-01T00:00:00Z" });
    await expect(ticketData.withdraw("example-ticket-id", "Too late.")).rejects.toThrow(
      /finalised/,
    );
  });

  it("preserves the finding, application and creator the ticket belongs to", async () => {
    const ticket = await ticketData.withdraw("example-ticket-id", "Not proceeding.");
    expect(ticket.finding_id).toBe("example-finding-id");
    expect(ticket.application_id).toBe("example-app-id");
    expect(ticket.created_by).toBe(DEVELOPER);
  });
});

describe("ticketData.resume", () => {
  beforeEach(() => {
    ticketRow = baseTicket({
      status: "withdrawn",
      withdrawn_at: "2026-01-05T00:00:00Z",
      withdrawn_by: DEVELOPER,
      withdrawal_reason: "Deferred.",
    });
  });

  it("puts the ticket back in progress", async () => {
    const ticket = await ticketData.resume("example-ticket-id");
    expect(ticket.status).toBe("in_progress");
  });

  it("keeps the withdrawal on the record as history", async () => {
    const ticket = await ticketData.resume("example-ticket-id");
    expect(ticket.withdrawal_reason).toBe("Deferred.");
    expect(ticket.withdrawn_by).toBe(DEVELOPER);
    expect(ticket.withdrawn_at).toBe("2026-01-05T00:00:00Z");
  });

  it("writes an activity entry", async () => {
    await ticketData.resume("example-ticket-id");
    expect(activity[0]).toMatchObject({ action: "remediation_resumed" });
  });

  it("cannot bring back a ticket security has closed", async () => {
    ticketRow = baseTicket({ status: "closed", closed_at: "2026-02-01T00:00:00Z" });
    await expect(ticketData.resume("example-ticket-id")).rejects.toThrow(/finalised/);
  });
});

describe("ticketData.updateStatus", () => {
  it("refuses to be used as a back door into withdrawal", async () => {
    await expect(ticketData.updateStatus("example-ticket-id", "withdrawn")).rejects.toThrow(
      /ticketData.withdraw/,
    );
    expect(ticketRow.status).toBe("in_progress");
  });

  it("is refused when a developer aims it at closed", async () => {
    await expect(ticketData.updateStatus("example-ticket-id", "closed")).rejects.toThrow(
      /only the security team/,
    );
    expect(ticketRow.status).toBe("in_progress");
  });

  it("still lets security close a ticket", async () => {
    actor = SECURITY;
    actorIsSecurity = true;
    const ticket = await ticketData.updateStatus("example-ticket-id", "closed");
    expect(ticket.status).toBe("closed");
    expect(ticket.closed_at).not.toBeNull();
  });

  it("still lets security close a withdrawn ticket", async () => {
    ticketRow = baseTicket({
      status: "withdrawn",
      withdrawn_at: "2026-01-05T00:00:00Z",
      withdrawn_by: DEVELOPER,
      withdrawal_reason: "Deferred.",
    });
    actor = SECURITY;
    actorIsSecurity = true;
    const ticket = await ticketData.updateStatus("example-ticket-id", "closed");
    expect(ticket.status).toBe("closed");
  });

  it("still carries the developer's own transitions", async () => {
    const ticket = await ticketData.updateStatus("example-ticket-id", "retest_requested");
    expect(ticket.status).toBe("retest_requested");
  });
});
