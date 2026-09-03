import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/useAuth";
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
import {
  useClassifyRisk,
  useCreateRiskAcceptanceTicket,
  useFindingTickets,
  useRequestReassessment,
  useResumeTicket,
  useReviewRiskAcceptance,
  useRiskControls,
  useActiveRun,
  useRunEvents,
  useSendRiskMessage,
  useStartRemediation,
  useSubmitFix,
  useUpdateTicketStatus,
  useWithdrawTicket,
} from "@/hooks/queries";
import { RunEventTimeline } from "@/components/run-events";
import { syncService, riskProgressInRun, type RunCancelToken } from "@/data/sync";
import { retestData } from "@/data/services";
import { defaultConfigPath } from "@/api/automation-services";
import {
  activeRemediationTicket,
  canResumeTicket,
  canSubmitFix,
  canWithdrawTicket,
  reassessmentBlockedReason,
  effectiveSelectedControlId,
  selectableControls,
  selectedControl,
  selectedControlReconciliationPlan,
  resumableRemediationTicket,
} from "@/lib/resolve";
import { errorMessage, formatDate } from "@/lib/utils";
import type {
  Application,
  Finding,
  FindingStatus,
  RetestRun,
  RiskConversation,
  Ticket,
} from "@/data/types";
import type { Capability } from "@/auth/permissions";

export function WorkOnRiskButton({
  finding,
  application,
  preferredControlId,
}: {
  finding: Finding;
  application: Application | null | undefined;
  /** Set when remediation starts from a control preview, so that control is the initial approach. */
  preferredControlId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [plannedFix, setPlannedFix] = useState("");
  const [targetVersion, setTargetVersion] = useState("");
  const navigate = useNavigate();
  const { can } = useAuth();
  const start = useStartRemediation();
  const { data: tickets } = useFindingTickets(finding.id);
  const definitions = useRiskControls(finding.platform, finding.test_id);

  const active = activeRemediationTicket(finding.id, tickets);
  const withdrawn = resumableRemediationTicket(finding.id, tickets);
  const resume = useResumeTicket(withdrawn?.id ?? "", finding.id);
  const ticketPath = (id: string) =>
    can("view_resolve") ? `/resolve/tickets/${id}` : `/tickets/${id}`;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const candidates = selectableControls(definitions.data);
    const initial = selectedControl(
      candidates,
      effectiveSelectedControlId(preferredControlId, candidates),
    );
    const ticket = await start.mutateAsync({
      ticket: {
        finding_id: finding.id,
        application_id: finding.application_id,
        title: `Remediate: ${finding.title}`,
        description: [notes, plannedFix && `Planned fix: ${plannedFix}`]
          .filter(Boolean)
          .join("\n\n"),
        target_version: targetVersion || undefined,
        selected_control_id: initial?.control_id ?? null,
      },
      plan: selectedControlReconciliationPlan(initial),
      risk: finding.test_id
        ? {
            applicationId: finding.application_id,
            riskId: finding.test_id,
            originAssessmentId: finding.assessment_id,
          }
        : null,
    });
    setOpen(false);
    navigate(ticketPath(ticket.id));
  }

  if (active) {
    return (
      <Link
        to={ticketPath(active.id)}
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        Continue remediation
      </Link>
    );
  }

  if (withdrawn) {
    return (
      <div>
        <Button
          disabled={resume.isPending}
          onClick={async () => {
            await resume.mutateAsync();
            navigate(ticketPath(withdrawn.id));
          }}
        >
          {resume.isPending ? "Resuming…" : "Resume remediation"}
        </Button>
        {resume.isError && (
          <p className="mt-1 text-xs text-danger">
            {errorMessage(resume.error, "Could not resume this remediation.")}
          </p>
        )}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Start remediation</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start remediation</DialogTitle>
          <DialogDescription>
            {finding.title} — {application?.name}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Developer notes
            </label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What will you investigate or change?"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Planned fix
            </label>
            <Textarea
              rows={2}
              value={plannedFix}
              onChange={(e) => setPlannedFix(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Target version
            </label>
            <Input value={targetVersion} onChange={(e) => setTargetVersion(e.target.value)} />
          </div>
          {start.isError && (
            <p className="text-xs text-danger">
              {errorMessage(start.error, "Could not start this remediation.")}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={start.isPending}>
              {start.isPending ? "Starting…" : "Start remediation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AcceptRiskButton({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [justification, setJustification] = useState("");
  const [controls, setControls] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const navigate = useNavigate();
  const create = useCreateRiskAcceptanceTicket();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ticket = await create.mutateAsync({
      finding_id: finding.id,
      application_id: finding.application_id,
      title: `Risk acceptance: ${finding.title}`,
      reason,
      business_justification: justification || undefined,
      compensating_controls: controls || undefined,
      expires_at: expiresAt || undefined,
    });
    setOpen(false);
    navigate(`/tickets/${ticket.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Accept Risk</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request risk acceptance</DialogTitle>
          <DialogDescription>{finding.title}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Reason for accepting risk *
            </label>
            <Textarea rows={2} required value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Business justification
            </label>
            <Textarea
              rows={2}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Compensating controls
            </label>
            <Textarea rows={2} value={controls} onChange={(e) => setControls(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Requested expiry (optional)
            </label>
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Submitting…" : "Submit request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WithdrawRemediationDialog({
  ticket,
  size = "sm",
}: {
  ticket: Ticket;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const withdraw = useWithdrawTicket(ticket.id, ticket.finding_id);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await withdraw.mutateAsync(reason);
    setOpen(false);
    setReason("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} variant="outline">
          Withdraw remediation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop working on this remediation?</DialogTitle>
          <DialogDescription>
            This will withdraw the remediation request. The finding will remain unresolved and
            security will not treat it as verified. Your conversation, evidence and control
            progress are kept.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Reason *</label>
            <Textarea
              rows={3}
              required
              placeholder="Why are you stopping work on this remediation?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {withdraw.isError && (
            <p className="text-xs text-danger">
              {errorMessage(withdraw.error, "Could not withdraw this remediation.")}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={withdraw.isPending || !reason.trim()}>
              {withdraw.isPending ? "Withdrawing…" : "Withdraw remediation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ResumeRemediationButton({
  ticket,
  size = "sm",
}: {
  ticket: Ticket;
  size?: "sm" | "default";
}) {
  const resume = useResumeTicket(ticket.id, ticket.finding_id);
  return (
    <div>
      <Button size={size} disabled={resume.isPending} onClick={() => void resume.mutateAsync()}>
        {resume.isPending ? "Resuming…" : "Resume remediation"}
      </Button>
      {resume.isError && (
        <p className="mt-1 text-xs text-danger">
          {errorMessage(resume.error, "Could not resume this remediation.")}
        </p>
      )}
    </div>
  );
}

export function WithdrawalNotice({
  ticket,
  actorName,
}: {
  ticket: Ticket;
  actorName?: string | null;
}) {
  if (ticket.status !== "withdrawn") return null;
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Withdrawn by developer
      </p>
      <p className="mt-1 text-sm text-foreground">
        {ticket.withdrawal_reason || "No reason was recorded."}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {actorName ?? "A developer"}
        {ticket.withdrawn_at ? ` · ${formatDate(ticket.withdrawn_at)}` : ""}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        The finding stays unresolved. Security has not verified anything here.
      </p>
    </div>
  );
}

function RequestChangesDialog({
  ticketId,
  conversationId,
}: {
  ticketId: string;
  conversationId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const updateStatus = useUpdateTicketStatus(ticketId);
  const sendMessage = useSendRiskMessage(conversationId ?? undefined);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (conversationId) await sendMessage.mutateAsync({ message: comment });
    await updateStatus.mutateAsync("rejected");
    setOpen(false);
    setComment("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Request Changes
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request changes from the developer</DialogTitle>
          <DialogDescription>
            This sends the ticket back for more work and posts your comment in the risk
            conversation. It does not change the risk classification.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <Textarea
            rows={3}
            required
            placeholder="What still needs to change?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateStatus.isPending || sendMessage.isPending || !comment.trim()}
            >
              Request changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubmitFixDialog({ ticketId }: { ticketId: string }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [version, setVersion] = useState("");
  const submitFix = useSubmitFix(ticketId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await submitFix.mutateAsync({ notes, target_version: version || undefined });
    setOpen(false);
    setNotes("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Submit Fix</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit fix information</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <Textarea
            rows={3}
            required
            placeholder="Describe the fix that was implemented…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <Input
            placeholder="Target / fixed version"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitFix.isPending}>
              {submitFix.isPending ? "Submitting…" : "Submit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReviewRiskAcceptanceDialog({
  ticketId,
  riskAcceptanceId,
}: {
  ticketId: string;
  riskAcceptanceId: string;
}) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const review = useReviewRiskAcceptance();

  async function decide(decision: "accepted" | "rejected") {
    await review.mutateAsync({ id: riskAcceptanceId, ticketId, decision, comment });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Review Risk Acceptance</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review risk acceptance request</DialogTitle>
          <DialogDescription>
            This decides the business risk-acceptance record only — it does not change the
            finding&apos;s technical status.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          rows={3}
          placeholder="Review comment (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={review.isPending}
            onClick={() => void decide("rejected")}
          >
            Reject
          </Button>
          <Button disabled={review.isPending} onClick={() => void decide("accepted")}>
            Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A conversation-owned retest has no ticket to move, so the ticket is optional. */
function RunRetestButton({
  ticket,
  finding,
  application,
  retestId,
}: {
  ticket: Ticket | null | undefined;
  finding: Finding;
  application: Application | null | undefined;
  retestId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [watching, setWatching] = useState(false);
  const [startedRunId, setStartedRunId] = useState<string | undefined>();
  const [runError, setRunError] = useState<string | null>(null);
  const [stoppedWatchingRunId, setStoppedWatchingRunId] = useState<string | undefined>();
  const updateStatus = useUpdateTicketStatus(ticket?.id ?? "");
  const cancelRef = useRef<RunCancelToken>({ cancelled: false });

  const appExternalId = application?.external_id ?? undefined;
  const { run: activeRun, platformRun } = useActiveRun({
    platform: finding.platform,
    appExternalId,
    riskId: finding.test_id ?? undefined,
  });
  const adoptedRun = activeRun && activeRun.run_id !== stoppedWatchingRunId ? activeRun : undefined;
  const activeRunId = startedRunId ?? adoptedRun?.run_id;
  const { events: runEvents, streamState } = useRunEvents(activeRunId, !!activeRunId);

  const progress = riskProgressInRun(runEvents, adoptedRun, appExternalId, finding.test_id ?? undefined);
  const executing = watching || progress?.phase === "running";
  const queued = progress?.phase === "queued";
  // The device takes one run at a time, so any run at all blocks starting this retest.
  const deviceBusy = !executing && !queued && !!platformRun;
  const busy = executing || queued || deviceBusy;

  async function run() {
    if (!application?.external_id || !finding.test_id) return;
    setWatching(true);
    setStartedRunId(undefined);
    setStoppedWatchingRunId(undefined);
    setRunError(null);
    cancelRef.current = { cancelled: false };
    let errored = false;
    try {
      if (ticket) await updateStatus.mutateAsync("retest_in_progress");

      const { run: runRecord, outcome } = await syncService.runAndWait(
        {
          platform: finding.platform,
          config_path: defaultConfigPath(finding.platform),
          apps: application.external_id,
          risks: finding.test_id,
        },
        (started) => {
          setStartedRunId(started.run_id);
          return Promise.all([
            retestData.markRunning(retestId, started.run_id),
            queryClient.invalidateQueries({ queryKey: ["automationRuns"] }),
          ]);
        },
        cancelRef.current,
      );

      // The automation host writes the terminal retest state when it syncs the run.
      if (outcome === "failed") {
        setRunError(
          runRecord.error ??
            "The run failed. The result appears here once the automation host records it.",
        );
        errored = true;
      } else if (outcome !== "completed") {
        setRunError(
          outcome === "cancelledWaiting"
            ? "Stopped watching this retest. It is still running on the automation host, which records the result on its own."
            : "Stopped waiting after the polling window. The run is still going on the automation host, which records the result on its own.",
        );
        errored = true;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["finding", finding.id] }),
        queryClient.invalidateQueries({ queryKey: ["findingRetests", finding.id] }),
        queryClient.invalidateQueries({ queryKey: ["riskConversationEntries"] }),
      ]);
    } catch (err) {
      setRunError(errorMessage(err, "Unable to run retest."));
      errored = true;
    } finally {
      setWatching(false);
      if (!errored) setOpen(false);
    }
  }

  function stopWaiting() {
    cancelRef.current.cancelled = true;
    setStoppedWatchingRunId(activeRunId);
    setStartedRunId(undefined);
    setWatching(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Run Retest</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run retest via automation backend</DialogTitle>
          <DialogDescription>
            {finding.title} on {application?.name} ({application?.platform}) — uses the
            backend&apos;s standard <code>{application && defaultConfigPath(application.platform)}</code>
          </DialogDescription>
        </DialogHeader>
        {runError && <p className="text-xs text-danger">{runError}</p>}
        {queued && (
          <p className="text-xs text-muted-foreground">
            This test is already part of a run under way and has not started yet — the device runs
            one test at a time.
          </p>
        )}
        {deviceBusy && (
          <p className="text-xs text-muted-foreground">
            The test device is busy with a run in progress. It drives one test at a time, so this
            retest has to wait for that run to finish.
          </p>
        )}
        {(executing || queued) && (
          <RunEventTimeline
            events={runEvents}
            streamState={streamState}
            emptyLabel="Waiting for retest events…"
          />
        )}
        <DialogFooter>
          {executing && (
            <Button type="button" variant="outline" onClick={stopWaiting}>
              Stop waiting
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void run()}>
            {executing
              ? "Running…"
              : queued
                ? "Waiting its turn"
                : deviceBusy
                  ? "Device busy"
                  : "Start retest"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RequestReassessmentButton({
  conversationId,
  findingId,
  ticketId,
}: {
  conversationId: string;
  findingId: string;
  ticketId: string | null;
}) {
  const request = useRequestReassessment(conversationId);
  return (
    <div>
      <Button
        size="sm"
        variant="outline"
        disabled={request.isPending}
        onClick={() => void request.mutateAsync({ findingId, ticketId })}
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

function ClassifyRiskDialog({
  finding,
  conversationId,
}: {
  finding: Finding;
  conversationId: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<FindingStatus>(finding.status);
  const [reason, setReason] = useState("");
  const classify = useClassifyRisk(finding.id, conversationId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await classify.mutateAsync({ status, reason });
    setOpen(false);
    setReason("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Change classification</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change the risk classification</DialogTitle>
          <DialogDescription>
            This records the decision in the finding history and posts it in this conversation. A
            later automated result supersedes it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label
              htmlFor="risk-classification"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Classification
            </label>
            <select
              id="risk-classification"
              className="h-9 w-full rounded-md border border-border bg-card px-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as FindingStatus)}
            >
              <option value="at_risk">At Risk</option>
              <option value="reduced_risk">Reduced Risk</option>
              <option value="inconclusive">Inconclusive</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="risk-classification-reason"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Reason *
            </label>
            <Textarea
              id="risk-classification-reason"
              rows={3}
              required
              placeholder="Why is this the right classification?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {classify.isError && (
            <p className="text-xs text-danger">
              {errorMessage(classify.error, "Could not update the classification.")}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                classify.isPending || !reason.trim() || status === finding.status
              }
            >
              {classify.isPending ? "Updating…" : "Update classification"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A control that stays visible when it cannot be used, and says why. */
function UnavailableAction({ label, note }: { label: string; note: string }) {
  return (
    <div>
      <Button size="sm" variant="outline" disabled className="cursor-not-allowed">
        {label}
      </Button>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/**
 * Everything that acts on the risk, beside its conversation. Retests are found
 * by finding rather than by conversation, so a reassessment requested before
 * the conversation model existed is still runnable here.
 */
export function RiskConversationActions({
  conversation,
  finding,
  application,
  ticket,
  retests,
  can,
}: {
  conversation: RiskConversation | null | undefined;
  finding: Finding | null | undefined;
  application: Application | null | undefined;
  ticket: Ticket | null | undefined;
  retests: RetestRun[] | undefined;
  can: (capability: Capability) => boolean;
}) {
  const pending = (retests ?? []).find(
    (retest) => retest.status === "queued" || retest.status === "running",
  );
  const mayClassify = can("update_finding");
  const mayRequest = can("request_retest");
  const mayRun = can("run_test");
  if (!mayClassify && !mayRequest && !mayRun) return null;

  const blocked = reassessmentBlockedReason(ticket);

  return (
    <div className="flex flex-wrap items-start gap-3">
      {mayClassify &&
        (!conversation ? (
          <UnavailableAction
            label="Change classification"
            note="This conversation has not loaded, so there is nowhere to record the decision yet."
          />
        ) : !finding ? (
          <UnavailableAction
            label="Change classification"
            note="No result has been published for this risk yet, so there is no classification to change. Run the test to produce one."
          />
        ) : (
          <ClassifyRiskDialog finding={finding} conversationId={conversation.id} />
        ))}

      {mayRequest &&
        (pending ? (
          <UnavailableAction
            label="Request reassessment"
            note="A reassessment has been requested. Security runs it from this conversation."
          />
        ) : !conversation || !finding ? (
          <UnavailableAction
            label="Request reassessment"
            note="No result has been published for this risk yet, so there is nothing to reassess."
          />
        ) : blocked ? (
          <UnavailableAction label="Request reassessment" note={blocked} />
        ) : (
          <RequestReassessmentButton
            conversationId={conversation.id}
            findingId={finding.id}
            ticketId={ticket?.id ?? null}
          />
        ))}

      {mayRun && pending && finding && application && (
        <RunRetestButton
          key={pending.id}
          ticket={ticket}
          finding={finding}
          application={application}
          retestId={pending.id}
        />
      )}
    </div>
  );
}

export function TicketActions({
  ticket,
  can,
  riskAcceptanceId,
}: {
  ticket: Ticket;
  can: (capability: Capability) => boolean;
  riskAcceptanceId?: string;
}) {
  const updateStatus = useUpdateTicketStatus(ticket.id);
  const isDeveloperFlow = ticket.type === "remediation";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isDeveloperFlow && can("submit_fix") && canSubmitFix(ticket) && (
        <SubmitFixDialog ticketId={ticket.id} />
      )}

      {can("withdraw_ticket") && canWithdrawTicket(ticket) && (
        <WithdrawRemediationDialog ticket={ticket} />
      )}

      {can("withdraw_ticket") && canResumeTicket(ticket) && (
        <ResumeRemediationButton ticket={ticket} />
      )}

      {ticket.type === "risk_acceptance" &&
        ticket.status === "under_review" &&
        can("review_risk_acceptance") &&
        riskAcceptanceId && (
          <ReviewRiskAcceptanceDialog ticketId={ticket.id} riskAcceptanceId={riskAcceptanceId} />
        )}

      {isDeveloperFlow &&
        can("request_changes") &&
        ["fix_submitted", "retest_requested", "under_review"].includes(ticket.status) && (
          <RequestChangesDialog
            ticketId={ticket.id}
            conversationId={ticket.risk_conversation_id}
          />
        )}

      {can("close_ticket") && ticket.status !== "closed" && (
        <Button
          size="sm"
          variant="outline"
          disabled={updateStatus.isPending}
          onClick={() => void updateStatus.mutateAsync("closed")}
        >
          Close Ticket
        </Button>
      )}
    </div>
  );
}
