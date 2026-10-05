import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();

vi.mock("@/database/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

const { riskAcceptanceData } = await import("./risk-acceptance");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("riskAcceptanceData", () => {
  it("looks up only the acceptance still in force for the finding", async () => {
    const calls: [string, ...unknown[]][] = [];
    const chain: Record<string, unknown> = {};
    for (const key of ["select", "eq", "is"]) {
      chain[key] = (...args: unknown[]) => {
        calls.push([key, ...args]);
        return chain;
      };
    }
    chain.maybeSingle = () => Promise.resolve({ data: { id: "acceptance-1" }, error: null });
    from.mockReturnValue(chain);

    const row = await riskAcceptanceData.getActiveForFinding("finding-1");

    expect(from).toHaveBeenCalledWith("risk_acceptance");
    expect(calls).toEqual([
      ["select", "*"],
      ["eq", "finding_id", "finding-1"],
      ["eq", "decision", "accepted"],
      ["is", "ended_at", null],
    ]);
    expect(row).toEqual({ id: "acceptance-1" });
  });

  it("accepts through the RPC with a trimmed reason and the submission identity", async () => {
    rpc.mockResolvedValue({ data: { acceptance: { id: "acceptance-1" }, entry_id: "entry-1" }, error: null });

    const result = await riskAcceptanceData.accept({
      conversationId: "conversation-1",
      findingId: "finding-1",
      reason: "  Compensated by server-side checks.  ",
      submissionId: "submission-1",
    });

    expect(rpc).toHaveBeenCalledWith("accept_risk_entry", {
      p_conversation_id: "conversation-1",
      p_finding_id: "finding-1",
      p_reason: "Compensated by server-side checks.",
      p_submission_id: "submission-1",
    });
    expect(result).toEqual({ acceptance: { id: "acceptance-1" }, entryId: "entry-1" });
  });

  it("retracts through the RPC and surfaces its refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "retracting a risk acceptance needs a reason" } });

    await expect(
      riskAcceptanceData.retract({ acceptanceId: "acceptance-1", reason: " " }),
    ).rejects.toMatchObject({ message: "retracting a risk acceptance needs a reason" });
    expect(rpc).toHaveBeenCalledWith("retract_risk_acceptance", {
      p_acceptance_id: "acceptance-1",
      p_reason: "",
    });
  });
});
