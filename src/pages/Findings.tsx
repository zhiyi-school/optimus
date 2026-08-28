import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader, FilterBar, SearchInput, LoadingState, ErrorState, EmptyState } from "@/components/common";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select } from "@/components/ui/input";
import {
  DataTable,
  type DataTableColumn,
  StatusBadge,
  SeverityBadge,
  PlatformBadge,
  TicketBadge,
} from "@/components/data-display";
import { useFindings, useApplications, useTicketsByFindingIds } from "@/hooks/queries";
import { formatShortDate } from "@/lib/utils";
import type { Application, Finding, FindingStatus, TicketStatus } from "@/data/types";

type Row = Finding & { application: Application | null };

const tabs: { key: string; label: string; status?: FindingStatus }[] = [
  { key: "all", label: "All" },
  { key: "at_risk", label: "At Risk", status: "at_risk" },
  { key: "reduced_risk", label: "Reduced Risk", status: "reduced_risk" },
  { key: "inconclusive", label: "Inconclusive", status: "inconclusive" },
];

export default function Findings() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: applications } = useApplications();

  const status = (params.get("status") as FindingStatus | null) ?? undefined;
  const applicationId = params.get("application") ?? undefined;
  const platform = params.get("platform") ?? undefined;
  const severity = params.get("severity") ?? undefined;
  const search = params.get("q") ?? "";

  const { data: findings, isLoading, isError, refetch } = useFindings({
    status,
    applicationId,
    platform,
    severity,
    search: search || undefined,
  });

  const findingIds = useMemo(() => (findings ?? []).map((f) => f.id), [findings]);
  const { data: tickets } = useTicketsByFindingIds(findingIds);

  const latestTicketByFinding = useMemo(() => {
    const map = new Map<string, TicketStatus>();
    for (const t of tickets ?? []) {
      if (t.finding_id && !map.has(t.finding_id)) map.set(t.finding_id, t.status);
    }
    return map;
  }, [tickets]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const columns: DataTableColumn<Row>[] = [
    { key: "title", header: "Finding", render: (r) => <span className="font-medium text-foreground">{r.title}</span> },
    { key: "application", header: "Application", render: (r) => r.application?.name ?? "—" },
    { key: "version", header: "Version", render: (r) => r.application?.version ?? "—" },
    { key: "platform", header: "Platform", render: (r) => <PlatformBadge platform={r.platform} /> },
    { key: "severity", header: "Severity", render: (r) => <SeverityBadge severity={r.severity} /> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "date", header: "Date Found", render: (r) => formatShortDate(r.created_at) },
    {
      key: "findingId",
      header: "Finding ID",
      render: (r) => <span className="text-xs text-muted-foreground">{r.id.slice(0, 8)}</span>,
    },
    {
      key: "ticket",
      header: "Ticket Status",
      render: (r) => {
        const s = latestTicketByFinding.get(r.id);
        return s ? <TicketBadge status={s} /> : "—";
      },
    },
  ];

  return (
    <div>
      <PageHeader title="Findings" description="Security findings across assessed applications." />

      <Tabs value={status ?? "all"} onValueChange={(v) => setParam("status", v === "all" ? "" : v)}>
        <TabsList className="mb-4">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <FilterBar>
        <SearchInput value={search} onChange={(v) => setParam("q", v)} placeholder="Search findings…" />
        <Select value={applicationId ?? ""} onChange={(e) => setParam("application", e.target.value)}>
          <option value="">All applications</option>
          {(applications ?? []).map((app) => (
            <option key={app.id} value={app.id}>
              {app.name}
            </option>
          ))}
        </Select>
        <Select value={platform ?? ""} onChange={(e) => setParam("platform", e.target.value)}>
          <option value="">All platforms</option>
          <option value="ios">iOS</option>
          <option value="android">Android</option>
        </Select>
        <Select value={severity ?? ""} onChange={(e) => setParam("severity", e.target.value)}>
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="info">Info</option>
        </Select>
      </FilterBar>

      {isLoading && <LoadingState label="Loading findings…" />}
      {isError && <ErrorState message="Unable to load findings." onRetry={() => refetch()} />}
      {!isLoading && !isError && (findings ?? []).length === 0 && (
        <EmptyState title="No findings have been recorded yet." />
      )}
      {!isLoading && (findings ?? []).length > 0 && (
        <DataTable columns={columns} rows={findings as Row[]} onRowClick={(r) => navigate(`/findings/${r.id}`)} />
      )}
    </div>
  );
}
