/**
 * Read-only preview of a control's remediation steps against a finding.
 */

import { useParams } from "react-router-dom";
import { LoadingState, ErrorState } from "@/components/layout/page-blocks";
import { ToneBadge } from "@/components/shared/progress-display";
import { ControlGuidance, ControlSupportingInfo } from "@/components/remediation/control-content";
import { ControlStepsView, ControlUnavailable } from "@/components/remediation/control-steps-view";
import { WorkOnRiskButton } from "@/components/remediation/remediation-actions";
import { useControlDetail, useControlSource } from "@/hooks/queries/playbook";
import { useFinding } from "@/hooks/queries/evidence";
import { createDebug } from "@/lib/debug";
import { isRemediationControl, playbookControlStatusLabels } from "@/domain/remediation/resolve-rules";
import { resolveRiskPath } from "@/routing/risk-routes";

const debug = createDebug("page:ControlPreview");

/** Shows a control's remediation steps for a finding, with an option to start remediation using it. */
export default function ControlPreview() {
  const { findingId, controlId } = useParams<{ findingId: string; controlId: string }>();
  const finding = useFinding(findingId);
  const platform = finding.data?.platform;

  const control = useControlDetail(platform, controlId);
  const source = useControlSource(platform, controlId);

  const backTo = finding.data
    ? resolveRiskPath({ applicationId: finding.data.application_id, riskId: finding.data.test_id })
    : "/resolve";

  if (finding.isLoading || control.isLoading) {
    return (
      <ControlStepsView backTo={backTo}>
        <LoadingState label="Loading control…" />
      </ControlStepsView>
    );
  }
  if (finding.isError || !finding.data) {
    return (
      <ControlStepsView backTo={backTo}>
        <ErrorState
          message="Unable to load this finding."
          onRetry={() => {
            debug("retries finding load", { findingId });
            void finding.refetch();
          }}
        />
      </ControlStepsView>
    );
  }
  if (control.isError || !control.data) {
    return (
      <ControlStepsView backTo={backTo}>
        <ControlUnavailable
          onRetry={() => {
            debug("retries control load", { platform, controlId });
            void control.refetch();
          }}
        />
      </ControlStepsView>
    );
  }

  const status = playbookControlStatusLabels[control.data.status];
  const selectable = isRemediationControl(control.data);

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
    <ControlStepsView
      backTo={backTo}
      control={control.data}
      tip={
        <ControlGuidance
          notes={[
            !selectable &&
              `This control is marked ${control.data.status}, so it is not offered as a remediation approach.`,
            "You are previewing these steps against the finding. Nothing is recorded while you read — start remediation to track your progress.",
          ]}
        />
      }
      supporting={supporting}
    />
  );
}
