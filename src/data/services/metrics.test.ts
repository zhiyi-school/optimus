import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();

vi.mock("@/data/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

const { metricsData } = await import("./metrics");

function countingTable(count: number) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const key of ["select", "eq", "in", "not", "is", "gte", "lte", "or", "neq"]) {
    chain[key] = vi.fn(self);
  }
  chain.then = (resolve: (value: { count: number; error: null }) => unknown) =>
    resolve({ count, error: null });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  from.mockImplementation(() => countingTable(0));
});

describe("metricsData.getOverview", () => {
  it("uses the RPC result when it succeeds and stays quiet", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: { applicationsCount: 7 }, error: null });

    const metrics = await metricsData.getOverview();

    expect(metrics.applicationsCount).toBe(7);
    expect(from).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns and still returns metrics when the RPC is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } });

    const metrics = await metricsData.getOverview();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("0012_dashboard_metrics_rpc.sql");
    expect(from).toHaveBeenCalled();
    expect(metrics.applicationsCount).toBe(0);
  });
});
