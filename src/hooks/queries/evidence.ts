import { useMutation, useQuery } from "@tanstack/react-query";
import { evidenceData } from "@/data/services/evidence";
import { findingData, type FindingFilters } from "@/data/services/findings";
import { useInvalidateQueries } from "./invalidation";
import { evidenceKeys, ticketKeys } from "@/hooks/query-keys";

export function useFindings(filters: FindingFilters = {}) {
  return useQuery({
    queryKey: evidenceKeys.findings(filters),
    queryFn: () => findingData.listWithApplication(filters),
  });
}

export function useFinding(id: string | undefined) {
  return useQuery({
    queryKey: evidenceKeys.finding(id),
    queryFn: () => findingData.getWithApplication(id as string),
    enabled: !!id,
  });
}

export function useFindingHistory(findingId: string | undefined) {
  return useQuery({
    queryKey: evidenceKeys.findingHistory(findingId),
    queryFn: () => findingData.history(findingId as string),
    enabled: !!findingId,
  });
}

export function useFindingEvidence(findingId: string | undefined) {
  return useQuery({
    queryKey: evidenceKeys.findingEvidence(findingId),
    queryFn: () => evidenceData.listForFinding(findingId as string),
    enabled: !!findingId,
  });
}

export function useFindingEvidenceItems(findingId: string | undefined) {
  return useQuery({
    queryKey: evidenceKeys.findingItems(findingId),
    queryFn: async () => {
      const rows = await evidenceData.listForFinding(findingId as string);
      return Promise.all(
        rows.map(async (row) => {
          let url: string | undefined;
          if (row.storage_path) {
            const { data } = await evidenceData.getSignedUrl(row.storage_path);
            url = data?.signedUrl;
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
      const rows = await evidenceData.listForTicket(ticketId as string);
      return Promise.all(
        rows.map(async (row) => {
          let url: string | undefined;
          if (row.storage_path) {
            const { data } = await evidenceData.getSignedUrl(row.storage_path);
            url = data?.signedUrl;
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
    onSuccess: () =>
      invalidate([
        evidenceKeys.ticketItems(ticketId),
        ticketKeys.activity("ticket", ticketId),
      ]),
  });
}
