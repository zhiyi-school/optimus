import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RunEventTimeline } from "@/components/run-events";
import { defaultConfigPath } from "@/api/automation-services";
import { useReassessmentRun } from "@/hooks/use-reassessment-run";
import type { Application, Finding, Ticket } from "@/data/types";

export function RunRetestButton({
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
  const [open, setOpen] = useState(false);
  const runner = useReassessmentRun({
    ticket,
    finding,
    application,
    retestId,
    onComplete: () => setOpen(false),
  });

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
        {runner.runError && <p className="text-xs text-danger">{runner.runError}</p>}
        {runner.queued && (
          <p className="text-xs text-muted-foreground">
            This test is already part of a run under way and has not started yet — the device runs
            one test at a time.
          </p>
        )}
        {runner.deviceBusy && (
          <p className="text-xs text-muted-foreground">
            The test device is busy with a run in progress. It drives one test at a time, so this
            retest has to wait for that run to finish.
          </p>
        )}
        {(runner.executing || runner.queued) && (
          <RunEventTimeline
            events={runner.events}
            streamState={runner.streamState}
            emptyLabel="Waiting for retest events…"
          />
        )}
        <DialogFooter>
          {runner.executing && (
            <Button type="button" variant="outline" onClick={runner.stopWaiting}>
              Stop waiting
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={runner.busy} onClick={() => void runner.run()}>
            {runner.executing
              ? "Running…"
              : runner.queued
                ? "Waiting its turn"
                : runner.deviceBusy
                  ? "Device busy"
                  : "Start retest"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The operational controls beside the conversation: they act immediately rather
 * than being composed with a message. Retests are found by finding rather than
 * by conversation, so a reassessment requested before the conversation model
 * existed is still runnable here.
 */
