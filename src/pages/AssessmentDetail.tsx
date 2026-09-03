import { useEffect, useMemo, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { errorMessage, formatDate } from "@/lib/utils";
import { assessmentRunState } from "@/lib/status";
import { LoadingState, ErrorState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToneBadge } from "@/components/resolve-display";
import { AssessmentSidebar } from "@/components/assessment-sidebar";
import { EnvironmentSetupStages } from "@/components/assessment-progress";
import {
  useAppProvisioning,
  useAssessment,
  useAssessmentRunRequest,
  useFindings,
  useRequestAssessmentRun,
  useRiskCatalogue,
  useTickets,
  useUpdateApplication,
} from "@/hooks/queries";
import type { Application, Finding } from "@/data/types";

export default function AssessmentDetail() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const { can } = useAuth();
  const canRunTest = can("run_test");
  const { data: assessment, isLoading, isError, refetch } = useAssessment(assessmentId);
  const application = assessment?.application;
  const platform = application?.platform;
  const { data: risks } = useRiskCatalogue(platform);
  const { data: findings } = useFindings({ applicationId: assessment?.application_id });

  const { data: provisioningTickets } = useTickets(
    assessment?.application_id
      ? { type: "app_provisioning", applicationId: assessment.application_id }
      : {},
  );
  const provisioningTicket = assessment?.application_id ? provisioningTickets?.[0] : undefined;

  const runRequest = useAssessmentRunRequest(assessmentId, assessment);
  const run = assessmentRunState(assessment, runRequest.data);
  const requestRun = useRequestAssessmentRun(assessmentId);

  // Device readiness is decided apart from configuration, so setup progress is
  // still polled while the assessment has not started.
  const unsettled = assessment?.status === "queued" || assessment?.status === "waiting";
  const { data: provisioning } = useAppProvisioning(platform, application?.external_id, {
    poll: unsettled,
  });

  // Mirrored into Supabase so other sessions see it without polling too.
  const updateApplication = useUpdateApplication();
  const updateApplicationStatus = updateApplication.mutate;
  const reconciledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!application || !provisioning) return;
    if (provisioning.status === application.provisioning_status) return;
    if (reconciledRef.current === `${application.id}:${provisioning.status}`) return;
    reconciledRef.current = `${application.id}:${provisioning.status}`;
    updateApplicationStatus({
      applicationId: application.id,
      patch: {
        provisioning_status: provisioning.status,
        provisioning_error: provisioning.error ?? null,
        ...(provisioning.bundle_id ? { identifier: provisioning.bundle_id } : {}),
      },
    });
  }, [provisioning, application, updateApplicationStatus]);

  const findingByTestId = useMemo(() => {
    const map = new Map<string, Finding & { application: Application | null }>();
    for (const f of findings ?? []) {
      if (f.test_id) map.set(f.test_id, f);
    }
    return map;
  }, [findings]);

  if (isLoading) return <LoadingState label="Loading assessment…" />;
  if (isError || !assessment)
    return <ErrorState message="Unable to load this assessment." onRetry={() => refetch()} />;

  const ticketDone =
    !!provisioningTicket && ["closed", "accepted"].includes(provisioningTicket.status);
  const backendStatus = provisioning?.status ?? application?.provisioning_status ?? null;
  const setupReady = backendStatus ? backendStatus === "ready" : ticketDone;
  const setupFailed = backendStatus === "failed";
  const setupError = provisioning?.error ?? application?.provisioning_error ?? null;
  const settingUp = assessment.status !== "completed";
  const showRetry = canRunTest && run.canRetry;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <AssessmentSidebar
          application={assessment.application}
          assessment={assessment}
          risks={risks}
          findingByTestId={findingByTestId}
        />
      </div>

      <div className="space-y-6 lg:col-span-2">
        {settingUp && (
          <Card className={run.tone === "danger" ? "border-danger/50" : "border-primary/40"}>
            <CardContent className="py-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  {setupFailed ? "Setup couldn't be completed" : run.label}
                </h2>
                <ToneBadge tone={run.tone} label={run.label} />
              </div>

              <p className="mb-4 mt-1 text-sm text-muted-foreground">
                {setupFailed
                  ? `${application?.name ?? "This app"} can't be tested yet — resolve the step below and it'll re-check automatically.`
                  : run.detail ||
                    (setupReady
                      ? `${application?.name ?? "This app"} is provisioned. You can safely leave this page — testing continues on the automation host.`
                      : `We're preparing an environment for ${application?.name ?? "this app"}. You can safely leave this page and come back.`)}
              </p>

              {run.autoRetry && (
                <p className="mb-4 -mt-2 text-xs text-muted-foreground">
                  This retries automatically
                  {run.nextAttemptAt ? `, next at ${formatDate(run.nextAttemptAt)}` : ""}.
                </p>
              )}

              <EnvironmentSetupStages
                ready={setupReady}
                stages={provisioning?.stages}
                assessment={assessment}
              />

              {setupError && <p className="mt-3 text-xs text-danger">{setupError}</p>}

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
                {run.needsConfiguration && application && (
                  <Link
                    to={`/settings?app=${application.id}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Review the app configuration →
                  </Link>
                )}
                {provisioningTicket && !setupReady && (
                  <Link
                    to={`/tickets/${provisioningTicket.id}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Track provisioning ticket →
                  </Link>
                )}
              </div>

              {requestRun.isError && (
                <p className="mt-2 text-xs text-danger">
                  {errorMessage(requestRun.error, "Could not queue this assessment for testing.")}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
