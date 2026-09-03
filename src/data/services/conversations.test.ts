import { beforeEach, describe, expect, it, vi } from "vitest";

const CONVERSATION = "example-conversation-id";
const APPLICATION = "example-app-id";
const ASSESSMENT = "example-assessment-id";
const RISK = "example-feature-01-risk-01";
const FINDING = "example-finding-id";
const TICKET = "example-ticket-id";
const SECURITY = "00000000-0000-0000-0000-000000000002";

interface Write {
  table: string;
  op: "insert" | "upsert" | "update";
  payload: Record<string, unknown>;
}

let writes: Write[] = [];
let rows: Record<string, Record<string, unknown>[]> = {};
let uploads: string[] = [];
let rpcCalls: { name: string; params: Record<string, unknown> }[] = [];
let rpcError: unknown = null;
let raceOn: string | null = null;

// An update returns the whole row, not just the columns it changed, so a
// service reading a field it did not write behaves the same here as in Postgres.
function table(name: string) {
  let payload: Record<string, unknown> = {};
  let op: Write["op"] = "insert";
  const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  const match = () => (rows[name] ?? []).find((row) => filters.every((keep) => keep(row)));
  const all = () => (rows[name] ?? []).filter((row) => filters.every((keep) => keep(row)));
  const record = (next: Record<string, unknown>, kind: Write["op"]) => {
    payload = next;
    op = kind;
    writes.push({ table: name, op: kind, payload: next });
    return chain;
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    in(column: string, values: unknown[]) {
      filters.push((row) => values.includes(row[column]));
      return chain;
    },
    // A query with no row-level terminal resolves to the matching rows, the way
    // awaiting a PostgREST builder does.
    then(resolve: (value: { data: unknown; error: null }) => unknown) {
      return Promise.resolve({ data: all(), error: null }).then(resolve);
    },
    eq(column: string, value: unknown) {
      filters.push((row) => row[column] === value);
      return chain;
    },
    insert: (next: Record<string, unknown>) => record(next, "insert"),
    upsert: (next: Record<string, unknown>) => record(next, "upsert"),
    update: (next: Record<string, unknown>) => record(next, "update"),
    maybeSingle: () => {
      const found = match();
      return Promise.resolve({ data: found ? { ...found } : null, error: null });
    },
    single: () => {
      // A concurrent writer wins the unique key: the row lands, the insert errors.
      if (op === "insert" && name === raceOn) {
        raceOn = null;
        rows[name] = [...(rows[name] ?? []), { id: `${name}-race`, ...payload }];
        return Promise.resolve({
          data: null,
          error: { message: "duplicate key value violates unique constraint" },
        });
      }
      if (op === "update") {
        const existing = match();
        if (existing) {
          Object.assign(existing, payload);
          return Promise.resolve({ data: { ...existing }, error: null });
        }
      }
      const stored = { id: `${name}-1`, ...payload };
      rows[name] = [...(rows[name] ?? []), stored];
      return Promise.resolve({ data: { ...stored }, error: null });
    },
  };
  return chain;
}

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: {
    from: (name: string) => table(name),
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return Promise.resolve(
        rpcError
          ? { data: null, error: rpcError }
          : { data: { id: params.p_finding_id, status: params.p_status }, error: null },
      );
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: SECURITY } }, error: null }) },
    storage: {
      from: () => ({
        upload: (path: string) => {
          uploads.push(path);
          return Promise.resolve({ error: null });
        },
      }),
    },
  },
}));

const { riskConversationData } = await import("./assessments");
const { findingData } = await import("./findings");
const { retestData, ticketData } = await import("./tickets");

function written(name: string) {
  return writes.filter((write) => write.table === name);
}

beforeEach(() => {
  writes = [];
  uploads = [];
  rpcCalls = [];
  rpcError = null;
  raceOn = null;
  rows = {
    risk_conversations: [],
    findings: [{ id: FINDING, status: "at_risk" }],
    tickets: [{ id: TICKET, status: "fix_submitted", risk_conversation_id: CONVERSATION }],
    retest_runs: [],
  };
});

describe("one conversation per application risk", () => {
  it("creates it on first open and returns the same one after that", async () => {
    const first = await riskConversationData.getOrCreate({
      applicationId: APPLICATION,
      riskId: RISK,
      findingId: FINDING,
      originAssessmentId: ASSESSMENT,
    });
    writes = [];
    const second = await riskConversationData.getOrCreate({
      applicationId: APPLICATION,
      riskId: RISK,
      findingId: FINDING,
      originAssessmentId: ASSESSMENT,
    });

    expect(second.id).toBe(first.id);
    expect(writes).toHaveLength(0);
  });

  it("keys the create on the application and risk, so a race cannot make two", async () => {
    await riskConversationData.getOrCreate({
      applicationId: APPLICATION,
      riskId: RISK,
      findingId: FINDING,
      originAssessmentId: ASSESSMENT,
    });

    expect(written("risk_conversations")[0]).toMatchObject({
      op: "upsert",
      payload: {
        application_id: APPLICATION,
        risk_id: RISK,
        finding_id: FINDING,
        origin_assessment_id: ASSESSMENT,
      },
    });
  });

  it("returns the one conversation however many assessments the application has had", async () => {
    const first = await riskConversationData.getOrCreate({
      applicationId: APPLICATION,
      riskId: RISK,
      originAssessmentId: "example-first-assessment-id",
    });
    const fromLaterRun = await riskConversationData.getOrCreate({
      applicationId: APPLICATION,
      riskId: RISK,
      originAssessmentId: "example-second-assessment-id",
    });

    expect(fromLaterRun.id).toBe(first.id);
    expect(rows.risk_conversations).toHaveLength(1);
    expect(fromLaterRun.origin_assessment_id).toBe("example-first-assessment-id");
  });

  it("keeps a different risk on the same application apart", async () => {
    rows.risk_conversations = [
      { id: CONVERSATION, application_id: APPLICATION, risk_id: RISK, finding_id: FINDING },
    ];

    const other = await riskConversationData.getOrCreate({
      applicationId: APPLICATION,
      riskId: "example-feature-02-risk-01",
    });

    expect(other.id).not.toBe(CONVERSATION);
  });

  it("links a finding that only appeared later", async () => {
    rows.risk_conversations = [
      { id: CONVERSATION, application_id: APPLICATION, risk_id: RISK, finding_id: null },
    ];

    const conversation = await riskConversationData.getOrCreate({
      applicationId: APPLICATION,
      riskId: RISK,
      findingId: FINDING,
    });

    expect(conversation.finding_id).toBe(FINDING);
    expect(written("risk_conversations")[0].op).toBe("update");
  });

  it("fills in an assessment for a conversation opened without one", async () => {
    rows.risk_conversations = [
      {
        id: CONVERSATION,
        application_id: APPLICATION,
        risk_id: RISK,
        finding_id: FINDING,
        origin_assessment_id: null,
      },
    ];

    const conversation = await riskConversationData.getOrCreate({
      applicationId: APPLICATION,
      riskId: RISK,
      findingId: FINDING,
      originAssessmentId: ASSESSMENT,
    });

    expect(conversation.origin_assessment_id).toBe(ASSESSMENT);
  });

  it("exists before any finding does", async () => {
    const conversation = await riskConversationData.getOrCreate({
      applicationId: APPLICATION,
      riskId: RISK,
    });
    expect(conversation.finding_id).toBeNull();
  });
});

describe("entries", () => {
  it("records the author, so nobody can post as somebody else", async () => {
    await riskConversationData.addEntry({
      conversation_id: CONVERSATION,
      kind: "message",
      message: "Example question.",
    });

    expect(written("risk_conversation_entries")[0].payload).toMatchObject({
      conversation_id: CONVERSATION,
      kind: "message",
      author_id: SECURITY,
      message: "Example question.",
    });
  });

  it("posts a keyed workflow event only once, however often it is retried", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await riskConversationData.addEntryOnce({
        conversation_id: CONVERSATION,
        kind: "retest_requested",
        sync_key: "retest-requested::retest-1",
      });
    }

    expect(written("risk_conversation_entries")).toHaveLength(1);
    expect(rows.risk_conversation_entries).toHaveLength(1);
  });

  it("returns the entry a concurrent writer won with, rather than reporting a failure", async () => {
    raceOn = "risk_conversation_entries";

    const entry = await riskConversationData.addEntryOnce({
      conversation_id: CONVERSATION,
      kind: "retest_requested",
      sync_key: "retest-requested::retest-1",
    });

    expect(entry.kind).toBe("retest_requested");
    expect(rows.risk_conversation_entries).toHaveLength(1);
  });

  it("puts an attachment under its own conversation, linked to its entry", async () => {
    const entry = await riskConversationData.addEntry({
      conversation_id: CONVERSATION,
      kind: "message",
      message: "With a screenshot.",
    });
    await riskConversationData.uploadAttachment(
      CONVERSATION,
      entry.id,
      new File(["x"], "example-evidence.png", { type: "image/png" }),
    );

    expect(uploads[0]).toContain(`conversation-${CONVERSATION}/`);
    expect(written("risk_conversation_attachments")[0].payload).toMatchObject({
      entry_id: entry.id,
      file_name: "example-evidence.png",
      uploaded_by: SECURITY,
    });
  });
});

describe("classification", () => {
  it("is one server-side call, so the finding cannot change without its record", async () => {
    await findingData.classify({
      findingId: FINDING,
      conversationId: CONVERSATION,
      status: "reduced_risk",
      reason: "Verified on the current build.",
    });

    expect(rpcCalls).toEqual([
      {
        name: "classify_risk",
        params: {
          p_finding_id: FINDING,
          p_conversation_id: CONVERSATION,
          p_status: "reduced_risk",
          p_reason: "Verified on the current build.",
        },
      },
    ]);
    // Nothing is written from the browser: the function owns all three writes.
    expect(writes).toHaveLength(0);
  });

  it("refuses to change the classification without a reason", async () => {
    await expect(
      findingData.classify({
        findingId: FINDING,
        conversationId: CONVERSATION,
        status: "reduced_risk",
        reason: "   ",
      }),
    ).rejects.toThrow(/reason/i);
    expect(rpcCalls).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it("surfaces a refusal from the database rather than reporting success", async () => {
    rpcError = { message: "that finding belongs to a different application risk" };

    await expect(
      findingData.classify({
        findingId: FINDING,
        conversationId: CONVERSATION,
        status: "reduced_risk",
        reason: "Verified.",
      }),
    ).rejects.toMatchObject({ message: /different application risk/ });
  });
});

describe("the retest lifecycle", () => {
  it("records the request, links it to the conversation and moves the ticket", async () => {
    await retestData.requestRetest({
      conversationId: CONVERSATION,
      findingId: FINDING,
      ticketId: TICKET,
    });

    expect(written("retest_runs")[0].payload).toMatchObject({
      conversation_id: CONVERSATION,
      ticket_id: TICKET,
      finding_id: FINDING,
      status: "queued",
    });
    expect(written("risk_conversation_entries")[0].payload).toMatchObject({
      kind: "retest_requested",
      source_ticket_id: TICKET,
    });
    expect(written("tickets")[0].payload).toMatchObject({ status: "retest_requested" });
  });

  it("leaves tickets alone for a retest security runs on its own", async () => {
    await retestData.requestRetest({ conversationId: CONVERSATION, findingId: FINDING });

    expect(written("retest_runs")[0].payload).toMatchObject({ ticket_id: null });
    expect(written("tickets")).toHaveLength(0);
    expect(written("risk_conversation_entries")[0].payload).toMatchObject({
      kind: "retest_requested",
      source_ticket_id: null,
    });
  });

  it("keys the request event to its run, so a retry cannot post it twice", async () => {
    const first = await retestData.requestRetest({
      conversationId: CONVERSATION,
      findingId: FINDING,
      ticketId: TICKET,
    });

    expect(written("risk_conversation_entries")[0].payload).toMatchObject({
      sync_key: `retest-requested::${first.id}`,
    });
  });

  it("reuses the reassessment already in flight instead of asking for a second", async () => {
    rows.retest_runs = [
      { id: "retest-1", conversation_id: CONVERSATION, ticket_id: TICKET, status: "queued" },
    ];

    const run = await retestData.requestRetest({
      conversationId: CONVERSATION,
      findingId: FINDING,
      ticketId: TICKET,
    });

    expect(run.id).toBe("retest-1");
    expect(written("retest_runs")).toHaveLength(0);
  });

  it("does not look at a resolved reassessment when deciding whether one is in flight", async () => {
    rows.retest_runs = [
      { id: "retest-1", conversation_id: CONVERSATION, ticket_id: TICKET, status: "completed" },
    ];

    await retestData.requestRetest({
      conversationId: CONVERSATION,
      findingId: FINDING,
      ticketId: TICKET,
    });

    expect(written("retest_runs")[0].payload).toMatchObject({ status: "queued" });
  });

  it("does not move a ticket that has already been moved", async () => {
    rows.tickets = [
      { id: TICKET, status: "retest_requested", risk_conversation_id: CONVERSATION },
    ];

    await retestData.requestRetest({
      conversationId: CONVERSATION,
      findingId: FINDING,
      ticketId: TICKET,
    });

    expect(written("tickets")).toHaveLength(0);
  });

  it("posts the start of a retest with the run it belongs to", async () => {
    rows.retest_runs = [
      { id: "retest-1", conversation_id: CONVERSATION, ticket_id: TICKET, status: "queued" },
    ];

    await retestData.markRunning("retest-1", "2026-01-01_00-00-00");

    expect(written("retest_runs")[0].payload).toMatchObject({
      status: "running",
      executed_by: SECURITY,
      external_test_run_id: "2026-01-01_00-00-00",
    });
    expect(written("risk_conversation_entries")[0].payload).toMatchObject({
      kind: "retest_started",
      metadata: { run_timestamp: "2026-01-01_00-00-00" },
      source_ticket_id: TICKET,
    });
  });
});

describe("remediation milestones", () => {
  it("posts the submitted fix and its notes into the risk conversation", async () => {
    await ticketData.submitFix(TICKET, { notes: "Rotated the key and shipped 2.1." });

    expect(written("tickets")[0].payload).toMatchObject({ status: "fix_submitted" });
    expect(written("risk_conversation_entries")[0].payload).toMatchObject({
      kind: "fix_submitted",
      message: "Rotated the key and shipped 2.1.",
      source_ticket_id: TICKET,
    });
  });

  it("posts a withdrawal with its reason", async () => {
    await ticketData.withdraw(TICKET, "The affected feature is being removed.");

    expect(written("risk_conversation_entries")[0].payload).toMatchObject({
      kind: "remediation_withdrawn",
      message: "The affected feature is being removed.",
    });
  });

  it("posts the start of remediation and stores the conversation on the ticket", async () => {
    await ticketData.createRemediationTicket({
      finding_id: FINDING,
      application_id: "example-app-id",
      title: "Remediate: Example finding",
      risk_conversation_id: CONVERSATION,
    });

    expect(written("tickets")[0].payload).toMatchObject({
      risk_conversation_id: CONVERSATION,
    });
    expect(written("risk_conversation_entries")[0].payload).toMatchObject({
      kind: "remediation_started",
    });
  });

  it("still works for a ticket with no conversation behind it", async () => {
    rows.tickets = [{ id: TICKET, status: "open", risk_conversation_id: null }];

    await ticketData.submitFix(TICKET, { notes: "Fixed." });

    expect(written("tickets")[0].payload).toMatchObject({ status: "fix_submitted" });
    expect(written("risk_conversation_entries")).toHaveLength(0);
  });
});

describe("the legacy conversation tables", () => {
  it("is never written to by any of these workflows", async () => {
    await riskConversationData.addEntry({
      conversation_id: CONVERSATION,
      kind: "message",
      message: "Example.",
    });
    await ticketData.submitFix(TICKET, { notes: "Fixed." });
    await ticketData.withdraw(TICKET, "Stopping.");
    await retestData.requestRetest({
      conversationId: CONVERSATION,
      findingId: FINDING,
      ticketId: TICKET,
    });
    await findingData.classify({
      findingId: FINDING,
      conversationId: CONVERSATION,
      status: "reduced_risk",
      reason: "Verified.",
    });

    for (const legacy of ["ticket_messages", "assessment_messages", "ticket_attachments"]) {
      expect(written(legacy), legacy).toHaveLength(0);
    }
  });
});
