/**
 * Guided remediation-steps frame shared by the control preview and the ticket's control page.
 */

import { useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { ErrorState } from "@/components/layout/page-blocks";
import { PlatformBadge } from "@/components/shared/badges-and-table";
import { EstimatedTime, GuidedSteps, type GuidedStep } from "@/components/playbook/guided-steps";
import {
  ControlStepBody,
  ControlStepsEmpty,
  type ControlStepProgress,
} from "@/components/remediation/control-content";
import { createDebug } from "@/lib/debug";
import { controlSummary } from "@/domain/remediation/control-content";
import { stepCountLabel } from "@/lib/utils";
import type { ControlDetail } from "@/automation-api/playbook-types";

const debug = createDebug("components:remediation:control-steps-view");

type ControlStepsViewProps = { backTo: string } & (
  | { control?: undefined; children: ReactNode }
  | {
      control: ControlDetail;
      /** The platform the control's playbook belongs to. */
      platform?: string;
      tip: ReactNode;
      supporting: ReactNode;
      notice?: ReactNode;
      progress?: ControlStepProgress;
      children?: undefined;
    }
);

/** Walks through a control's steps, or frames loading and error content in the same empty shell. */
export function ControlStepsView(props: ControlStepsViewProps) {
  const { backTo, control } = props;
  // Every page state renders this component, so the chosen step survives the control reloading.
  const [chosenStepKey, setChosenStepKey] = useState<string | null>(null);

  if (!control) {
    return (
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
        {props.children}
      </GuidedSteps>
    );
  }

  const { progress } = props;
  const definitionSteps = control.steps;
  const activeStepKey =
    chosenStepKey && definitionSteps.some((step) => step.step_key === chosenStepKey)
      ? chosenStepKey
      : (definitionSteps[0]?.step_key ?? null);
  const navSteps: GuidedStep[] = definitionSteps.map((step, index) => ({
    id: step.step_key,
    label: step.step_title || `Step ${step.number ?? index + 1}`,
    ...(progress && { complete: progress.byStepKey.get(step.step_key)?.status === "completed" }),
  }));
  const activeIndex = definitionSteps.findIndex((step) => step.step_key === activeStepKey);
  const activeStep = activeIndex >= 0 ? definitionSteps[activeIndex] : undefined;

  return (
    <GuidedSteps
      icon={FileText}
      title={`Remediation Steps — ${control.title}`}
      badges={props.platform && <PlatformBadge platform={props.platform} />}
      description={controlSummary(control)}
      notice={props.notice}
      tipLabel="Tip"
      tip={props.tip}
      steps={navSteps}
      activeId={activeStepKey}
      onSelect={(stepKey) => {
        debug("selects step", { controlId: control.control_id, stepKey });
        setChosenStepKey(stepKey);
      }}
      aside={<EstimatedTime value={stepCountLabel(definitionSteps.length)} />}
      supporting={props.supporting}
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
          progress={progress}
        />
      ) : (
        <ControlStepsEmpty />
      )}
    </GuidedSteps>
  );
}

/** Error shown when the automation backend cannot provide a control's remediation instructions. */
export function ControlUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <ErrorState
      message="The automation backend could not provide the remediation instructions for this control. Check that its playbook directory is configured and reachable."
      onRetry={onRetry}
    />
  );
}
