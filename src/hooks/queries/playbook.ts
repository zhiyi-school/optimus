/**
 * Query hooks for playbook control definitions, their sources and revision changes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { queryOptions, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { playbookApi } from "@/api/playbook-services";
import type { AutomationPlatform } from "@/api/automation-types";
import type { ControlDetail } from "@/api/playbook-types";
import { selectableControls } from "@/lib/resolve";
import { playbookKeys } from "@/hooks/query-keys";
import { createDebug } from "@/lib/debug";

const debug = createDebug("hooks:queries:playbook");

const PLAYBOOK_STALE_TIME_MS = 5 * 60_000;
const PLAYBOOK_POLL_INTERVAL_MS = 45_000;

/** Builds the one query definition for a risk's controls, shared by every reader of that cache entry. */
function riskControlsQuery(
  platform: AutomationPlatform | undefined,
  riskId: string | null | undefined,
) {
  return queryOptions({
    queryKey: playbookKeys.riskControls(platform, riskId),
    queryFn: async () => {
      debug("fetches risk controls", { platform, riskId });
      const controls = await playbookApi.listRiskControls(platform as AutomationPlatform, riskId as string);
      debug("fetched risk controls", { platform, riskId, count: controls.length });
      return controls;
    },
    enabled: !!platform && !!riskId,
    staleTime: PLAYBOOK_STALE_TIME_MS,
    retry: false,
  });
}

/** Fetches the playbook controls that mitigate a risk. */
export function useRiskControls(
  platform: AutomationPlatform | undefined,
  riskId: string | null | undefined,
) {
  return useQuery(riskControlsQuery(platform, riskId));
}

/** Fetches one control definition from the playbook. */
export function useControlDetail(
  platform: AutomationPlatform | undefined,
  controlId: string | undefined,
) {
  return useQuery({
    queryKey: playbookKeys.control(platform, controlId),
    queryFn: async () => {
      debug("fetches control", { platform, controlId });
      const control = await playbookApi.getControl(platform as AutomationPlatform, controlId as string);
      debug("fetched control", { platform, controlId });
      return control;
    },
    enabled: !!platform && !!controlId,
    staleTime: PLAYBOOK_STALE_TIME_MS,
    retry: false,
  });
}

/** Fetches a control's playbook source. */
export function useControlSource(
  platform: AutomationPlatform | undefined,
  controlId: string | undefined,
) {
  return useQuery({
    queryKey: playbookKeys.controlSource(platform, controlId),
    queryFn: async () => {
      debug("fetches control source", { platform, controlId });
      const source = await playbookApi.getControlSource(platform as AutomationPlatform, controlId as string);
      debug("fetched control source", { platform, controlId });
      return source;
    },
    enabled: !!platform && !!controlId,
    retry: false,
  });
}

/** Polls the playbook revision and invalidates control queries once it changes from the session's first one. */
export function usePlaybookRevisionWatch(
  platform: AutomationPlatform | undefined,
  enabled: boolean,
) {
  const queryClient = useQueryClient();
  const initial = useRef<string | null>(null);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);

  const status = useQuery({
    queryKey: playbookKeys.status(platform),
    queryFn: async () => {
      debug("fetches playbook status", { platform });
      const playbookStatus = await playbookApi.getStatus(platform as AutomationPlatform);
      debug("fetched playbook status", { platform, revision: playbookStatus?.revision ?? null });
      return playbookStatus;
    },
    enabled: !!platform && enabled,
    retry: false,
    refetchInterval: enabled ? PLAYBOOK_POLL_INTERVAL_MS : false,
    refetchOnWindowFocus: enabled,
  });

  const revision = status.data?.revision ?? null;

  useEffect(() => {
    if (!revision) return;
    if (initial.current === null) {
      debug("records arrival playbook revision", { revision });
      initial.current = revision;
      return;
    }
    if (initial.current === revision) return;
    debug("playbook revision changed, invalidates controls", { from: initial.current, to: revision });
    void queryClient.invalidateQueries({ queryKey: playbookKeys.riskControlsPrefix() });
    void queryClient.invalidateQueries({ queryKey: playbookKeys.controlPrefix() });
    void queryClient.invalidateQueries({ queryKey: playbookKeys.controlSourcePrefix() });
  }, [revision, queryClient]);

  const changed = revision !== null && initial.current !== null && initial.current !== revision;

  return {
    revision,
    updated: changed && acknowledged !== revision,
    dismiss: () => setAcknowledged(revision),
  };
}

/** Collects live control IDs and step keys per risk; undefined until every risk's controls load. */
export function useLiveControlKeys(risks: { platform: AutomationPlatform; riskId: string }[]) {
  const unique = [...new Map(risks.map((r) => [`${r.platform}/${r.riskId}`, r])).values()].sort(
    (a, b) => `${a.platform}/${a.riskId}`.localeCompare(`${b.platform}/${b.riskId}`),
  );

  const results = useQueries({
    queries: unique.map((risk) => riskControlsQuery(risk.platform, risk.riskId)),
  });

  return useMemo(() => {
    if (results.length === 0 || results.some((result) => !result.isSuccess)) return undefined;
    const controlIds = new Set<string>();
    const stepKeys = new Set<string>();
    const candidatesByRisk = new Map<string, ControlDetail[]>();
    results.forEach((result, index) => {
      const risk = unique[index];
      const candidates = selectableControls(result.data);
      if (risk) candidatesByRisk.set(risk.riskId, candidates);
      for (const control of candidates) {
        controlIds.add(control.control_id);
        for (const step of control.steps) stepKeys.add(step.step_key);
      }
    });
    return { controlIds, stepKeys, candidatesByRisk };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => `${r.status}:${r.dataUpdatedAt}`).join("|")]);
}
