/**
 * Query hooks for assessments and their automation run requests.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentData, assessmentRunRequestData } from "@/data/services/assessments";
import { isTransitionalRunState } from "@/lib/status";
import type { Application, Assessment } from "@/data/types";
import { useInvalidateQueries } from "./invalidation";
import { assessmentKeys } from "@/hooks/query-keys";
import { createDebug } from "@/lib/debug";

const debug = createDebug("hooks:queries:assessments");

/** Fetches all assessments with their applications. */
export function useAssessments() {
  return useQuery({
    queryKey: assessmentKeys.all(),
    queryFn: async () => {
      debug("fetches assessments");
      const rows = await assessmentData.listWithApplications();
      debug("fetched assessments", { count: rows.length });
      return rows;
    },
  });
}

/** Fetches one assessment, using its cached list row as placeholder data while the detail loads. */
export function useAssessment(id: string | undefined) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: assessmentKeys.detail(id),
    queryFn: async () => {
      debug("fetches assessment", { assessmentId: id });
      const assessment = await assessmentData.getWithApplication(id as string);
      debug("fetched assessment", { assessmentId: id, found: Boolean(assessment), status: assessment?.status });
      return assessment;
    },
    enabled: !!id,
    placeholderData: () => {
      if (!id) return undefined;
      const cached = queryClient.getQueryData<
        (Assessment & { application: Application | null })[]
      >(assessmentKeys.all());
      const placeholder = cached?.find((row) => row.id === id);
      debug("assessment placeholder", { assessmentId: id, fromList: Boolean(placeholder) });
      return placeholder;
    },
  });
}

const RUN_REQUEST_POLL_INTERVAL_MS = 10_000;

/** Fetches an assessment's run request, polling every 10 seconds while the run is transitional. */
export function useAssessmentRunRequest(
  assessmentId: string | undefined,
  assessment: Pick<Assessment, "status"> | null | undefined,
) {
  return useQuery({
    queryKey: assessmentKeys.runRequest(assessmentId),
    queryFn: async () => {
      debug("fetches run request", { assessmentId });
      const request = await assessmentRunRequestData.findForAssessment(assessmentId as string);
      debug("fetched run request", {
        assessmentId,
        found: Boolean(request),
        keepsPolling: isTransitionalRunState(assessment, request ?? null),
      });
      return request;
    },
    enabled: !!assessmentId,
    refetchInterval: (query) =>
      isTransitionalRunState(assessment, query.state.data ?? null)
        ? RUN_REQUEST_POLL_INTERVAL_MS
        : false,
  });
}

/** Requests an automation run and refreshes the assessment's run request, detail and list. */
export function useRequestAssessmentRun(assessmentId: string | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: () => assessmentRunRequestData.request(assessmentId as string),
    onMutate: () => debug("requests assessment run", { assessmentId }),
    onError: (error) => debug("request assessment run failed", { assessmentId, error }),
    onSuccess: () => {
      debug("requested assessment run", { assessmentId });
      return invalidate([
        assessmentKeys.runRequest(assessmentId),
        assessmentKeys.detail(assessmentId),
        assessmentKeys.all(),
      ]);
    },
  });
}
