import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  useFindingTickets,
  useResumeTicket,
  useRiskControls,
  useStartRemediation,
  useUpdateTicketStatus,
  useWithdrawTicket,
} from "@/hooks/queries/tickets";
import { useSendRiskMessage } from "@/hooks/queries/conversations";
import { activeRemediationTicket, effectiveSelectedControlId, resumableRemediationTicket, selectableControls, selectedControl, selectedControlReconciliationPlan } from "@/lib/resolve";
import { errorMessage, formatDate } from "@/lib/utils";
import type { Application, Finding, Ticket } from "@/data/types";

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
    can("view_resolve") && finding.test_id
      ? `/resolve/applications/${finding.application_id}/risks/${encodeURIComponent(finding.test_id)}`
      : can("view_resolve")
        ? `/resolve/tickets/${id}`
        : `/findings/${finding.id}`;

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


export function RequestChangesDialog({
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
            This sends the ticket back for more work and posts your comment in the conversation.
            It does not change the risk classification.
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
