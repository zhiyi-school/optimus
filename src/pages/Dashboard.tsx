import { Navigate } from "react-router-dom";
import { ListChecks, Settings } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { primaryRole } from "@/auth/permissions";
import { PageHeader, StatCard, LoadingState, ErrorState } from "@/components/common";
import { CtaCard } from "@/components/cta-card";
import { useDashboardMetrics } from "@/hooks/queries";
import { findingStatusConfig } from "@/lib/status";
import type { UserRole } from "@/data/types";

const roleGreeting: Record<UserRole, string> = {
  developer: "Findings and tickets that need your attention.",
  security: "Assessment activity, tests, and review queues.",
  cio: "Security posture across all assessed applications.",
  admin: "Manage teams, users, and application ownership.",
};

export default function Dashboard() {
  const { profile } = useAuth();
  const { data: metrics, isLoading, isError, refetch } = useDashboardMetrics();
  const role = primaryRole(profile?.roles);

  // Security's home is the Assess flow now — no separate Dashboard tab in nav.
  if (role === "security") return <Navigate to="/assessments" replace />;

  return (
    <div>
      <PageHeader title="Dashboard" description={role ? roleGreeting[role] : undefined} />

      {isLoading && <LoadingState label="Loading dashboard…" />}
      {isError && <ErrorState message="Unable to load dashboard metrics." onRetry={() => refetch()} />}

      {metrics && role === "developer" && <DeveloperDashboard metrics={metrics} />}
      {metrics && role === "cio" && <CioDashboard metrics={metrics} />}
      {role === "admin" && (
        <CtaCard
          icon={Settings}
          title="Go to Admin"
          description="Manage teams, user-team assignments, roles, and application ownership."
          to="/admin"
        />
      )}
    </div>
  );
}

function DeveloperDashboard({ metrics }: { metrics: ReturnType<typeof useDashboardMetrics>["data"] }) {
  if (!metrics) return null;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label={findingStatusConfig.at_risk.label}
          value={metrics.findingCounts.at_risk}
          tone="danger"
          to="/resolve"
        />
        <StatCard
          label={findingStatusConfig.reduced_risk.label}
          value={metrics.findingCounts.reduced_risk}
          tone="success"
          to="/resolve"
        />
        <StatCard
          label={findingStatusConfig.inconclusive.label}
          value={metrics.findingCounts.inconclusive}
          tone="warning"
          to="/resolve"
        />
        <StatCard label="Open Tickets" value={metrics.openRemediation} to="/assessments" />
      </div>
    </div>
  );
}

function CioDashboard({ metrics }: { metrics: ReturnType<typeof useDashboardMetrics>["data"] }) {
  if (!metrics) return null;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Applications Assessed" value={metrics.applicationsCount} to="/assessments" />
        <StatCard
          label="Critical Findings"
          value={metrics.criticalFindings}
          tone="danger"
          to="/assessments"
        />
        <StatCard
          label="High Findings"
          value={metrics.highFindings}
          tone="danger"
          to="/assessments"
        />
        <StatCard
          label="Open Remediation"
          value={metrics.openRemediation}
          tone="warning"
          to="/assessments"
        />
        <StatCard
          label="Retest Pending"
          value={metrics.retestPending}
          tone="info"
          to="/assessments"
        />
        <StatCard
          label="Accepted Risks"
          value={metrics.acceptedRisks}
          to="/assessments"
        />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Security Posture</h2>
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            label={findingStatusConfig.at_risk.label}
            value={metrics.findingCounts.at_risk}
            tone="danger"
            to="/resolve"
          />
          <StatCard
            label={findingStatusConfig.reduced_risk.label}
            value={metrics.findingCounts.reduced_risk}
            tone="success"
            to="/resolve"
          />
          <StatCard
            label={findingStatusConfig.inconclusive.label}
            value={metrics.findingCounts.inconclusive}
            tone="warning"
            to="/resolve"
          />
        </div>
      </div>

      <CtaCard
        icon={ListChecks}
        title="Outstanding work"
        description="Open remediation, retests pending, and risk acceptance requests."
        to="/assessments"
      />
    </div>
  );
}
