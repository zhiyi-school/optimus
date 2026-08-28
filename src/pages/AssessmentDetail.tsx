import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/useAuth";
import { syncService } from "@/data/sync";
import { errorMessage } from "@/lib/utils";
import { automatedRiskIds } from "@/lib/risk-automation";
import { LoadingState, ErrorState, DismissibleBanner } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { AssessmentSidebar } from "@/components/assessment-sidebar";
import { EnvironmentSetupStages } from "@/components/assessment-progress";
import { ConversationPanel } from "@/components/conversation-panel";
import {
  useAppProvisioning,
  useAssessment,
  useAssessmentMessages,
  useFindings,
  useProfiles,
  useRiskCatalogue,
  useSendAssessmentMessage,
  useTickets,
  useUpdateApplication,
} from "@/hooks/queries";
import type { Application, Finding } from "@/data/types";

interface ProvisioningTicketState {
  provisioningTicket?: { id: string; title: string };
}

export default function AssessmentDetail() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, can } = useAuth();
  const queryClient = useQueryClient();
  const { data: assessment, isLoading, isError, refetch } = useAssessment(assessmentId);
  const application = assessment?.application;
  const platform = application?.platform;
  const { data: risks } = useRiskCatalogue(platform);
  const { data: findings } = useFindings({ applicationId: assessment?.application_id });
  const { data: profiles } = useProfiles();
  const { data: messages, isLoading: messagesLoading } = useAssessmentMessages(assessmentId);
  const sendMessage = useSendAssessmentMessage(assessmentId ?? "");

  const { data: provisioningTickets } = useTickets(
    assessment?.application_id
      ? { type: "app_provisioning", applicationId: assessment.application_id }
      : {},
  );
  const provisioningTicket = assessment?.application_id ? provisioningTickets?.[0] : undefined;

  const awaitingSetup = application?.provisioning_status === "pending";
  const { data: provisioning } = useAppProvisioning(platform, application?.external_id, {
    poll: awaitingSetup,
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

  // Trigger 1: start the full test run as soon as setup completes. A stage
  // reported "unknown" was never actually verified (no device connected, for
  // instance), so it does not count as ready for an unattended run even though
  // it doesn't block the overall status.
  const [autoStartError, setAutoStartError] = useState<string | null>(null);
  const autoStartedRef = useRef(false);
  const verifiedReady =
    provisioning?.status === "ready" && !provisioning.stages.some((s) => s.state === "unknown");
  const runnableRiskIds = useMemo(() => automatedRiskIds(risks), [risks]);
  useEffect(() => {
    if (!can("run_test") || autoStartedRef.current) return;
    if (!verifiedReady || !assessment || assessment.status !== "queued") return;
    if (!platform || !application?.external_id) return;
    if (runnableRiskIds.length === 0) return;
    autoStartedRef.current = true;
    void syncService
      .runAllTests({
        assessmentId: assessment.id,
        platform,
        appExternalId: application.external_id,
        riskIds: runnableRiskIds,
        triggeredBy: profile?.id ?? null,
      })
      .then(() => queryClient.invalidateQueries({ queryKey: ["assessment", assessmentId] }))
      .catch((err) => {
        autoStartedRef.current = false;
        setAutoStartError(errorMessage(err, "Automated testing could not be started."));
      });
  }, [
    verifiedReady,
    assessment,
    platform,
    application?.external_id,
    runnableRiskIds,
    can,
    profile?.id,
    queryClient,
    assessmentId,
  ]);

  const [justCreated, setJustCreated] = useState(
    () => (location.state as ProvisioningTicketState | null)?.provisioningTicket,
  );

  useEffect(() => {
    if (!(location.state as ProvisioningTicketState | null)?.provisioningTicket) return;
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  const findingByTestId = useMemo(() => {
    const map = new Map<string, Finding & { application: Application | null }>();
    for (const f of findings ?? []) {
      if (f.test_id) map.set(f.test_id, f);
    }
    return map;
  }, [findings]);

  const profileMap = useMemo(() => new Map((profiles ?? []).map((p) => [p.id, p])), [profiles]);

  if (isLoading) return <LoadingState label="Loading assessment…" />;
  if (isError || !assessment)
    return <ErrorState message="Unable to load this assessment." onRetry={() => refetch()} />;

  const ticketDone =
    !!provisioningTicket && ["closed", "accepted"].includes(provisioningTicket.status);
  const backendStatus = provisioning?.status ?? application?.provisioning_status ?? null;
  const setupReady = backendStatus ? backendStatus === "ready" : ticketDone;
  const setupFailed = backendStatus === "failed";
  const settingUp = assessment.status === "queued" || assessment.status === "running";
  const setupError = provisioning?.error ?? application?.provisioning_error ?? null;

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
        {justCreated && (
          <DismissibleBanner
            tone="success"
            message={`Assessment created. A provisioning ticket was opened for "${justCreated.title}".`}
            action={
              <Link
                to={`/tickets/${justCreated.id}`}
                className="text-xs font-medium hover:underline"
              >
                View ticket →
              </Link>
            }
            onDismiss={() => setJustCreated(undefined)}
          />
        )}

        {settingUp && (
          <Card className={setupFailed ? "border-danger/50" : "border-primary/40"}>
            <CardContent className="py-5">
              <h2 className="text-sm font-semibold text-foreground">
                {setupFailed
                  ? "Setup couldn't be completed"
                  : setupReady
                    ? "Environment is ready"
                    : "Setting up assessment environment"}
              </h2>
              <p className="mb-4 mt-1 text-sm text-muted-foreground">
                {setupFailed
                  ? `${application?.name ?? "This app"} can't be tested yet — resolve the step below and it'll re-check automatically.`
                  : setupReady
                    ? `${application?.name ?? "This app"} is provisioned and ready — pick a security test to get started.`
                    : `We're preparing an environment for ${application?.name ?? "this app"}. You can safely leave this page and come back — security tests can be run once setup is done.`}
              </p>
              <EnvironmentSetupStages
                ready={setupReady}
                stages={provisioning?.stages}
                assessment={assessment}
              />
              {setupError && <p className="mt-3 text-xs text-danger">{setupError}</p>}
              {autoStartError && <p className="mt-3 text-xs text-danger">{autoStartError}</p>}
              {provisioningTicket && !setupReady && (
                <Link
                  to={`/tickets/${provisioningTicket.id}`}
                  className="mt-4 inline-block text-xs font-medium text-primary hover:underline"
                >
                  Track provisioning ticket →
                </Link>
              )}
            </CardContent>
          </Card>
        )}

        <ConversationPanel
          messages={messages}
          isLoading={messagesLoading}
          currentProfileId={profile?.id}
          profileMap={profileMap}
          canComment={can("comment_ticket")}
          onSend={(message) => sendMessage.mutateAsync(message)}
          sending={sendMessage.isPending}
          emptyStateDescription="Discuss this assessment with the rest of the team."
        />
      </div>
    </div>
  );
}
