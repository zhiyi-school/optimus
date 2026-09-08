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
let rpcResult: Record<string, unknown> | null = null;
let rpcMissing: string[] = [];
let raceOn: string | null = null;
let missingColumns: string[] = [];

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
      // A database behind on migrations rejects the whole insert, naming the column.
      const absent = missingColumns.find((column) => column in payload);
      if (op === "insert" && absent) {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST204", message: `Could not find the '${absent}' column` },
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
      if (rpcMissing.includes(name)) {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: `Could not find the function public.${name}` },
        });
      }
      if (rpcError) return Promise.resolve({ data: null, error: rpcError });
      if (rpcResult) return Promise.resolve({ data: rpcResult, error: null });
      return Promise.resolve({
        data: { id: params.p_finding_id, status: params.p_status },
        error: null,
      });
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
  rpcResult = null;
  rpcMissing = [];
  raceOn = null;
  missingColumns = [];
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

  it("records where the bytes live and how large they are", async () => {
    await riskConversationData.uploadAttachment(
      CONVERSATION,
      "entry-1",
      new File(["example"], "example-evidence.png", { type: "image/png" }),
    );

    expect(written("risk_conversation_attachments")[0].payload).toMatchObject({
      storage_provider: "supabase",
      size_bytes: 7,
      mime_type: "image/png",
    });
  });

  it("still attaches the file on a database without migration 0027", async () => {
    missingColumns = ["storage_provider"];
    const attachment = await riskConversationData.uploadAttachment(
      CONVERSATION,
      "entry-1",
      new File(["example"], "example-evidence.png", { type: "image/png" }),
    );

    expect(attachment.file_name).toBe("example-evidence.png");
    const payloads = written("risk_conversation_attachments").map((write) => write.payload);
    expect(payloads[1]).not.toHaveProperty("storage_provider");
    expect(payloads[1]).toMatchObject({ storage_path: uploads[0] });
  });

  it("keeps a space-and-Unicode name on the row but not in the storage key", async () => {
    await riskConversationData.uploadAttachment(
      CONVERSATION,
      "entry-1",
      new File(["x"], "評価 report (final).pdf", { type: "application/pdf" }),
    );

    expect(written("risk_conversation_attachments")[0].payload).toMatchObject({
      file_name: "評価 report (final).pdf",
    });
    expect(uploads[0]).toMatch(/^conversation-[^/]+\/\d+-[A-Za-z0-9._-]+$/);
  });

  it("cannot be talked out of its own conversation folder by a file name", async () => {
    await riskConversationData.uploadAttachment(
      CONVERSATION,
      "entry-1",
      new File(["x"], "../../etc/passwd", { type: "" }),
    );

    expect(uploads[0].startsWith(`conversation-${CONVERSATION}/`)).toBe(true);
    expect(uploads[0]).not.toContain("..");
    expect(uploads[0]).not.toContain("/etc/");
  });
});

describe("classification", () => {
  it("is one server-side call, so the finding cannot change without its record", async () => {
    rpcResult = { finding: { id: FINDING, status: "reduced_risk" }, entry_id: "entry-1" };
    await findingData.classify({
      findingId: FINDING,
      conversationId: CONVERSATION,
      status: "reduced_risk",
      reason: "Verified on the current build.",
    });

    expect(rpcCalls).toEqual([
      {
        name: "classify_risk_entry",
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

  it("returns the entry it created, so a file can be attached to the decision itself", async () => {
    rpcResult = { finding: { id: FINDING, status: "reduced_risk" }, entry_id: "entry-1" };

    const result = await findingData.classify({
      findingId: FINDING,
      conversationId: CONVERSATION,
      status: "reduced_risk",
      reason: "Verified on the current build.",
    });

    expect(result.entryId).toBe("entry-1");
    expect(result.finding).toMatchObject({ id: FINDING, status: "reduced_risk" });
  });

  it("falls back to the original function on a database without migration 0025", async () => {
    rpcMissing = ["classify_risk_entry"];

    const result = await findingData.classify({
      findingId: FINDING,
      conversationId: CONVERSATION,
      status: "reduced_risk",
      reason: "Verified.",
    });

    expect(rpcCalls.map((call) => call.name)).toEqual(["classify_risk_entry", "classify_risk"]);
    // Without the new function there is no entry to attach a file to.
    expect(result.entryId).toBeNull();
    expect(result.finding).toMatchObject({ id: FINDING, status: "reduced_risk" });
  });

  it("surfaces a real refusal rather than falling back to the old function", async () => {
    rpcError = { message: "only the security team can change a risk classification" };

    await expect(
      findingData.classify({
        findingId: FINDING,
        conversationId: CONVERSATION,
        status: "reduced_risk",
        reason: "Verified.",
      }),
    ).rejects.toMatchObject({ message: /only the security team/ });
    expect(rpcCalls.map((call) => call.name)).toEqual(["classify_risk_entry"]);
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
      sync_key: `retest-requested::${first.run.id}`,
    });
  });

  it("carries the requester's context on the request event rather than as a second message", async () => {
    await retestData.requestRetest({
      conversationId: CONVERSATION,
      findingId: FINDING,
      ticketId: TICKET,
      message: "  Fixed in build 2.1.  ",
    });

    const entries = written("risk_conversation_entries");
    expect(entries).toHaveLength(1);
    expect(entries[0].payload).toMatchObject({
      kind: "retest_requested",
      message: "Fixed in build 2.1.",
    });
  });

  it("records no message when the requester added no context", async () => {
    await retestData.requestRetest({
      conversationId: CONVERSATION,
      findingId: FINDING,
      ticketId: TICKET,
      message: "   ",
    });

    expect(written("risk_conversation_entries")[0].payload).toMatchObject({ message: null });
  });

  it("posts one request event however often the request is retried, context and all", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await retestData.requestRetest({
        conversationId: CONVERSATION,
        findingId: FINDING,
        ticketId: TICKET,
        message: "Fixed in build 2.1.",
      });
    }

    expect(written("risk_conversation_entries")).toHaveLength(1);
    expect(rows.risk_conversation_entries).toHaveLength(1);
  });

  it("returns the request event, so a file attaches to it rather than to a second message", async () => {
    const { entryId } = await retestData.requestRetest({
      conversationId: CONVERSATION,
      findingId: FINDING,
      ticketId: TICKET,
    });

    const entries = written("risk_conversation_entries");
    expect(entries).toHaveLength(1);
    expect(entryId).toBe(rows.risk_conversation_entries[0].id);
  });

  it("returns the entry the first attempt wrote when the request is retried", async () => {
    const first = await retestData.requestRetest({
      conversationId: CONVERSATION,
      findingId: FINDING,
      ticketId: TICKET,
    });
    const second = await retestData.requestRetest({
      conversationId: CONVERSATION,
      findingId: FINDING,
      ticketId: TICKET,
    });

    expect(second.entryId).toBe(first.entryId);
    expect(rows.risk_conversation_entries).toHaveLength(1);
  });

  it("reuses the reassessment already in flight instead of asking for a second", async () => {
    rows.retest_runs = [
      { id: "retest-1", conversation_id: CONVERSATION, ticket_id: TICKET, status: "queued" },
    ];

    const { run } = await retestData.requestRetest({
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

  it("records the previous ticket status through the request, not from the client", async () => {
    await retestData.requestRetest({
      conversationId: CONVERSATION,
      findingId: FINDING,
      ticketId: TICKET,
    });

    expect(written("retest_runs")[0].payload).not.toHaveProperty("previous_ticket_status");
    expect(written("retest_runs")[0].payload).toMatchObject({ status: "queued" });
  });

  it("claims the queued request before any automation is asked to start", async () => {
    rpcResult = { id: "retest-1", status: "running" };
    await retestData.startRun("retest-1");

    expect(rpcCalls).toEqual([
      { name: "start_reassessment", params: { p_retest_id: "retest-1" } },
    ]);
  });

  it("refuses to start a request the developer has already withdrawn", async () => {
    rpcError = { message: "this reassessment request was withdrawn by the developer" };
    await expect(retestData.startRun("retest-1")).rejects.toMatchObject({
      message: expect.stringContaining("withdrawn"),
    });
  });

  it("posts the start of a retest with the run it belongs to", async () => {
    rows.retest_runs = [
      { id: "retest-1", conversation_id: CONVERSATION, ticket_id: TICKET, status: "running" },
    ];

    await retestData.markRunning("retest-1", "2026-01-01_00-00-00");

    expect(written("retest_runs")[0].payload).toMatchObject({
      external_test_run_id: "2026-01-01_00-00-00",
    });
    expect(written("risk_conversation_entries")[0].payload).toMatchObject({
      kind: "retest_started",
      metadata: { run_timestamp: "2026-01-01_00-00-00" },
      source_ticket_id: TICKET,
    });
  });
});

describe("withdrawing a reassessment", () => {
  const cancelled = {
    id: "retest-1",
    ticket_id: TICKET,
    status: "cancelled",
    previous_ticket_status: "fix_submitted",
  };

  it("cancels the request and restores the ticket in one server-side call", async () => {
    rpcResult = cancelled;
    const run = await retestData.withdraw("retest-1", "Found another defect first.");

    expect(rpcCalls[0]).toEqual({
      name: "withdraw_reassessment",
      params: { p_retest_id: "retest-1", p_reason: "Found another defect first." },
    });
    expect(run.status).toBe("cancelled");
    // The ticket is restored inside the function, never by a second client write.
    expect(written("tickets")).toHaveLength(0);
    expect(written("retest_runs")).toHaveLength(0);
  });

  it("trims the reason before sending it", async () => {
    rpcResult = cancelled;
    await retestData.withdraw("retest-1", "   Superseded by a new build.  \n");

    expect(rpcCalls[0].params.p_reason).toBe("Superseded by a new build.");
  });

  it("refuses a reason that is only whitespace, without reaching the server", async () => {
    await expect(retestData.withdraw("retest-1", "   ")).rejects.toThrow(
      "Withdrawing a reassessment needs a reason.",
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it("surfaces the server's refusal rather than reporting success", async () => {
    rpcError = { message: "this reassessment is already running, so it can no longer be withdrawn" };
    await expect(retestData.withdraw("retest-1", "Changed my mind.")).rejects.toMatchObject({
      message: expect.stringContaining("already running"),
    });
  });

  it("logs the withdrawal against the request, naming the state it restored", async () => {
    rpcResult = { ...cancelled, previous_ticket_status: "rejected" };
    await retestData.withdraw("retest-1", "Reworking the fix.");

    expect(written("activity_log")[0].payload).toMatchObject({
      entity_type: "retest_run",
      entity_id: "retest-1",
      action: "reassessment_withdrawn",
      metadata: { ticket_id: TICKET, restored_status: "rejected" },
    });
  });
});

describe("remediation milestones", () => {

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

});

describe("the legacy conversation tables", () => {
  it("is never written to by any of these workflows", async () => {
    await riskConversationData.addEntry({
      conversation_id: CONVERSATION,
      kind: "message",
      message: "Example.",
    });
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
