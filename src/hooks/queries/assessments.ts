import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentData, assessmentRunRequestData } from "@/data/services/assessments";
import { isTransitionalRunState } from "@/lib/status";
import type { Application, Assessment } from "@/data/types";
import { useInvalidateQueries } from "./invalidation";
import { assessmentKeys } from "@/hooks/query-keys";

export function useAssessments() {
  return useQuery({
    queryKey: assessmentKeys.all(),
    queryFn: assessmentData.listWithApplications,
  });
}

/**
 * The list already holds this row, so the detail page renders from it while
 * the authoritative record loads. Placeholder rather than initial data: the
 * detail fetch always still runs, and its answer replaces this.
 */
export function useAssessment(id: string | undefined) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: assessmentKeys.detail(id),
    queryFn: () => assessmentData.getWithApplication(id as string),
    enabled: !!id,
    placeholderData: () => {
      if (!id) return undefined;
      const cached = queryClient.getQueryData<
        (Assessment & { application: Application | null })[]
      >(assessmentKeys.all());
      return cached?.find((row) => row.id === id);
    },
  });
}

const RUN_REQUEST_POLL_INTERVAL_MS = 10_000;

/**
 * Polls while the assessment is still moving, and stops once it settles —
 * a completed or permanently failed request only changes through a mutation,
 * which invalidates this key. Configuration reporting `ready` is not a reason
 * to stop: device readiness is decided separately and may still be unresolved.
 */
export function useAssessmentRunRequest(
  assessmentId: string | undefined,
  assessment: Pick<Assessment, "status"> | null | undefined,
) {
  return useQuery({
    queryKey: assessmentKeys.runRequest(assessmentId),
    queryFn: () => assessmentRunRequestData.findForAssessment(assessmentId as string),
    enabled: !!assessmentId,
    refetchInterval: (query) =>
      isTransitionalRunState(assessment, query.state.data ?? null)
        ? RUN_REQUEST_POLL_INTERVAL_MS
        : false,
  });
}

export function useRequestAssessmentRun(assessmentId: string | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: () => assessmentRunRequestData.request(assessmentId as string),
    onSuccess: () =>
      invalidate([
        assessmentKeys.runRequest(assessmentId),
        assessmentKeys.detail(assessmentId),
        assessmentKeys.all(),
      ]),
  });
}
