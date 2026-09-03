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
import { ControlChecklist } from "@/components/control-checklist";
import {
  ResumeRemediationButton,
  WithdrawRemediationDialog,
  WithdrawalNotice,
} from "@/components/ticket-actions";
import { EvidenceViewer } from "@/components/evidence";
import { Timeline } from "@/components/timeline";
import {
  PlaybookUpdatedNotice,
  ProgressBar,
  RiskConversationLink,
  ToneBadge,
} from "@/components/resolve-display";
import {
  useActivity,
  useFindingEvidenceItems,
  usePlaybookRevisionWatch,
  useReconcileTicketControls,
  useSelectRemediationControl,
  useProfiles,
  useRiskControls,
  useRiskConversationById,
  useSubmitFix,
  useTicket,
  useTicketControlSteps,
  useTicketControls,
  useTicketEvidenceItems,
  useUploadTicketEvidence,
} from "@/hooks/queries";
import {
  canResumeTicket,
  canSubmitFix,
  canWithdrawTicket,
  controlProgress,
  developerTicketLabel,
  effectiveSelectedControlId,
  isReconciled,
  liveControls,
  selectableControls,
  selectedControl,
  selectedControlReconciliationPlan,
  selectionWasReplaced,
  submitFixBlockedReason,
  riskConversationPath,
} from "@/lib/resolve";
import { cn, errorMessage, formatDate } from "@/lib/utils";
import type { ControlDetail } from "@/api/playbook-types";

export default function ResolveTicket() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const { can } = useAuth();
  const ticket = useTicket(ticketId);
  const finding = ticket.data?.finding;
  const application = ticket.data?.application;

  const { data: conversation } = useRiskConversationById(ticket.data?.risk_conversation_id);
  const { data: profiles } = useProfiles();
  const activity = useActivity("ticket", ticketId);
  const controls = useTicketControls(ticketId);
  const steps = useTicketControlSteps(ticketId);
  const definitions = useRiskControls(finding?.platform, finding?.test_id);
  const findingEvidence = useFindingEvidenceItems(finding?.id);
  const ticketEvidence = useTicketEvidenceItems(ticketId);

  const uploadEvidence = useUploadTicketEvidence(ticketId);
  const reconcile = useReconcileTicketControls(ticketId);

  const profileMap = useMemo(
    () => new Map((profiles ?? []).map((row) => [row.id, row])),
    [profiles],
  );

  const selectControl = useSelectRemediationControl(ticketId, finding?.id);

  const candidates = useMemo(() => selectableControls(definitions.data), [definitions.data]);
  const storedSelection = ticket.data?.selected_control_id ?? null;
  const activeControlId = effectiveSelectedControlId(storedSelection, candidates);
  const chosen = selectedControl(candidates, activeControlId);
  const replaced = selectionWasReplaced(storedSelection, candidates);

  const editable = can("update_control_progress") && canSubmitFix(ticket.data);
  const plan = useMemo(() => selectedControlReconciliationPlan(chosen), [chosen]);

  const persisting = useRef(false);
  useEffect(() => {
    if (!ticketId || !editable || !activeControlId) return;
    if (storedSelection === activeControlId || persisting.current) return;
    persisting.current = true;
    selectControl.mutate(activeControlId, { onSettled: () => (persisting.current = false) });
  }, [ticketId, editable, activeControlId, storedSelection, selectControl]);

  const reconciling = useRef(false);
  useEffect(() => {
    if (!ticketId || !editable || plan.length === 0) return;
    if (controls.isLoading || steps.isLoading || reconciling.current) return;
    if (isReconciled(plan, controls.data ?? [], steps.data ?? [])) return;
    reconciling.current = true;
    reconcile.mutate(plan, { onSettled: () => (reconciling.current = false) });
  }, [
    ticketId,
    editable,
    plan,
    controls.data,
    controls.isLoading,
    steps.data,
    steps.isLoading,
    reconcile,
  ]);

  const playbook = usePlaybookRevisionWatch(finding?.platform, !!ticketId);
  const live = useMemo(
    () => (chosen ? liveControls([chosen], controls.data ?? [], steps.data ?? []) : []),
    [chosen, controls.data, steps.data],
  );

  if (ticket.isLoading) return <LoadingState label="Loading remediation…" />;
  if (ticket.isError || !ticket.data) {
    return <ErrorState message="Unable to load this remediation." onRetry={() => ticket.refetch()} />;
  }

  const label = developerTicketLabel(ticket.data.status);
  const progress = controlProgress(live);
  const submitBlockedReason = submitFixBlockedReason(ticket.data, {
    loading: definitions.isLoading || controls.isLoading || steps.isLoading,
    failed: definitions.isError,
    replaced,
    control: live[0],
  });
  const showSubmitFix = can("submit_fix") && canSubmitFix(ticket.data);
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
            title="Remediation approach"
            aside={<ProgressBar label="Steps completed" progress={progress} />}
          >
            {definitions.isLoading || controls.isLoading ? (
              <LoadingState label="Loading remediation approaches…" />
            ) : definitions.isError ? (
              <ErrorState
                message="The automation backend could not provide the remediation instructions for this risk."
                onRetry={() => definitions.refetch()}
              />
            ) : (
              <>
                {replaced && (
                  <div className="mb-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-foreground">
                    The approach this remediation was following is no longer in the playbook. Your
                    recorded progress is kept as history but no longer counts.{" "}
                    {chosen
                      ? "Review the approach now selected before submitting a fix."
                      : "No replacement approach is available for this risk."}
                  </div>
                )}
                {!replaced && candidates.length > 1 && (
                  <div className="mb-3 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    This risk has multiple remediation approaches. The first option is selected by
                    default, but you can choose another.
                  </div>
                )}
                <ControlChecklist
                  controls={live}
                  linkTo={(controlId) => `/resolve/tickets/${ticket.data!.id}/controls/${controlId}`}
                  emptyMessage={
                    finding?.test_id
                      ? "The playbook has no developer controls for this risk yet."
                      : "This finding is not linked to a playbook risk, so it has no controls."
                  }
                />
                {candidates.length > 1 && (
                  <ApproachPicker
                    candidates={candidates}
                    selectedControlId={activeControlId}
                    hasProgress={progress.completed > 0}
                    findingId={finding?.id}
                    disabled={!editable || selectControl.isPending}
                    onSelect={(controlId) => selectControl.mutate(controlId)}
                  />
                )}
                {selectControl.isError && (
                  <p className="mt-2 text-xs text-danger">
                    {errorMessage(selectControl.error, "Could not change the remediation approach.")}
                  </p>
                )}
              </>
            )}
          </Section>

          <Section title="Talking to security">
            <RiskConversationLink
              to={
                conversation
                  ? riskConversationPath(conversation, ticket.data?.origin_assessment_id)
                  : null
              }
              unavailableNote="This remediation was opened before risks had their own conversation, so it is not linked to one. Open the full finding above to reach the risk it was raised for."
            />
          </Section>

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
              {showSubmitFix && (
                <SubmitFixDialog ticketId={ticket.data.id} blockedReason={submitBlockedReason} />
              )}
              {showResume && <ResumeRemediationButton ticket={ticket.data} />}
              {showWithdraw && <WithdrawRemediationDialog ticket={ticket.data} />}
              {!showSubmitFix && !showResume && !showWithdraw && (
                <p className="text-xs text-muted-foreground">
                  Nothing to do right now — security owns the next step on this finding.
                </p>
              )}
            </div>
            {showSubmitFix && submitBlockedReason && (
              <p className="mt-2 text-xs text-muted-foreground">{submitBlockedReason}</p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Completing every control step does not close the finding. Ask for a reassessment in
              the risk conversation, where security runs it and decides whether the risk is
              reduced.
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

function ApproachPicker({
  candidates,
  selectedControlId,
  hasProgress,
  findingId,
  disabled,
  onSelect,
}: {
  candidates: ControlDetail[];
  selectedControlId: string | null;
  hasProgress: boolean;
  findingId: string | undefined;
  disabled: boolean;
  onSelect: (controlId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<ControlDetail | null>(null);

  function choose(control: ControlDetail) {
    if (control.control_id === selectedControlId) return;
    if (hasProgress) {
      setPending(control);
      return;
    }
    onSelect(control.control_id);
    setOpen(false);
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {open
          ? "Hide other approaches"
          : `View other approaches (${candidates.length - 1})`}
      </button>

      {open && (
        <ul className="mt-2 space-y-2">
          {candidates.map((control) => {
            const isSelected = control.control_id === selectedControlId;
            return (
              <li key={control.control_id}>
                <div
                  className={cn(
                    "rounded-lg border p-3",
                    isSelected ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{control.title}</p>
                      {control.summary && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {control.summary}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {control.step_count === 1 ? "1 step" : `${control.step_count} steps`}
                      </p>
                    </div>
                    {isSelected && <ToneBadge tone="success" label="Selected" />}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {findingId && (
                      <Link
                        to={`/findings/${findingId}/controls/${control.control_id}`}
                        className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        Preview
                      </Link>
                    )}
                    {!isSelected && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={disabled}
                        onClick={() => choose(control)}
                      >
                        Use this approach
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!pending} onOpenChange={(next) => !next && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change remediation approach?</DialogTitle>
            <DialogDescription>
              Progress recorded for the current approach will no longer count toward this
              ticket&apos;s completion. It remains available as historical workflow data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (pending) onSelect(pending.control_id);
                setPending(null);
                setOpen(false);
              }}
            >
              Change approach
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SubmitFixDialog({
  ticketId,
  blockedReason,
}: {
  ticketId: string;
  blockedReason: string | null;
}) {
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
        <Button size="sm" disabled={!!blockedReason}>
          Submit fix
        </Button>
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
