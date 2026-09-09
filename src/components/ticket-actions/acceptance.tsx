import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCreateRiskAcceptanceTicket, useReviewRiskAcceptance } from "@/hooks/queries/tickets";
import type { Finding } from "@/data/types";

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
    await create.mutateAsync({
      finding_id: finding.id,
      application_id: finding.application_id,
      title: `Risk acceptance: ${finding.title}`,
      reason,
      business_justification: justification || undefined,
      compensating_controls: controls || undefined,
      expires_at: expiresAt || undefined,
    });
    setOpen(false);
    navigate(`/findings/${finding.id}`);
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


export function ReviewRiskAcceptanceDialog({
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
