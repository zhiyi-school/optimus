import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlReconciliation } from "./controls";

const CONTROL_ID = "example-feature-01-risk-01-control-01";

interface Row {
  id: string;
  [key: string]: unknown;
}

let controlRows: Row[] = [];
let stepRows: Row[] = [];
let inserts: { table: string; rows: Row[]; options: { onConflict: string; ignoreDuplicates: boolean } }[] = [];

function table(name: string) {
  const rows = name === "ticket_controls" ? controlRows : stepRows;
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => Promise.resolve({ data: rows, error: null }),
    upsert: (payload: Row[], options: { onConflict: string; ignoreDuplicates: boolean }) => {
      inserts.push({ table: name, rows: payload, options });
      const keys = options.onConflict.split(",");
      for (const row of payload) {
        const clash = rows.some((existing) => keys.every((key) => existing[key] === row[key]));
        if (clash && options.ignoreDuplicates) continue;
        rows.push({ status: "not_started", ...row, id: `${name}-${rows.length + 1}` });
      }
      return Promise.resolve({ error: null });
    },
  };
  return chain;
}

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "attachments",
  supabase: { from: (name: string) => table(name) },
}));

const { controlProgressData } = await import("./controls");

const plan: ControlReconciliation[] = [
  { control_id: CONTROL_ID, required: true, step_keys: ["rotate-example-key", "revoke-example-key"] },
];

beforeEach(() => {
  controlRows = [];
  stepRows = [];
  inserts = [];
});

describe("controlProgressData.reconcile", () => {
  it("creates a row for every control and step the playbook lists", async () => {
    await controlProgressData.reconcile("example-ticket-id", plan);

    expect(controlRows).toHaveLength(1);
    expect(stepRows.map((row) => row.step_key)).toEqual([
      "rotate-example-key",
      "revoke-example-key",
    ]);
  });

  it("writes no playbook content into the database", async () => {
    await controlProgressData.reconcile("example-ticket-id", plan);

    const written = inserts.flatMap((insert) => insert.rows);
    for (const row of written) {
      for (const forbidden of [
        "title",
        "step_title",
        "step_index",
        "step_count",
        "position",
        "playbook_revision",
        "content_hash",
        "text",
      ]) {
        expect(row, forbidden).not.toHaveProperty(forbidden);
      }
    }
    expect(Object.keys(inserts[0].rows[0]).sort()).toEqual(["control_id", "required", "ticket_id"]);
    expect(Object.keys(inserts[1].rows[0]).sort()).toEqual(["step_key", "ticket_control_id"]);
  });

  it("never overwrites a row that already exists, whatever the read said", async () => {
    await controlProgressData.reconcile("example-ticket-id", plan);

    for (const insert of inserts) {
      expect(insert.options.ignoreDuplicates, insert.table).toBe(true);
      expect(insert.options.onConflict, insert.table).toBe(
        insert.table === "ticket_controls" ? "ticket_id,control_id" : "ticket_control_id,step_key",
      );
    }
  });

  it("is idempotent: reconciling again adds nothing", async () => {
    await controlProgressData.reconcile("example-ticket-id", plan);
    inserts = [];
    await controlProgressData.reconcile("example-ticket-id", plan);

    expect(inserts).toHaveLength(0);
    expect(controlRows).toHaveLength(1);
    expect(stepRows).toHaveLength(2);
  });

  it("adds only the step the playbook has newly introduced", async () => {
    await controlProgressData.reconcile("example-ticket-id", plan);
    stepRows[0].status = "completed";
    inserts = [];

    await controlProgressData.reconcile("example-ticket-id", [
      { ...plan[0], step_keys: [...plan[0].step_keys, "audit-example-key"] },
    ]);

    expect(inserts.flatMap((insert) => insert.rows)).toEqual([
      { ticket_control_id: "ticket_controls-1", step_key: "audit-example-key" },
    ]);
    expect(stepRows[0].status).toBe("completed");
  });

  it("leaves a row for a step the playbook has dropped exactly where it is", async () => {
    await controlProgressData.reconcile("example-ticket-id", plan);
    stepRows[1].status = "completed";

    await controlProgressData.reconcile("example-ticket-id", [
      { ...plan[0], step_keys: ["rotate-example-key"] },
    ]);

    expect(stepRows).toHaveLength(2);
    expect(stepRows[1]).toMatchObject({ step_key: "revoke-example-key", status: "completed" });
  });

  it("touches nothing when the playbook lists no required controls", async () => {
    await controlProgressData.reconcile("example-ticket-id", []);
    expect(inserts).toHaveLength(0);
  });
});
