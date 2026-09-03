import { useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { LoadingState, ErrorState } from "@/components/common";
import { PlaybookUpdatedNotice, ProgressBar } from "@/components/resolve-display";
import { EstimatedTime, GuidedSteps, type GuidedStep } from "@/components/guided-steps";
import {
  ControlIntro,
  ControlReferences,
  ControlSourceArchive,
  ControlStepBody,
  ControlStepsEmpty,
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
import { changedSinceCompleted, contentHashes, liveControls } from "@/lib/resolve";

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

  const definitionSteps = control.data?.steps ?? [];
  const [chosenStepKey, setChosenStepKey] = useState<string | null>(null);
  const activeStepKey =
    chosenStepKey && definitionSteps.some((step) => step.step_key === chosenStepKey)
      ? chosenStepKey
      : (definitionSteps[0]?.step_key ?? null);

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

  const progress = live?.progress ?? { completed: 0, total: 0, ratio: 0 };
  const navSteps: GuidedStep[] = definitionSteps.map((step, index) => ({
    id: step.step_key,
    label: step.step_title || `Step ${step.number ?? index + 1}`,
    complete: stepProgress.byStepKey.get(step.step_key)?.status === "completed",
  }));
  const activeIndex = definitionSteps.findIndex((step) => step.step_key === activeStepKey);
  const activeStep = activeIndex >= 0 ? definitionSteps[activeIndex] : undefined;

  return (
    <div>
      {playbook.updated && <PlaybookUpdatedNotice onDismiss={playbook.dismiss} />}

      {definitionSteps.length === 0 ? (
        <div>
          <BackLink to={backTo} />
          <ControlStepsEmpty />
        </div>
      ) : (
        <GuidedSteps
          icon={FileText}
          title={`Remediation Steps — ${control.data.title}`}
          description={control.data.summary ?? undefined}
          tip={
            control.data.status !== "active"
              ? `This control is marked ${control.data.status} and is not counted as required remediation work.`
              : stepProgress.editable
                ? "Implement the recommended fix, then verify it. Mark each step complete as you go."
                : "You are reading this control. Only the developers assigned to this application can record progress against its steps."
          }
          steps={navSteps}
          activeId={activeStepKey}
          onSelect={setChosenStepKey}
          aside={
            <div className="hidden space-y-3 lg:block">
              <div className="rounded-md border border-border/70 bg-muted/40 p-3">
                <ProgressBar label="Steps completed" progress={progress} />
              </div>
              <EstimatedTime>
                {definitionSteps.length === 1 ? "1 step" : `${definitionSteps.length} steps`}
              </EstimatedTime>
            </div>
          }
          closeTo={backTo}
          closeLabel="Back to remediation"
          navLabel="Remediation steps"
          finishLabel="Done"
        >
          {activeStep && (
            <ControlStepBody
              key={activeStep.step_key}
              step={activeStep}
              index={activeIndex}
              progress={stepProgress}
            />
          )}
        </GuidedSteps>
      )}

      <div className="mx-auto max-w-5xl">
        <ControlIntro control={control.data} />
        <ControlReferences control={control.data} />
        <ControlSourceArchive platform={platform} controlId={controlId} source={source.data} />
      </div>
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
