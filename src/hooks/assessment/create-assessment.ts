/**
 * Creates an assessment: registers the app, queues its automated run and refreshes the affected queries.
 */

import { useMutation } from "@tanstack/react-query";
import { assessmentRunRequestData } from "@/database/assessments";
import { assessmentKeys, referenceKeys, ticketKeys } from "@/hooks/queries/keys";
import { useInvalidateQueries } from "@/hooks/queries/invalidation";
import { createDebug } from "@/lib/debug";
import { addApp } from "@/workflows/app-registration";

const debug = createDebug("hooks:assessment:create-assessment");

export type CreateAssessmentInput = Parameters<typeof addApp>[0];

/** Registers the app, requests its assessment run and invalidates the lists that show it. */
export function useCreateAssessment() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: async (input: CreateAssessmentInput) => {
      debug("submits assessment", {
        platform: input.platform,
        hasIdentifier: !!input.identifier,
        contactCount: input.contactEmails?.length ?? 0,
      });
      const { assessment } = await addApp(input);
      debug("creates assessment", { assessmentId: assessment.id });

      // Requested durably rather than started here, so leaving the page cannot lose the run.
      try {
        await assessmentRunRequestData.request(assessment.id);
        debug("queues assessment run", { assessmentId: assessment.id });
      } catch (err) {
        debug("fails to queue assessment run", { assessmentId: assessment.id, error: err });
        console.warn("The assessment was created but could not be queued for testing.", err);
      }

      await invalidate([
        assessmentKeys.all(),
        assessmentKeys.runRequestPrefix(),
        referenceKeys.applications(),
        ticketKeys.withRelations(),
        ticketKeys.metrics(),
      ]);
      return assessment;
    },
    onError: (error) => debug("fails to create assessment", error),
  });
}
