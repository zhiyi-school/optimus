/**
 * Query hooks for findings and their evidence items.
 */

import { useQuery } from "@tanstack/react-query";
import { evidenceData } from "@/database/evidence";
import { findingData, type FindingFilters } from "@/database/findings";
import { evidenceKeys } from "@/hooks/queries/keys";
import { createDebug } from "@/lib/debug";

const debug = createDebug("hooks:queries:evidence");

/** Fetches findings with their applications, filtered as given. */
export function useFindings(filters: FindingFilters = {}) {
  return useQuery({
    queryKey: evidenceKeys.findings(filters),
    queryFn: async () => {
      debug("fetches findings", { filters });
      const rows = await findingData.listWithApplication(filters);
      debug("fetched findings", { count: rows.length });
      return rows;
    },
  });
}

/** Fetches one finding with its application. */
export function useFinding(id: string | undefined) {
  return useQuery({
    queryKey: evidenceKeys.finding(id),
    queryFn: async () => {
      debug("fetches finding", { findingId: id });
      const finding = await findingData.getWithApplication(id as string);
      debug("fetched finding", { findingId: id, found: Boolean(finding), status: finding?.status });
      return finding;
    },
    enabled: !!id,
  });
}

/** Fetches a finding's evidence as display items, signing storage paths or using external URLs. */
export function useFindingEvidenceItems(findingId: string | undefined) {
  return useQuery({
    queryKey: evidenceKeys.findingItems(findingId),
    queryFn: async () => {
      debug("fetches finding evidence items", { findingId });
      const rows = await evidenceData.listForFinding(findingId as string);
      debug("fetched finding evidence rows", { findingId, count: rows.length });
      return Promise.all(
        rows.map(async (row) => {
          let url: string | undefined;
          if (row.storage_path) {
            const { data } = await evidenceData.getSignedUrl(row.storage_path);
            url = data?.signedUrl;
            if (!url) debug("evidence link unavailable", { evidenceId: row.id });
          } else if (row.external_url) {
            url = row.external_url;
          }
          return {
            id: row.id,
            name: row.name,
            kind: row.type,
            url,
            textContent: row.text_content,
            source: row.source,
          };
        }),
      );
    },
    enabled: !!findingId,
  });
}
