import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { LoadingState, ErrorState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ControlChecklist } from "@/components/control-checklist";
import {
  ResumeRemediationButton,
  WithdrawRemediationDialog,
  WithdrawalNotice,
} from "@/components/ticket-actions";
import { PlaybookUpdatedNotice, ToneBadge } from "@/components/resolve-display";
import {
  usePlaybookRevisionWatch,
  useReconcileTicketControls,
  useSelectRemediationControl,
  useProfiles,
  useRiskControls,
  useTicket,
  useTicketControlSteps,
  useTicketControls,
} from "@/hooks/queries";
import {
  approachChangeBlockedReason,
  canResumeTicket,
  canSelectApproach,
  canWithdrawTicket,
  controlProgress,
  effectiveSelectedControlId,
  isReconciled,
  liveControls,
  selectableControls,
  selectedControl,
  selectedControlReconciliationPlan,
  selectionWasReplaced,
  selectedApproachComplete,
} from "@/lib/resolve";
import { cn, errorMessage } from "@/lib/utils";
import type { ControlDetail } from "@/api/playbook-types";

/** The remediation area of the application-risk page; it has no page of its own. */
export default function ResolveTicket({ ticketId }: { ticketId: string }) {
  const { can } = useAuth();
  const ticket = useTicket(ticketId);
  const finding = ticket.data?.finding;

  const { data: profiles } = useProfiles();
  const controls = useTicketControls(ticketId);
  const steps = useTicketControlSteps(ticketId);
  const definitions = useRiskControls(finding?.platform, finding?.test_id);
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

  const mayEdit = can("update_control_progress");
  const mayChangeApproach = mayEdit && canSelectApproach(ticket.data);
  const plan = useMemo(() => selectedControlReconciliationPlan(chosen), [chosen]);

  const persisting = useRef(false);
  useEffect(() => {
    if (!ticketId || !mayChangeApproach || !activeControlId) return;
    if (storedSelection === activeControlId || persisting.current) return;
    persisting.current = true;
    selectControl.mutate(activeControlId, { onSettled: () => (persisting.current = false) });
  }, [ticketId, mayChangeApproach, activeControlId, storedSelection, selectControl]);

  const reconciling = useRef(false);
  useEffect(() => {
    if (!ticketId || !mayChangeApproach || plan.length === 0) return;
    if (controls.isLoading || steps.isLoading || reconciling.current) return;
    if (isReconciled(plan, controls.data ?? [], steps.data ?? [])) return;
    reconciling.current = true;
    reconcile.mutate(plan, { onSettled: () => (reconciling.current = false) });
  }, [
    ticketId,
    mayChangeApproach,
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

  const progress = controlProgress(live);
  const showWithdraw = can("withdraw_ticket") && canWithdrawTicket(ticket.data);
  const showResume = can("withdraw_ticket") && canResumeTicket(ticket.data);
  const complete = selectedApproachComplete(live[0]);

  return (
    <div>
      {playbook.updated && <PlaybookUpdatedNotice onDismiss={playbook.dismiss} />}

      <div className="grid grid-cols-1 gap-4">
        <Section title="Remediation approach">
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
                    ? "Review the approach now selected before asking for a reassessment."
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
                linkTo={(controlId) => `/resolve/tickets/${ticketId}/controls/${controlId}`}
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
                  blockedReason={approachChangeBlockedReason(ticket.data, mayEdit)}
                  onSelect={(controlId) => selectControl.mutateAsync(controlId)}
                />
              )}
            </>
          )}

          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <WithdrawalNotice
              ticket={ticket.data}
              actorName={
                ticket.data.withdrawn_by
                  ? profileMap.get(ticket.data.withdrawn_by)?.display_name
                  : null
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              {showResume && <ResumeRemediationButton ticket={ticket.data} />}
              {showWithdraw && <WithdrawRemediationDialog ticket={ticket.data} />}
              {!showResume && !showWithdraw && (
                <p className="text-xs text-muted-foreground">
                  Nothing to do right now — security owns the next step on this finding.
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {complete
                ? "Every step is done. Ask for a reassessment in the conversation, where security runs it and decides whether the risk is reduced."
                : "Completing every control step does not close the finding — it makes this risk ready for the reassessment you ask for in the conversation."}
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}

function ApproachPicker({
  candidates,
  selectedControlId,
  hasProgress,
  findingId,
  blockedReason,
  onSelect,
}: {
  candidates: ControlDetail[];
  selectedControlId: string | null;
  hasProgress: boolean;
  findingId: string | undefined;
  blockedReason: string | null;
  onSelect: (controlId: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<ControlDetail | null>(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ controlId: string; message: string } | null>(null);

  // The picker stays open until the write lands, so a refusal is visible where it happened.
  async function apply(control: ControlDetail) {
    setSwitchingTo(control.control_id);
    setFailed(null);
    try {
      await onSelect(control.control_id);
    } catch (error) {
      setFailed({
        controlId: control.control_id,
        message: errorMessage(error, "Could not change the remediation approach."),
      });
      return;
    } finally {
      setSwitchingTo(null);
    }
    setConfirming(null);
    setOpen(false);
  }

  function choose(control: ControlDetail) {
    if (control.control_id === selectedControlId || switchingTo) return;
    if (hasProgress) {
      setConfirming(control);
      return;
    }
    void apply(control);
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {open ? "Hide other approaches" : `View other approaches (${candidates.length - 1})`}
      </button>

      {open && (
        <ul className="mt-2 space-y-2">
          {candidates.map((control) => {
            const isSelected = control.control_id === selectedControlId;
            const isSwitching = switchingTo === control.control_id;
            const error = failed?.controlId === control.control_id ? failed.message : null;
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
                        to={`/resolve/findings/${findingId}/controls/${control.control_id}`}
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
                        disabled={!!blockedReason || !!switchingTo}
                        aria-describedby={
                          blockedReason ? "approach-change-blocked" : undefined
                        }
                        onClick={() => choose(control)}
                      >
                        {isSwitching ? "Switching…" : "Use this approach"}
                      </Button>
                    )}
                  </div>
                  {error && <p className="mt-2 text-xs text-danger">{error}</p>}
                </div>
              </li>
            );
          })}
          {blockedReason && (
            <li id="approach-change-blocked" className="text-xs text-muted-foreground">
              {blockedReason}
            </li>
          )}
        </ul>
      )}

      <Dialog
        open={!!confirming}
        onOpenChange={(next) => {
          if (!next && !switchingTo) {
            setConfirming(null);
            setFailed(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change remediation approach?</DialogTitle>
            <DialogDescription>
              Progress recorded for the current approach will no longer count toward this
              ticket&apos;s completion. It remains available as historical workflow data.
            </DialogDescription>
          </DialogHeader>
          {failed && confirming?.control_id === failed.controlId && (
            <p className="text-xs text-danger">{failed.message}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={!!switchingTo}
              onClick={() => {
                setConfirming(null);
                setFailed(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!!blockedReason || !!switchingTo}
              onClick={() => confirming && void apply(confirming)}
            >
              {switchingTo ? "Switching…" : "Change approach"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-foreground">{title}</h2>
      <Card>
        <CardContent className="py-4">{children}</CardContent>
      </Card>
    </div>
  );
}
