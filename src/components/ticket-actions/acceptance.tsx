/**
 * Dialogs for requesting and reviewing risk acceptance.
 */

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCreateRiskAcceptanceTicket, useReviewRiskAcceptance } from "@/hooks/queries/risk-acceptance";
import { createDebug } from "@/lib/debug";
import { resolveRiskPath } from "@/lib/risk-routes";
import type { Finding } from "@/data/types";

const debug = createDebug("component:ticket-actions:acceptance");

/** Button and dialog for requesting risk acceptance of a finding. */
export function AcceptRiskButton({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [justification, setJustification] = useState("");
  const [controls, setControls] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const navigate = useNavigate();
  const create = useCreateRiskAcceptanceTicket();

  /** Creates the risk acceptance ticket, then closes the dialog and opens the risk workspace. */
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    debug("requests risk acceptance", {
      findingId: finding.id,
      reasonLength: reason.trim().length,
      hasJustification: !!justification,
      hasControls: !!controls,
      hasExpiry: !!expiresAt,
    });
    await create.mutateAsync({
      finding_id: finding.id,
      application_id: finding.application_id,
      title: `Risk acceptance: ${finding.title}`,
      reason,
      business_justification: justification || undefined,
      compensating_controls: controls || undefined,
      expires_at: expiresAt || undefined,
    });
    debug("requested risk acceptance", { findingId: finding.id });
    setOpen(false);
    navigate(resolveRiskPath({ applicationId: finding.application_id, riskId: finding.test_id }));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        debug("toggles acceptance dialog", { open: next, findingId: finding.id });
        setOpen(next);
      }}
    >
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
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                debug("cancels risk acceptance", { findingId: finding.id });
                setOpen(false);
              }}
            >
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


/** Dialog for accepting or rejecting a risk acceptance request with an optional comment. */
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

  /** Records the review decision and closes the dialog. */
  async function decide(decision: "accepted" | "rejected") {
    debug("reviews risk acceptance", {
      ticketId,
      riskAcceptanceId,
      decision,
      commentLength: comment.trim().length,
    });
    await review.mutateAsync({ id: riskAcceptanceId, ticketId, decision, comment });
    debug("reviewed risk acceptance", { ticketId, riskAcceptanceId, decision });
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        debug("toggles review dialog", { open: next, ticketId, riskAcceptanceId });
        setOpen(next);
      }}
    >
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
