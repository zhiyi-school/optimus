/**
 * Dashboard overview metrics from the `dashboard_metrics` RPC, with a per-table count fallback.
 */

import { supabase } from "@/data/supabase";
import type { AssessmentStatus, FindingStatus, TicketStatus, TicketType } from "@/data/types";
import { createDebug } from "@/lib/debug";

const debug = createDebug("data:metrics");

export interface DashboardMetrics {
  findingCounts: Record<FindingStatus, number>;
  criticalFindings: number;
  highFindings: number;
  ticketCounts: Record<TicketStatus, number>;
  openRemediation: number;
  riskAcceptancePending: number;
  acceptedRisks: number;
  retestPending: number;
  applicationsCount: number;
  assessmentsCount: number;
  assessmentsRunning: number;
}

export const metricsData = {
  /** Returns dashboard metrics from the RPC, or from per-table counts when the RPC is unavailable. */
  async getOverview(): Promise<DashboardMetrics> {
    debug("rpc dashboard_metrics");
    const startedAt = performance.now();
    const { data: rpcData, error: rpcError } = await supabase.rpc("dashboard_metrics");
    if (!rpcError && rpcData) {
      debug("dashboard metrics from RPC", { ms: Math.round(performance.now() - startedAt) });
      return rpcData as DashboardMetrics;
    }
    debug("dashboard_metrics RPC unavailable; falling back to per-table counts", {
      code: rpcError?.code,
      message: rpcError?.message ?? "RPC returned no data",
    });
    console.warn(
      "dashboard_metrics RPC unavailable; using per-table counts instead. Check that supabase/migrations/0012_dashboard_metrics_rpc.sql is applied.",
      rpcError ?? "RPC returned no data",
    );

    const findingCounts: Record<FindingStatus, number> = {
      at_risk: 0,
      reduced_risk: 0,
      inconclusive: 0,
    };
    const ticketCounts = {
      open: 0,
      in_progress: 0,
      retest_requested: 0,
      retest_in_progress: 0,
      under_review: 0,
      accepted: 0,
      rejected: 0,
      closed: 0,
    } as Record<TicketStatus, number>;

    /** Counts every application. */
    const countApplications = async () => {
      const { count, error } = await supabase
        .from("applications")
        .select("*", { count: "exact", head: true });
      if (error) {
        debug("counting applications failed", { code: error.code, message: error.message });
        throw error;
      }
      debug("counted applications", { count });
      return count ?? 0;
    };
    /** Counts assessments, optionally with one status. */
    const countAssessments = async (status?: AssessmentStatus) => {
      let query = supabase.from("assessments").select("*", { count: "exact", head: true });
      if (status) query = query.eq("status", status);
      const { count, error } = await query;
      if (error) {
        debug("counting assessments failed", { status, code: error.code, message: error.message });
        throw error;
      }
      debug("counted assessments", { status, count });
      return count ?? 0;
    };
    /** Counts findings matching an optional status and severity. */
    const countFindings = async (filter: { status?: FindingStatus; severity?: string }) => {
      let query = supabase.from("findings").select("*", { count: "exact", head: true });
      if (filter.status) query = query.eq("status", filter.status);
      if (filter.severity) query = query.eq("severity", filter.severity);
      const { count, error } = await query;
      if (error) {
        debug("counting findings failed", { ...filter, code: error.code, message: error.message });
        throw error;
      }
      debug("counted findings", { ...filter, count });
      return count ?? 0;
    };
    /** Counts tickets matching the type and status filters. */
    const countTickets = async (filter: {
      status?: TicketStatus;
      type?: TicketType;
      statusIn?: TicketStatus[];
      statusNotIn?: TicketStatus[];
    }) => {
      let query = supabase.from("tickets").select("*", { count: "exact", head: true });
      if (filter.type) query = query.eq("type", filter.type);
      if (filter.status) query = query.eq("status", filter.status);
      if (filter.statusIn) query = query.in("status", filter.statusIn);
      if (filter.statusNotIn) query = query.not("status", "in", `(${filter.statusNotIn.join(",")})`);
      const { count, error } = await query;
      if (error) {
        debug("counting tickets failed", { ...filter, code: error.code, message: error.message });
        throw error;
      }
      debug("counted tickets", { ...filter, count });
      return count ?? 0;
    };

    const findingStatuses = Object.keys(findingCounts) as FindingStatus[];
    const ticketStatuses = Object.keys(ticketCounts) as TicketStatus[];
    const [
      findingStatusCounts,
      criticalFindings,
      highFindings,
      ticketStatusCounts,
      openRemediation,
      riskAcceptancePending,
      acceptedRisks,
      retestPending,
      applicationsCount,
      assessmentsCount,
      assessmentsRunning,
    ] = await Promise.all([
      Promise.all(findingStatuses.map((status) => countFindings({ status }))),
      countFindings({ severity: "critical" }),
      countFindings({ severity: "high" }),
      Promise.all(ticketStatuses.map((status) => countTickets({ status }))),
      countTickets({ type: "remediation", statusNotIn: ["closed", "accepted", "rejected"] }),
      countTickets({ type: "risk_acceptance", status: "under_review" }),
      countTickets({ type: "risk_acceptance", status: "accepted" }),
      countTickets({ statusIn: ["retest_requested", "retest_in_progress"] }),
      countApplications(),
      countAssessments(),
      countAssessments("running"),
    ]);

    findingStatuses.forEach((status, index) => {
      findingCounts[status] = findingStatusCounts[index];
    });
    ticketStatuses.forEach((status, index) => {
      ticketCounts[status] = ticketStatusCounts[index];
    });
    debug("dashboard metrics from per-table counts", {
      ms: Math.round(performance.now() - startedAt),
      applicationsCount,
      assessmentsCount,
    });

    return {
      findingCounts,
      criticalFindings,
      highFindings,
      ticketCounts,
      openRemediation,
      riskAcceptancePending,
      acceptedRisks,
      retestPending,
      applicationsCount,
      assessmentsCount,
      assessmentsRunning,
    };
  },
};
