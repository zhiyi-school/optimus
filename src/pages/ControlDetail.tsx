import { useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { LoadingState, ErrorState } from "@/components/common";
import { PlaybookUpdatedNotice } from "@/components/resolve-display";
import { EstimatedTime, GuidedSteps, type GuidedStep } from "@/components/guided-steps";
import {
  ControlGuidance,
  ControlStepBody,
  ControlStepsEmpty,
  ControlSupportingInfo,
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
import { changedSinceCompleted, contentHashes, controlSummary, liveControls } from "@/lib/resolve";
import { resolveRiskPath } from "@/lib/legacy-routes";
import { stepCountLabel } from "@/lib/utils";

export default function ControlDetail() {
  const { ticketId, controlId } = useParams<{ ticketId: string; controlId: string }>();
  const { can } = useAuth();

  const ticket = useTicket(ticketId);
  const platform = ticket.data?.finding?.platform ?? ticket.data?.application?.platform;
  // Closing returns to the risk page that holds the conversation, never to a ticket page.
  const backTo = ticket.data
    ? resolveRiskPath({
        applicationId: ticket.data.application_id,
        riskId: ticket.data.finding?.test_id,
      })
    : "/resolve";

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

  const shell = (children: ReactNode) => (
    <GuidedSteps
      icon={FileText}
      title="Remediation Steps"
      steps={[]}
      activeId={null}
      onSelect={() => {}}
      closeTo={backTo}
      closeLabel="Back to the risk"
      navLabel="Remediation steps"
    >
      {children}
    </GuidedSteps>
  );

  if (ticket.isLoading || control.isLoading) return shell(<LoadingState label="Loading control…" />);
  if (ticket.isError || !ticket.data) {
    return shell(
      <ErrorState message="Unable to load this remediation." onRetry={() => ticket.refetch()} />,
    );
  }
  if (control.isError || !control.data) {
    return shell(
      <ErrorState
        message="The automation backend could not provide the remediation instructions for this control. Check that its playbook directory is configured and reachable."
        onRetry={() => control.refetch()}
      />,
    );
  }

  const navSteps: GuidedStep[] = definitionSteps.map((step, index) => ({
    id: step.step_key,
    label: step.step_title || `Step ${step.number ?? index + 1}`,
    complete: stepProgress.byStepKey.get(step.step_key)?.status === "completed",
  }));
  const activeIndex = definitionSteps.findIndex((step) => step.step_key === activeStepKey);
  const activeStep = activeIndex >= 0 ? definitionSteps[activeIndex] : undefined;

  const supporting = (
    <ControlSupportingInfo
      control={control.data}
      platform={platform}
      controlId={controlId}
      source={source.data}
    />
  );

  return (
    <GuidedSteps
      icon={FileText}
      title={`Remediation Steps — ${control.data.title}`}
      description={controlSummary(control.data)}
      notice={playbook.updated ? <PlaybookUpdatedNotice onDismiss={playbook.dismiss} /> : undefined}
      tipLabel="Tip"
      tip={
        <ControlGuidance
          notes={[
            control.data.status !== "active" &&
              `This control is marked ${control.data.status} and is not counted as required remediation work.`,
            stepProgress.editable
              ? "Implement the recommended fix, then verify it. Mark each step complete as you go."
              : "You are reading this control. Only the developers assigned to this application can record progress against its steps.",
          ]}
        />
      }
      steps={navSteps}
      activeId={activeStepKey}
      onSelect={setChosenStepKey}
      aside={<EstimatedTime value={stepCountLabel(definitionSteps.length)} />}
      supporting={supporting}
      closeTo={backTo}
      closeLabel="Back to the risk"
      navLabel="Remediation steps"
      finishLabel="Done"
    >
      {activeStep ? (
        <ControlStepBody
          key={activeStep.step_key}
          step={activeStep}
          index={activeIndex}
          progress={stepProgress}
        />
      ) : (
        <ControlStepsEmpty />
      )}
    </GuidedSteps>
  );
}
