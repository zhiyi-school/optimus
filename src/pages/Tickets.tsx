import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { primaryRole } from "@/auth/permissions";
import { PageHeader, FilterBar, LoadingState, ErrorState, EmptyState } from "@/components/common";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn, TicketBadge, PlatformBadge } from "@/components/data-display";
import { useTickets, useApplications, useProfiles } from "@/hooks/queries";
import { ticketTypeConfig } from "@/lib/status";
import { formatDate, cn } from "@/lib/utils";
import type { Application, Finding, Ticket, TicketStatus, TicketType, UserRole } from "@/data/types";
import { ApplicationIcon } from "@/components/application-icon";

type Row = Ticket & { finding: Finding | null; application: Application | null };

const presetsByRole: Record<UserRole, { label: string; status?: TicketStatus; type?: TicketType }[]> = {
  developer: [
    { label: "All" },
    { label: "Open", status: "open" },
    { label: "Remediation", type: "remediation" },
    { label: "Risk Acceptance", type: "risk_acceptance" },
    { label: "Retest Requested", status: "retest_requested" },
    { label: "Awaiting Security", status: "under_review" },
    { label: "Closed", status: "closed" },
  ],
  security: [
    { label: "All" },
    { label: "Open Remediation", status: "open", type: "remediation" },
    { label: "Risk Acceptance Requests", status: "under_review", type: "risk_acceptance" },
    { label: "Retest Requests", status: "retest_requested" },
    { label: "Awaiting Review", status: "under_review" },
    { label: "App Provisioning", status: "open", type: "app_provisioning" },
  ],
  cio: [
    { label: "All" },
    { label: "Open Remediation", type: "remediation" },
    { label: "Retest Pending", status: "retest_requested" },
    { label: "Risk Acceptance Pending", status: "under_review", type: "risk_acceptance" },
    { label: "Accepted Risks", status: "accepted", type: "risk_acceptance" },
  ],
  admin: [{ label: "All" }],
};

export default function Tickets() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data: applications } = useApplications();
  const { data: profiles } = useProfiles();

  const type = (params.get("type") as TicketType | null) ?? undefined;
  const status = (params.get("status") as TicketStatus | null) ?? undefined;
  const applicationId = params.get("application") ?? undefined;
  const createdBy = params.get("createdBy") ?? undefined;

  const { data: tickets, isLoading, isError, refetch } = useTickets({
    type,
    status,
    applicationId,
    createdBy,
  });

  const profileMap = useMemo(() => {
    const map = new Map((profiles ?? []).map((p) => [p.id, p]));
    return map;
  }, [profiles]);

  function setParam(key: string, value: string | undefined) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  function applyPreset(preset: { status?: TicketStatus; type?: TicketType }) {
    const next = new URLSearchParams(params);
    if (preset.status) next.set("status", preset.status);
    else next.delete("status");
    if (preset.type) next.set("type", preset.type);
    else next.delete("type");
    setParams(next, { replace: true });
  }

  const role = primaryRole(profile?.roles);
  const presets = role ? presetsByRole[role] : presetsByRole.developer;
  const activePreset =
    presets.find(
      (preset: { status?: TicketStatus; type?: TicketType }) =>
        preset.status === status && preset.type === type,
    ) ?? presets[0];

  const columns: DataTableColumn<Row>[] = [
    { key: "id", header: "Ticket ID", render: (r) => <span className="text-xs text-muted-foreground">{r.id.slice(0, 8)}</span> },
    { key: "type", header: "Type", render: (r) => ticketTypeConfig[r.type].label },
    { key: "finding", header: "Finding", render: (r) => r.finding?.title ?? "—" },
    {
      key: "application",
      header: "Application",
      render: (r) => (
        <span className="inline-flex items-center gap-2">
          <span className="flex items-center gap-2.5">
            <ApplicationIcon application={r.application} className="h-7 w-7" iconClassName="h-3.5 w-3.5" />
            {r.application?.name ?? "—"}
          </span>
          {r.application && <PlatformBadge platform={r.application.platform} />}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (r) => <TicketBadge status={r.status} /> },
    { key: "createdBy", header: "Created By", render: (r) => profileMap.get(r.created_by)?.display_name ?? "—" },
    {
      key: "assignedTo",
      header: "Assigned To",
      render: (r) =>
        (r.assigned_user_id && profileMap.get(r.assigned_user_id)?.display_name) ||
        (r.assigned_team_id ? "Team" : "—"),
    },
    { key: "updated", header: "Updated", render: (r) => formatDate(r.updated_at) },
  ];

  return (
    <div>
      <PageHeader title="Tickets" description="Remediation, risk acceptance, and retest workflow." />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            size="sm"
            variant={activePreset === preset ? "default" : "outline"}
            className={cn(activePreset !== preset && "text-muted-foreground")}
            onClick={() => applyPreset(preset)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <FilterBar>
        <Select value={type ?? ""} onChange={(e) => setParam("type", e.target.value || undefined)}>
          <option value="">All types</option>
          <option value="remediation">Remediation</option>
          <option value="risk_acceptance">Risk Acceptance</option>
          <option value="retest_request">Retest Request</option>
          <option value="app_provisioning">App Provisioning</option>
        </Select>
        <Select value={applicationId ?? ""} onChange={(e) => setParam("application", e.target.value || undefined)}>
          <option value="">All applications</option>
          {(applications ?? []).map((app) => (
            <option key={app.id} value={app.id}>
              {app.name}
            </option>
          ))}
        </Select>
        <Select value={createdBy ?? ""} onChange={(e) => setParam("createdBy", e.target.value || undefined)}>
          <option value="">Created by anyone</option>
          {(profiles ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
        </Select>
      </FilterBar>

      {isLoading && <LoadingState label="Loading tickets…" />}
      {isError && <ErrorState message="Unable to load tickets." onRetry={() => refetch()} />}
      {!isLoading && !isError && (tickets ?? []).length === 0 && <EmptyState title="No tickets yet." />}
      {!isLoading && (tickets ?? []).length > 0 && (
        <DataTable columns={columns} rows={tickets as Row[]} onRowClick={(r) => navigate(`/tickets/${r.id}`)} />
      )}
    </div>
  );
}
