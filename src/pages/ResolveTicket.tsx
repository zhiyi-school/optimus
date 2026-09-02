import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Paperclip } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { PageHeader, LoadingState, ErrorState, EmptyState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ApplicationIcon } from "@/components/application-icon";
import { PlatformBadge, SeverityBadge, StatusBadge } from "@/components/data-display";
import { ConversationPanel } from "@/components/conversation-panel";
import { ControlChecklist } from "@/components/control-checklist";
import {
  ResumeRemediationButton,
  WithdrawRemediationDialog,
  WithdrawalNotice,
} from "@/components/ticket-actions";
import { EvidenceViewer } from "@/components/evidence";
import { Timeline } from "@/components/timeline";
import { PlaybookUpdatedNotice, ProgressBar, ToneBadge } from "@/components/resolve-display";
import {
  useActivity,
  useFindingEvidenceItems,
  usePlaybookRevisionWatch,
  useReconcileTicketControls,
  useProfiles,
  useRequestRetest,
  useRiskControls,
  useSendMessage,
  useSubmitFix,
  useTicket,
  useTicketControlSteps,
  useTicketControls,
  useTicketEvidenceItems,
  useTicketMessages,
  useUploadTicketEvidence,
} from "@/hooks/queries";
import {
  canRequestReassessment,
  canResumeTicket,
  canSubmitFix,
  canWithdrawTicket,
  controlProgress,
  developerTicketLabel,
  isReconciled,
  liveControls,
  reconciliationPlan,
} from "@/lib/resolve";
import { errorMessage, formatDate } from "@/lib/utils";

export default function ResolveTicket() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const { profile, can } = useAuth();
  const ticket = useTicket(ticketId);
  const finding = ticket.data?.finding;
  const application = ticket.data?.application;

  const messages = useTicketMessages(ticketId);
  const { data: profiles } = useProfiles();
  const activity = useActivity("ticket", ticketId);
  const controls = useTicketControls(ticketId);
  const steps = useTicketControlSteps(ticketId);
  const definitions = useRiskControls(finding?.platform, finding?.test_id);
  const findingEvidence = useFindingEvidenceItems(finding?.id);
  const ticketEvidence = useTicketEvidenceItems(ticketId);

  const sendMessage = useSendMessage(ticketId ?? "");
  const uploadEvidence = useUploadTicketEvidence(ticketId);
  const reconcile = useReconcileTicketControls(ticketId);

  const profileMap = useMemo(
    () => new Map((profiles ?? []).map((row) => [row.id, row])),
    [profiles],
  );

  const plan = useMemo(() => reconciliationPlan(definitions.data ?? []), [definitions.data]);
  const reconcilable = can("update_control_progress") && canSubmitFix(ticket.data);
  const reconciling = useRef(false);
  useEffect(() => {
    if (!ticketId || !reconcilable || plan.length === 0) return;
    if (controls.isLoading || steps.isLoading || reconciling.current) return;
    if (isReconciled(plan, controls.data ?? [], steps.data ?? [])) return;
    reconciling.current = true;
    reconcile.mutate(plan, { onSettled: () => (reconciling.current = false) });
  }, [
    ticketId,
    reconcilable,
    plan,
    controls.data,
    controls.isLoading,
    steps.data,
    steps.isLoading,
    reconcile,
  ]);

  const playbook = usePlaybookRevisionWatch(finding?.platform, !!ticketId);
  const live = useMemo(
    () => liveControls(definitions.data, controls.data ?? [], steps.data ?? []),
    [definitions.data, controls.data, steps.data],
  );

  if (ticket.isLoading) return <LoadingState label="Loading remediation…" />;
  if (ticket.isError || !ticket.data) {
    return <ErrorState message="Unable to load this remediation." onRetry={() => ticket.refetch()} />;
  }

  const label = developerTicketLabel(ticket.data.status);
  const progress = controlProgress(live);
  const showSubmitFix = can("submit_fix") && canSubmitFix(ticket.data);
  const showRequestReassessment = can("request_retest") && canRequestReassessment(ticket.data);
  const showWithdraw = can("withdraw_ticket") && canWithdrawTicket(ticket.data);
  const showResume = can("withdraw_ticket") && canResumeTicket(ticket.data);

  return (
    <div>
      {playbook.updated && <PlaybookUpdatedNotice onDismiss={playbook.dismiss} />}
      <PageHeader
        title={finding?.title ?? ticket.data.title}
        description={
          application ? `${application.name}${application.version ? ` · ${application.version}` : ""}` : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            {application && (
              <>
                <ApplicationIcon application={application} className="h-8 w-8" iconClassName="h-4 w-4" />
                <PlatformBadge platform={application.platform} />
              </>
            )}
            {finding && <SeverityBadge severity={finding.severity} />}
            {label && <ToneBadge tone={label.tone} label={label.label} />}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="What was found">
            <p className="text-sm text-foreground">
              {finding?.description || "Security recorded no description for this finding."}
            </p>
            {finding?.impact && (
              <>
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Why it matters
                </p>
                <p className="text-sm text-foreground">{finding.impact}</p>
              </>
            )}
            {finding && (
              <p className="mt-3 text-xs text-muted-foreground">
                Current status: <StatusBadge status={finding.status} />{" "}
                <Link to={`/findings/${finding.id}`} className="ml-2 text-primary hover:underline">
                  Open the full finding
                </Link>
              </p>
            )}
          </Section>

          <Section
            title="Required controls"
            aside={<ProgressBar label="Steps completed" progress={progress} />}
          >
            {definitions.isLoading || controls.isLoading ? (
              <LoadingState label="Loading remediation controls…" />
            ) : definitions.isError ? (
              <ErrorState
                message="The automation backend could not provide the remediation instructions for this risk."
                onRetry={() => definitions.refetch()}
              />
            ) : (
              <ControlChecklist
                controls={live}
                linkTo={(controlId) => `/resolve/tickets/${ticket.data!.id}/controls/${controlId}`}
                emptyMessage={
                  finding?.test_id
                    ? "The playbook has no developer controls for this risk yet."
                    : "This finding is not linked to a playbook risk, so it has no controls."
                }
              />
            )}
          </Section>

          <ConversationPanel
            title="Conversation with security"
            messages={messages.data}
            isLoading={messages.isLoading}
            currentProfileId={profile?.id}
            profileMap={profileMap}
            canComment={can("comment_ticket")}
            onSend={(message) => sendMessage.mutateAsync(message)}
            sending={sendMessage.isPending}
            emptyStateDescription="Ask security a question about this finding, or explain what you changed."
          />

          <Section title="Activity">
            <Timeline entries={activity.data ?? []} />
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Your actions">
            <WithdrawalNotice
              ticket={ticket.data}
              actorName={
                ticket.data.withdrawn_by
                  ? profileMap.get(ticket.data.withdrawn_by)?.display_name
                  : null
              }
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {showSubmitFix && <SubmitFixDialog ticketId={ticket.data.id} />}
              {showRequestReassessment && (
                <RequestReassessmentButton ticketId={ticket.data.id} findingId={finding?.id ?? ""} />
              )}
              {showResume && <ResumeRemediationButton ticket={ticket.data} />}
              {showWithdraw && <WithdrawRemediationDialog ticket={ticket.data} />}
              {!showSubmitFix && !showRequestReassessment && !showResume && !showWithdraw && (
                <p className="text-xs text-muted-foreground">
                  Nothing to do right now — security owns the next step on this finding.
                </p>
              )}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Completing every control step does not close the finding. Security runs the
              reassessment and decides whether the risk is reduced.
            </p>
          </Section>

          <Section title="Your evidence">
            <label className="mb-3 inline-flex cursor-pointer items-center gap-2 text-sm text-primary hover:underline">
              <Paperclip className="h-3.5 w-3.5" />
              {uploadEvidence.isPending ? "Uploading…" : "Upload evidence"}
              <input
                type="file"
                className="hidden"
                disabled={uploadEvidence.isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadEvidence.mutateAsync(file);
                  event.target.value = "";
                }}
              />
            </label>
            {uploadEvidence.isError && (
              <p className="mb-2 text-xs text-danger">
                {errorMessage(uploadEvidence.error, "Could not upload that file.")}
              </p>
            )}
            <EvidenceViewer items={ticketEvidence.data ?? []} />
          </Section>

          <Section title="Security evidence">
            {findingEvidence.isLoading ? (
              <LoadingState label="Loading evidence…" />
            ) : (findingEvidence.data ?? []).length === 0 ? (
              <EmptyState title="Security recorded no evidence for this finding." />
            ) : (
              <EvidenceViewer items={findingEvidence.data ?? []} />
            )}
          </Section>

          <Section title="Details">
            <Detail label="Target version" value={ticket.data.target_version} />
            <Detail label="Opened" value={formatDate(ticket.data.created_at)} />
            <Detail label="Updated" value={formatDate(ticket.data.updated_at)} />
          </Section>
        </div>
      </div>
    </div>
  );
}

function SubmitFixDialog({ ticketId }: { ticketId: string }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [version, setVersion] = useState("");
  const submitFix = useSubmitFix(ticketId);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await submitFix.mutateAsync({ notes, target_version: version || undefined });
    setOpen(false);
    setNotes("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Submit fix</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit your fix</DialogTitle>
          <DialogDescription>
            Security reviews this and runs the reassessment. Submitting does not change the
            finding&apos;s status.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <Textarea
            rows={4}
            required
            placeholder="What did you change, and which controls did you implement?"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          <Input
            placeholder="Fixed in version (optional)"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
          />
          {submitFix.isError && (
            <p className="text-xs text-danger">
              {errorMessage(submitFix.error, "Could not submit the fix.")}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitFix.isPending || !notes.trim()}>
              {submitFix.isPending ? "Submitting…" : "Submit fix"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RequestReassessmentButton({
  ticketId,
  findingId,
}: {
  ticketId: string;
  findingId: string;
}) {
  const request = useRequestRetest(ticketId, findingId);
  return (
    <div>
      <Button
        size="sm"
        variant="outline"
        disabled={request.isPending || !findingId}
        onClick={() => void request.mutateAsync()}
      >
        {request.isPending ? "Requesting…" : "Request reassessment"}
      </Button>
      {request.isError && (
        <p className="mt-1 text-xs text-danger">
          {errorMessage(request.error, "Could not request the reassessment.")}
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {aside && <div className="min-w-[12rem] flex-1">{aside}</div>}
      </div>
      <Card>
        <CardContent className="py-4">{children}</CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="mb-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}
