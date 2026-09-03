import { Check, HelpCircle, Loader2, Minus, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  assessmentRunState,
  isTransitionalRunState,
  normalizeAssessmentStages,
  type AssessmentStagePresentation,
} from "@/lib/status";
import { cn, errorMessage, formatDate } from "@/lib/utils";
import { useAppProvisioning, useAssessmentRunRequest, useRequestAssessmentRun, useTickets } from "@/hooks/queries";
import type { ProvisioningStage } from "@/api/automation-types";
import type { Application, Assessment } from "@/data/types";

const LIFECYCLE_LINE_CLASS: Record<AssessmentStagePresentation["lifecycle"], string> = {
  complete: "bg-primary/40",
  current: "bg-primary/40",
  failed: "bg-danger/30",
  unknown: "bg-border",
  future: "bg-border",
  not_applicable: "bg-border",
};

const LIFECYCLE_TEXT_CLASS: Record<AssessmentStagePresentation["lifecycle"], string> = {
  complete: "text-foreground",
  current: "text-primary",
  failed: "text-danger",
  unknown: "text-muted-foreground",
  future: "text-muted-foreground",
  not_applicable: "text-muted-foreground",
};

/** Only the current stage's color varies by tone — its icon never does. */
function currentToneTextClass(tone: AssessmentStagePresentation["tone"]): string {
  if (tone === "warning" || tone === "danger") return "text-warning";
  return "text-primary";
}

function StageIcon({ stage }: { stage: AssessmentStagePresentation }) {
  switch (stage.lifecycle) {
    case "complete":
      return (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3.5 w-3.5" />
        </div>
      );
    case "current":
      return (
        <Loader2
          aria-hidden="true"
          className="h-6 w-6 shrink-0 animate-spin text-primary motion-reduce:animate-none"
        />
      );
    case "failed":
      return (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-danger text-white">
          <X className="h-3.5 w-3.5" />
        </div>
      );
    case "unknown":
      return (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-border text-muted-foreground">
          <HelpCircle className="h-3.5 w-3.5" />
        </div>
      );
    case "not_applicable":
      return (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-border text-muted-foreground">
          <Minus className="h-3.5 w-3.5" />
        </div>
      );
    case "future":
      return <div className="h-6 w-6 shrink-0 rounded-full border-2 border-border" />;
  }
}

/**
 * A sequential stepper: at most one stage is ever "current", so at most one
 * spinner is ever on screen. Icon shape comes strictly from `lifecycle`;
 * `tone` only tints the current stage's text (e.g. amber while waiting).
 */
function StageList({ stages }: { stages: AssessmentStagePresentation[] }) {
  return (
    <ol>
      {stages.map((stage, i) => (
        <li
          key={stage.id}
          className="flex gap-3"
          aria-current={stage.lifecycle === "current" ? "step" : undefined}
        >
          <div className="flex flex-col items-center">
            <StageIcon stage={stage} />
            {i < stages.length - 1 && (
              <div className={cn("w-px flex-1", LIFECYCLE_LINE_CLASS[stage.lifecycle])} />
            )}
          </div>
          <div className={cn("pb-5", i === stages.length - 1 && "pb-0")}>
            <p
              className={cn(
                "text-sm font-semibold",
                stage.lifecycle === "current"
                  ? currentToneTextClass(stage.tone)
                  : LIFECYCLE_TEXT_CLASS[stage.lifecycle],
              )}
            >
              {stage.label}
            </p>
            {stage.description && (
              <p className="text-xs text-muted-foreground">{stage.description}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Setup and run progress, normalized into one sequential stepper. See
 * `normalizeAssessmentStages` for how configuration and testing readiness —
 * two independent sources — combine into a single current stage.
 */
export function EnvironmentSetupStages({
  configurationReady = false,
  stages: reported,
  assessment,
  runState,
}: {
  configurationReady?: boolean;
  stages?: ProvisioningStage[];
  assessment?: Pick<Assessment, "status" | "completed_tests" | "total_tests"> | null;
  runState: ReturnType<typeof assessmentRunState>;
}) {
  const stages = normalizeAssessmentStages({
    configurationReady,
    provisioningStages: reported?.map((s) => ({
      id: s.id,
      label: s.label,
      description: s.detail || undefined,
      state: s.state,
    })),
    runState,
    assessment,
  });
  return <StageList stages={stages} />;
}

/** Execution and reporting only — the environment is already set up by this point. */
export function TestRunStages({
  testingDescription = "Automated security testing is now in progress.",
}: {
  testingDescription?: string;
}) {
  const stages: AssessmentStagePresentation[] = [
    { id: "testing", label: "Testing has begun", description: testingDescription, lifecycle: "current", tone: "info" },
    {
      id: "analysis",
      label: "Analysis & reporting",
      description: "Results will be analyzed and the report will be generated.",
      lifecycle: "future",
    },
  ];
  return <StageList stages={stages} />;
}

/**
 * The expanded status panel for one incomplete assessment row. This is where
 * setup, blocker and retry information lives — not the assessment-results
 * workspace, which only opens once testing is complete.
 */
export function AssessmentStatusPanel({
  assessment,
  canRetry,
}: {
  assessment: Assessment & { application: Application | null };
  canRetry: boolean;
}) {
  const application = assessment.application;
  const platform = application?.platform;

  const runRequest = useAssessmentRunRequest(assessment.id, assessment);
  const runState = assessmentRunState(assessment, runRequest.data);
  const requestRun = useRequestAssessmentRun(assessment.id);

  const unsettled = isTransitionalRunState(assessment, runRequest.data);
  const { data: provisioning } = useAppProvisioning(platform, application?.external_id ?? undefined, {
    poll: unsettled,
  });

  // Some backends have no live readiness endpoint; a closed provisioning
  // ticket is the fallback signal that setup is actually done.
  const { data: provisioningTickets } = useTickets(
    application?.id ? { type: "app_provisioning", applicationId: application.id } : {},
  );
  const provisioningTicket = application?.id ? provisioningTickets?.[0] : undefined;
  const ticketDone = !!provisioningTicket && ["closed", "accepted"].includes(provisioningTicket.status);
  const configurationReady = provisioning
    ? (provisioning.configuration_ready ?? provisioning.status === "ready")
    : ticketDone;

  const showRetry = canRetry && runState.canRetry;

  return (
    <div>
      <p className="mb-3 text-sm text-foreground">
        {runState.detail ||
          (runState.tone === "info"
            ? "Tests are running on the backend."
            : configurationReady
              ? `${application?.name ?? "This app"} is set up. ${runState.label}.`
              : `We're preparing an environment for ${application?.name ?? "this app"}. You can safely leave this page and come back.`)}
      </p>

      {runState.autoRetry && (
        <p className="mb-3 -mt-2 text-xs text-muted-foreground">
          This retries automatically
          {runState.nextAttemptAt ? `, next at ${formatDate(runState.nextAttemptAt)}` : ""}.
        </p>
      )}

      <p className="mb-2 text-sm font-semibold text-foreground">Activities</p>
      <EnvironmentSetupStages
        configurationReady={configurationReady}
        stages={provisioning?.stages}
        assessment={assessment}
        runState={runState}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {showRetry && (
          <Button
            size="sm"
            variant="outline"
            disabled={requestRun.isPending}
            onClick={() => requestRun.mutate()}
          >
            {requestRun.isPending ? "Retrying…" : "Retry now"}
          </Button>
        )}
        {runState.needsConfiguration && application && (
          <Link
            to={`/settings?app=${application.id}`}
            className="text-xs font-medium text-primary hover:underline"
          >
            Review the app configuration →
          </Link>
        )}
        {provisioningTicket && !configurationReady && (
          <Link
            to={`/settings?app=${application?.id ?? ""}`}
            className="text-xs font-medium text-primary hover:underline"
          >
            Open app provisioning setup →
          </Link>
        )}
      </div>

      {requestRun.isError && (
        <p className="mt-2 text-xs text-danger">
          {errorMessage(requestRun.error, "Could not queue this assessment for testing.")}
        </p>
      )}
    </div>
  );
}
