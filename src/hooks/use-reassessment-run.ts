import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { defaultConfigPath } from "@/api/automation-services";
import { retestData } from "@/data/services/tickets";
import { riskProgressInRun, syncService, type RunCancelToken } from "@/data/sync";
import { automationKeys, conversationKeys, evidenceKeys, ticketKeys } from "@/hooks/query-keys";
import { useActiveRun, useRunEvents } from "@/hooks/queries/automation";
import { useUpdateTicketStatus } from "@/hooks/queries/tickets";
import { errorMessage } from "@/lib/utils";
import type { Application, Finding, Ticket } from "@/data/types";

export function useReassessmentRun({
  ticket,
  finding,
  application,
  retestId,
  onComplete,
}: {
  ticket: Ticket | null | undefined;
  finding: Finding;
  application: Application | null | undefined;
  retestId: string;
  onComplete: () => void;
}) {
  const queryClient = useQueryClient();
  const [watching, setWatching] = useState(false);
  const [startedRunId, setStartedRunId] = useState<string>();
  const [runError, setRunError] = useState<string | null>(null);
  const [stoppedWatchingRunId, setStoppedWatchingRunId] = useState<string>();
  const updateStatus = useUpdateTicketStatus(ticket?.id ?? "");
  const cancelRef = useRef<RunCancelToken>({ cancelled: false });
  const appExternalId = application?.external_id ?? undefined;
  const { run: activeRun, platformRun } = useActiveRun({
    platform: finding.platform,
    appExternalId,
    riskId: finding.test_id ?? undefined,
  });
  const adoptedRun = activeRun?.run_id === stoppedWatchingRunId ? undefined : activeRun;
  const activeRunId = startedRunId ?? adoptedRun?.run_id;
  const { events, streamState } = useRunEvents(activeRunId, !!activeRunId);
  const progress = riskProgressInRun(events, adoptedRun, appExternalId, finding.test_id ?? undefined);
  const executing = watching || progress?.phase === "running";
  const queued = progress?.phase === "queued";
  const deviceBusy = !executing && !queued && !!platformRun;

  async function run() {
    if (!application?.external_id || !finding.test_id) return;
    setWatching(true);
    setStartedRunId(undefined);
    setStoppedWatchingRunId(undefined);
    setRunError(null);
    cancelRef.current = { cancelled: false };
    let errored = false;
    try {
      await retestData.startRun(retestId);
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
            queryClient.invalidateQueries({ queryKey: automationKeys.runs() }),
          ]);
        },
        cancelRef.current,
      );
      if (outcome === "failed") {
        setRunError(runRecord.error ?? "The run failed. The result appears here once the automation host records it.");
        errored = true;
      } else if (outcome !== "completed") {
        setRunError(outcome === "cancelledWaiting"
          ? "Stopped watching this retest. It is still running on the automation host, which records the result on its own."
          : "Stopped waiting after the polling window. The run is still going on the automation host, which records the result on its own.");
        errored = true;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: evidenceKeys.finding(finding.id) }),
        queryClient.invalidateQueries({ queryKey: ticketKeys.findingRetests(finding.id) }),
        queryClient.invalidateQueries({ queryKey: conversationKeys.entriesPrefix() }),
      ]);
    } catch (error) {
      setRunError(errorMessage(error, "Unable to run retest."));
      errored = true;
      await queryClient.invalidateQueries({ queryKey: ticketKeys.findingRetests(finding.id) });
    } finally {
      setWatching(false);
      if (!errored) onComplete();
    }
  }

  function stopWaiting() {
    cancelRef.current.cancelled = true;
    setStoppedWatchingRunId(activeRunId);
    setStartedRunId(undefined);
    setWatching(false);
  }

  return {
    run,
    stopWaiting,
    events,
    streamState,
    runError,
    executing,
    queued,
    deviceBusy,
    busy: executing || queued || deviceBusy,
  };
}
