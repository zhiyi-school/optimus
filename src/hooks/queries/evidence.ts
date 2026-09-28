import { useMutation, useQuery } from "@tanstack/react-query";
import { evidenceData } from "@/data/services/evidence";
import { findingData, type FindingFilters } from "@/data/services/findings";
import { useInvalidateQueries } from "./invalidation";
import { evidenceKeys, ticketKeys } from "@/hooks/query-keys";
import { createDebug } from "@/lib/debug";

const debug = createDebug("hooks:queries:evidence");

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

export function useFindingHistory(findingId: string | undefined) {
  return useQuery({
    queryKey: evidenceKeys.findingHistory(findingId),
    queryFn: async () => {
      debug("fetches finding history", { findingId });
      const rows = await findingData.history(findingId as string);
      debug("fetched finding history", { findingId, count: rows.length });
      return rows;
    },
    enabled: !!findingId,
  });
}

export function useFindingEvidence(findingId: string | undefined) {
  return useQuery({
    queryKey: evidenceKeys.findingEvidence(findingId),
    queryFn: async () => {
      debug("fetches finding evidence", { findingId });
      const rows = await evidenceData.listForFinding(findingId as string);
      debug("fetched finding evidence", { findingId, count: rows.length });
      return rows;
    },
    enabled: !!findingId,
  });
}

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

export function useTicketEvidenceItems(ticketId: string | undefined) {
  return useQuery({
    queryKey: evidenceKeys.ticketItems(ticketId),
    queryFn: async () => {
      debug("fetches ticket evidence items", { ticketId });
      const rows = await evidenceData.listForTicket(ticketId as string);
      debug("fetched ticket evidence rows", { ticketId, count: rows.length });
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
    enabled: !!ticketId,
  });
}

export function useUploadTicketEvidence(ticketId: string | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (file: File) => evidenceData.uploadFile(null, ticketId as string, file),
    onMutate: (file) => debug("uploads ticket evidence", { ticketId, fileName: file.name, size: file.size }),
    onError: (error, file) => debug("upload ticket evidence failed", { ticketId, fileName: file.name, error }),
    onSuccess: (_data, file) => {
      debug("uploaded ticket evidence", { ticketId, fileName: file.name });
      return invalidate([
        evidenceKeys.ticketItems(ticketId),
        ticketKeys.activity("ticket", ticketId),
      ]);
    },
  });
}
