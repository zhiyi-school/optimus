/**
 * Conversation, run history and evidence queries shared by both roles' feature-risk workspaces.
 */

import { useMemo } from "react";
import { assessmentApi } from "@/api/automation-services";
import { useIpaAnalysis, useTestRunHistory } from "@/hooks/queries/automation";
import {
  useRiskConversation,
  useRiskConversationAttachments,
  useRiskConversationEntries,
} from "@/hooks/queries/conversations";
import { useFindingEvidenceItems } from "@/hooks/queries/evidence";
import { useProfiles } from "@/hooks/queries/reference";
import { combinedEvidence, latestResult } from "@/lib/automation-evidence";
import { conversationTimeline } from "@/lib/conversation-timeline";
import { analysisArtifact, plaintextLiterals } from "@/lib/plaintext-literals";

export interface RiskWorkspaceDataInput {
  applicationId: string | undefined;
  applicationExternalId: string | undefined;
  riskId: string | undefined;
  findingId: string | undefined;
  originAssessmentId: string | null | undefined;
  canComment: boolean;
}

/** Loads a risk's application-keyed conversation, run history, evidence rail and plaintext analysis. */
export function useRiskWorkspaceData({
  applicationId,
  applicationExternalId,
  riskId,
  findingId,
  originAssessmentId,
  canComment,
}: RiskWorkspaceDataInput) {
  const conversation = useRiskConversation(applicationId, riskId, findingId, {
    create: canComment,
    originAssessmentId,
  });
  const entries = useRiskConversationEntries(conversation.data?.id);
  const attachments = useRiskConversationAttachments(
    useMemo(() => (entries.data ?? []).map((entry) => entry.id), [entries.data]),
  );
  const attachmentRows = attachments.data;
  const attachmentsByEntry = useMemo(() => {
    const map = new Map<string, typeof attachmentRows>();
    for (const attachment of attachmentRows) {
      map.set(attachment.entry_id, [...(map.get(attachment.entry_id) ?? []), attachment]);
    }
    return map;
  }, [attachmentRows]);
  const { data: profiles } = useProfiles();
  const profileMap = useMemo(() => new Map((profiles ?? []).map((p) => [p.id, p])), [profiles]);

  const history = useTestRunHistory(applicationExternalId, riskId);
  const timeline = useMemo(
    () => conversationTimeline(entries.data, history.data),
    [entries.data, history.data],
  );
  const evidence = useFindingEvidenceItems(findingId);
  const newest = useMemo(
    () => latestResult(history.data, applicationExternalId, riskId),
    [history.data, applicationExternalId, riskId],
  );
  const railEvidence = useMemo(
    () => combinedEvidence(newest, evidence.data, assessmentApi.evidenceFileUrl),
    [newest, evidence.data],
  );
  const analysisRef = analysisArtifact(newest);
  const analysis = useIpaAnalysis(newest?.run_timestamp, analysisRef?.ref);
  const literals = useMemo(
    () => (analysis.data ? plaintextLiterals(analysis.data, newest?.run_timestamp ?? "") : undefined),
    [analysis.data, newest?.run_timestamp],
  );

  return {
    conversation,
    entries,
    attachments,
    attachmentsByEntry,
    profileMap,
    history,
    timeline,
    newest,
    railEvidence,
    analysisRef,
    analysis,
    literals,
  };
}
