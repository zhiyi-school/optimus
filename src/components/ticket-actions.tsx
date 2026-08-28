import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
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
  useCreateRemediationTicket,
  useCreateRiskAcceptanceTicket,
  useRequestRetest,
  useReviewRiskAcceptance,
  useSubmitFix,
  useUpdateTicketStatus,
} from "@/hooks/queries";
import { syncService, type RunCancelToken } from "@/data/sync";
import { retestData } from "@/data/services";
import { defaultConfigPath } from "@/api/automation-services";
import { errorMessage } from "@/lib/utils";
import type { Finding, Ticket, Application } from "@/data/types";
import type { Capability } from "@/auth/permissions";

export function WorkOnRiskButton({
  finding,
  application,
}: {
  finding: Finding;
  application: Application | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [plannedFix, setPlannedFix] = useState("");
  const [targetVersion, setTargetVersion] = useState("");
  const navigate = useNavigate();
  const create = useCreateRemediationTicket();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ticket = await create.mutateAsync({
      finding_id: finding.id,
      application_id: finding.application_id,
      title: `Remediate: ${finding.title}`,
      description: [notes, plannedFix && `Planned fix: ${plannedFix}`]
        .filter(Boolean)
        .join("\n\n"),
      target_version: targetVersion || undefined,
    });
    setOpen(false);
    navigate(`/tickets/${ticket.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Work on this Risk</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create remediation ticket</DialogTitle>
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create ticket"}
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

function RunRetestButton({
  ticket,
  finding,
  application,
  retestId,
}: {
  ticket: Ticket;
  finding: Finding;
  application: Application | null | undefined;
  retestId: string;
}) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const updateStatus = useUpdateTicketStatus(ticket.id);
  const cancelRef = useRef<RunCancelToken>({ cancelled: false });

  async function run() {
    if (!application?.external_id || !finding.test_id) return;
    setRunning(true);
    setRunError(null);
    cancelRef.current = { cancelled: false };
    let errored = false;
    try {
      await updateStatus.mutateAsync("retest_in_progress");

      const { run: runRecord, synced, cancelled } = await syncService.runAndSync(
        {
          platform: finding.platform,
          config_path: defaultConfigPath(finding.platform),
          apps: application.external_id,
          risks: finding.test_id,
        },
        profile?.id ?? null,
        (started) => retestData.markRunning(retestId, started.run_id),
        cancelRef.current,
      );

      if (cancelled) {
        setRunError(
          "Stopped watching this retest — it may still be going on the backend. It'll stay marked as running on this ticket until it's synced later.",
        );
        errored = true;
      } else if (synced) {
        await retestData.complete(retestId, "Retest completed — see finding for updated status.", "completed");
        await updateStatus.mutateAsync("under_review");
      } else {
        const message = runRecord.error ?? `Run ended with status "${runRecord.status}".`;
        await retestData.complete(retestId, message, "failed");
        setRunError(message);
        errored = true;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["finding", finding.id] }),
        queryClient.invalidateQueries({ queryKey: ["findingRetests", finding.id] }),
        queryClient.invalidateQueries({ queryKey: ["ticketRetests", ticket.id] }),
      ]);
    } catch (err) {
      setRunError(errorMessage(err, "Unable to run retest."));
      errored = true;
    } finally {
      setRunning(false);
      if (!errored) setOpen(false);
    }
  }

  function stopWaiting() {
    cancelRef.current.cancelled = true;
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
        <DialogFooter>
          {running && (
            <Button type="button" variant="outline" onClick={stopWaiting}>
              Stop waiting
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={running} onClick={() => void run()}>
            {running ? "Running…" : "Start retest"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TicketActions({
  ticket,
  finding,
  application,
  can,
  riskAcceptanceId,
  pendingRetestId,
}: {
  ticket: Ticket;
  finding: Finding | null | undefined;
  application: Application | null | undefined;
  can: (capability: Capability) => boolean;
  riskAcceptanceId?: string;
  pendingRetestId?: string;
}) {
  const updateStatus = useUpdateTicketStatus(ticket.id);
  const requestRetest = useRequestRetest(ticket.id, finding?.id ?? "");

  const isDeveloperFlow = ticket.type === "remediation";
  const canRequestRetest =
    isDeveloperFlow &&
    can("request_retest") &&
    ["fix_submitted", "open", "in_progress"].includes(ticket.status);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isDeveloperFlow && can("submit_fix") && ticket.status !== "closed" && (
        <SubmitFixDialog ticketId={ticket.id} />
      )}

      {canRequestRetest && (
        <Button
          size="sm"
          variant="outline"
          disabled={requestRetest.isPending}
          onClick={() => void requestRetest.mutateAsync()}
        >
          Request Retest
        </Button>
      )}

      {ticket.type === "risk_acceptance" &&
        ticket.status === "under_review" &&
        can("review_risk_acceptance") &&
        riskAcceptanceId && (
          <ReviewRiskAcceptanceDialog ticketId={ticket.id} riskAcceptanceId={riskAcceptanceId} />
        )}

      {ticket.status === "retest_requested" &&
        can("run_test") &&
        finding &&
        application &&
        pendingRetestId && (
          <RunRetestButton
            ticket={ticket}
            finding={finding}
            application={application}
            retestId={pendingRetestId}
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
