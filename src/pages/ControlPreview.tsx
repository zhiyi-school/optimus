import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { LoadingState, ErrorState } from "@/components/common";
import { ToneBadge } from "@/components/resolve-display";
import { EstimatedTime, GuidedSteps, type GuidedStep } from "@/components/guided-steps";
import {
  ControlGuidance,
  ControlStepBody,
  ControlStepsEmpty,
  ControlSupportingInfo,
} from "@/components/control-content";
import { WorkOnRiskButton } from "@/components/ticket-actions/remediation";
import { useControlDetail, useControlSource } from "@/hooks/queries/tickets";
import { useFinding } from "@/hooks/queries/evidence";
import { controlSummary, isRemediationControl, playbookControlStatusLabels } from "@/lib/resolve";
import { stepCountLabel } from "@/lib/utils";

export default function ControlPreview() {
  const { findingId, controlId } = useParams<{ findingId: string; controlId: string }>();
  const finding = useFinding(findingId);
  const platform = finding.data?.platform;

  const control = useControlDetail(platform, controlId);
  const source = useControlSource(platform, controlId);

  const backTo = `/findings/${findingId}`;
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
      closeLabel="Back to the finding"
      navLabel="Remediation steps"
    >
      {children}
    </GuidedSteps>
  );

  if (finding.isLoading || control.isLoading) return shell(<LoadingState label="Loading control…" />);
  if (finding.isError || !finding.data) {
    return shell(
      <ErrorState message="Unable to load this finding." onRetry={() => finding.refetch()} />,
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

  const status = playbookControlStatusLabels[control.data.status];
  const selectable = isRemediationControl(control.data);
  const navSteps: GuidedStep[] = definitionSteps.map((step, index) => ({
    id: step.step_key,
    label: step.step_title || `Step ${step.number ?? index + 1}`,
  }));
  const activeIndex = definitionSteps.findIndex((step) => step.step_key === activeStepKey);
  const activeStep = activeIndex >= 0 ? definitionSteps[activeIndex] : undefined;

  const supporting = (
    <ControlSupportingInfo
      control={control.data}
      platform={platform}
      controlId={controlId}
      source={source.data}
    >
      <div className="space-y-3 rounded-md border border-border/70 bg-muted/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={status.tone} label={status.label} />
          <ToneBadge
            tone={selectable ? "info" : "neutral"}
            label={selectable ? "Remediation approach" : "Not a remediation approach"}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          These are the developer remediation steps for this control, not the steps security uses to
          demonstrate the risk. A risk may offer several approaches; starting remediation from here
          selects this one, and you can change it later.
        </p>
        <WorkOnRiskButton
          finding={finding.data}
          application={finding.data.application}
          preferredControlId={selectable ? control.data.control_id : undefined}
        />
      </div>
    </ControlSupportingInfo>
  );

  return (
    <GuidedSteps
      icon={FileText}
      title={`Remediation Steps — ${control.data.title}`}
      description={controlSummary(control.data)}
      tipLabel="Tip"
      tip={
        <ControlGuidance
          notes={[
            !selectable &&
              `This control is marked ${control.data.status}, so it is not offered as a remediation approach.`,
            "You are previewing these steps against the finding. Nothing is recorded while you read — start remediation to track your progress.",
          ]}
        />
      }
      steps={navSteps}
      activeId={activeStepKey}
      onSelect={setChosenStepKey}
      aside={<EstimatedTime value={stepCountLabel(definitionSteps.length)} />}
      supporting={supporting}
      closeTo={backTo}
      closeLabel="Back to the finding"
      navLabel="Remediation steps"
      finishLabel="Done"
    >
      {activeStep ? (
        <ControlStepBody key={activeStep.step_key} step={activeStep} index={activeIndex} />
      ) : (
        <ControlStepsEmpty />
      )}
    </GuidedSteps>
  );
}
