import { useMemo, useRef } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { PageHeader, LoadingState, ErrorState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { PlaybookUpdatedNotice, ProgressBar, ToneBadge } from "@/components/resolve-display";
import {
  ControlIntro,
  ControlReferences,
  ControlSourceArchive,
  ControlSteps,
  type ControlStepProgress,
} from "@/components/control-content";
import {
  useControlDetail,
  useControlSource,
  usePlaybookRevisionWatch,
  useSetControlStepStatus,
  useTicket,
  useTicketControlSteps,
  useTicketControls,
} from "@/hooks/queries";
import {
  changedSinceCompleted,
  contentHashes,
  controlStatusLabels,
  liveControls,
} from "@/lib/resolve";

export default function ControlDetail() {
  const { ticketId, controlId } = useParams<{ ticketId: string; controlId: string }>();
  const { can } = useAuth();
  const inResolve = useLocation().pathname.startsWith("/resolve/");
  const backTo = `${inResolve ? "/resolve" : ""}/tickets/${ticketId}`;

  const ticket = useTicket(ticketId);
  const platform = ticket.data?.finding?.platform ?? ticket.data?.application?.platform;

  const control = useControlDetail(platform, controlId);
  const controls = useTicketControls(ticketId);
  const steps = useTicketControlSteps(ticketId);
  const source = useControlSource(platform, controlId);
  const setStatus = useSetControlStepStatus(ticketId);

  const playbook = usePlaybookRevisionWatch(platform, !!ticketId);

  const live = useMemo(
    () =>
      liveControls(
        control.data ? [control.data] : undefined,
        controls.data ?? [],
        steps.data ?? [],
      ).find((entry) => entry.definition.control_id === controlId),
    [control.data, controls.data, steps.data, controlId],
  );

  const hashesAtLoad = useRef<Map<string, string> | undefined>();
  if (control.data && hashesAtLoad.current === undefined) {
    hashesAtLoad.current = contentHashes(control.data.steps);
  }

  const stepProgress: ControlStepProgress = useMemo(
    () => ({
      byStepKey: new Map(
        (live?.steps ?? []).flatMap((entry) => (entry.row ? [[entry.step.step_key, entry.row]] : [])),
      ),
      needsReview: changedSinceCompleted(live?.steps ?? [], hashesAtLoad.current),
      editable: can("update_control_progress"),
      pending: setStatus.isPending,
      error: setStatus.isError ? setStatus.error : null,
      setStatus: (stepId, status, note) => setStatus.mutate({ stepId, status, note }),
    }),
    [live, can, setStatus],
  );

  if (ticket.isLoading || control.isLoading) return <LoadingState label="Loading control…" />;
  if (ticket.isError || !ticket.data) {
    return <ErrorState message="Unable to load this remediation." onRetry={() => ticket.refetch()} />;
  }
  if (control.isError || !control.data) {
    return (
      <div>
        <BackLink to={backTo} />
        <ErrorState
          message="The automation backend could not provide the remediation instructions for this control. Check that its playbook directory is configured and reachable."
          onRetry={() => control.refetch()}
        />
      </div>
    );
  }

  const presentation = controlStatusLabels[live?.status ?? "not_started"];
  const progress = live?.progress ?? { completed: 0, total: 0, ratio: 0 };

  return (
    <div>
      {playbook.updated && <PlaybookUpdatedNotice onDismiss={playbook.dismiss} />}
      <BackLink to={backTo} />

      <PageHeader
        title={control.data.title}
        description={control.data.summary}
        actions={<ToneBadge tone={presentation.tone} label={presentation.label} />}
      />

      <Card className="mb-6">
        <CardContent className="space-y-3 py-4">
          <ProgressBar label="Steps completed" progress={progress} />
          <p className="text-xs text-muted-foreground">
            These are the developer remediation steps for this control. They are not the steps
            security uses to demonstrate the risk.
          </p>
          {!stepProgress.editable && (
            <p className="text-xs text-muted-foreground">
              You are reading this control. Only the developers assigned to this application can
              record progress against its steps.
            </p>
          )}
          {control.data.status !== "active" && (
            <p className="text-xs text-muted-foreground">
              This control is marked <strong>{control.data.status}</strong> and is not counted as
              required remediation work.
            </p>
          )}
        </CardContent>
      </Card>

      <ControlIntro control={control.data} />
      <ControlSteps control={control.data} progress={stepProgress} />
      <ControlReferences control={control.data} />
      <ControlSourceArchive platform={platform} controlId={controlId} source={source.data} />
    </div>
  );
}

function BackLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to remediation
    </Link>
  );
}
