/**
 * Remediation control page where developers work through and record control steps.
 */

import { useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/auth/auth-context";
import { LoadingState, ErrorState } from "@/components/layout/page-blocks";
import { PlaybookUpdatedNotice } from "@/components/shared/progress-display";
import {
  ControlGuidance,
  ControlSupportingInfo,
  type ControlStepProgress,
} from "@/components/remediation/control-content";
import { ControlStepsView, ControlUnavailable } from "@/components/remediation/control-steps-view";
import {
  useSetControlStepStatus,
  useTicketControlSteps,
  useTicketControls,
} from "@/hooks/queries/control-progress";
import { useControlDetail, useControlSource, usePlaybookRevisionWatch } from "@/hooks/queries/playbook";
import { useTicket } from "@/hooks/queries/tickets";
import { useActiveRiskAcceptance } from "@/hooks/queries/risk-acceptance";
import { RISK_ACCEPTED_REMEDIATION_PAUSED } from "@/domain/remediation/workflow-messages";
import { createDebug } from "@/lib/debug";
import { changedSinceCompleted, contentHashes } from "@/domain/remediation/control-content";
import { liveControls } from "@/domain/remediation/resolve-rules";
import { resolveRiskPath } from "@/routing/risk-routes";

const debug = createDebug("pages:resolve:control-detail");

/** Shows a ticket's control steps with progress tracking, flagging steps changed since completion. */
export default function ControlDetail() {
  const { ticketId, controlId } = useParams<{ ticketId: string; controlId: string }>();
  const { can } = useAuth();

  const ticket = useTicket(ticketId);
  const platform = ticket.data?.finding?.platform ?? ticket.data?.application?.platform;
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
  const riskAccepted = !!useActiveRiskAcceptance(ticket.data?.finding_id ?? undefined).data;

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
      editable: can("update_control_progress") && !riskAccepted,
      pending: setStatus.isPending,
      error: setStatus.isError ? setStatus.error : null,
      setStatus: (stepId, status, note) => {
        debug("sets step status", { stepId, status, noteLength: note?.length ?? 0 });
        setStatus.mutate(
          { stepId, status, note },
          {
            onSuccess: () => debug("saves step status", { stepId, status }),
            onError: (error) => debug("fails to save step status", { stepId, status, error }),
          },
        );
      },
    }),
    [live, can, setStatus, riskAccepted],
  );

  if (ticket.isLoading || control.isLoading) {
    return (
      <ControlStepsView backTo={backTo}>
        <LoadingState label="Loading control…" />
      </ControlStepsView>
    );
  }
  if (ticket.isError || !ticket.data) {
    return (
      <ControlStepsView backTo={backTo}>
        <ErrorState
          message="Unable to load this remediation."
          onRetry={() => {
            debug("retries remediation load", { ticketId });
            void ticket.refetch();
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

  const supporting = (
    <ControlSupportingInfo
      control={control.data}
      platform={platform}
      controlId={controlId}
      source={source.data}
    />
  );

  return (
    <ControlStepsView
      backTo={backTo}
      control={control.data}
      notice={
        playbook.updated ? (
          <PlaybookUpdatedNotice
            onDismiss={() => {
              debug("dismisses playbook update notice", { platform });
              playbook.dismiss();
            }}
          />
        ) : undefined
      }
      tip={
        <ControlGuidance
          notes={[
            control.data.status !== "active" &&
              `This control is marked ${control.data.status} and is not counted as required remediation work.`,
            riskAccepted
              ? RISK_ACCEPTED_REMEDIATION_PAUSED
              : stepProgress.editable
                ? "Implement the recommended fix, then verify it. Mark each step complete as you go."
                : "You are reading this control. Only the developers assigned to this application can record progress against its steps.",
          ]}
        />
      }
      supporting={supporting}
      progress={stepProgress}
    />
  );
}
