import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { LoadingState, ErrorState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { ToneBadge } from "@/components/resolve-display";
import { EstimatedTime, GuidedSteps, type GuidedStep } from "@/components/guided-steps";
import {
  ControlIntro,
  ControlReferences,
  ControlSourceArchive,
  ControlStepBody,
  ControlStepsEmpty,
} from "@/components/control-content";
import { WorkOnRiskButton } from "@/components/ticket-actions";
import { useControlDetail, useControlSource, useFinding } from "@/hooks/queries";
import { isRemediationControl, playbookControlStatusLabels } from "@/lib/resolve";

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

  if (finding.isLoading || control.isLoading) return <LoadingState label="Loading control…" />;
  if (finding.isError || !finding.data) {
    return <ErrorState message="Unable to load this finding." onRetry={() => finding.refetch()} />;
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

  const status = playbookControlStatusLabels[control.data.status];
  const selectable = isRemediationControl(control.data);
  const navSteps: GuidedStep[] = definitionSteps.map((step, index) => ({
    id: step.step_key,
    label: step.step_title || `Step ${step.number ?? index + 1}`,
  }));
  const activeIndex = definitionSteps.findIndex((step) => step.step_key === activeStepKey);
  const activeStep = activeIndex >= 0 ? definitionSteps[activeIndex] : undefined;

  return (
    <div>
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
            selectable
              ? "You are previewing these steps against the finding. Nothing is recorded while you read — start remediation to track your progress."
              : `This control is marked ${control.data.status}, so it is not offered as a remediation approach.`
          }
          steps={navSteps}
          activeId={activeStepKey}
          onSelect={setChosenStepKey}
          aside={
            <EstimatedTime>
              {definitionSteps.length === 1 ? "1 step" : `${definitionSteps.length} steps`}
            </EstimatedTime>
          }
          closeTo={backTo}
          closeLabel="Back to the finding"
          navLabel="Remediation steps"
          finishLabel="Done"
        >
          {activeStep && (
            <ControlStepBody key={activeStep.step_key} step={activeStep} index={activeIndex} />
          )}
        </GuidedSteps>
      )}

      <div className="mx-auto max-w-5xl">
        <Card className="mt-4">
          <CardContent className="space-y-3 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <ToneBadge tone={status.tone} label={status.label} />
              <ToneBadge
                tone={selectable ? "info" : "neutral"}
                label={selectable ? "Remediation approach" : "Not a remediation approach"}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              These are the developer remediation steps for this control, not the steps security
              uses to demonstrate the risk. A risk may offer several approaches; starting
              remediation from here selects this one, and you can change it later.
            </p>
            <WorkOnRiskButton
              finding={finding.data}
              application={finding.data.application}
              preferredControlId={selectable ? control.data.control_id : undefined}
            />
          </CardContent>
        </Card>

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
      Back to the finding
    </Link>
  );
}
