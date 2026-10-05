import { describe, expect, it } from "vitest";
import {
  assessmentKeys,
  automationKeys,
  conversationKeys,
  evidenceKeys,
  riskAcceptanceKeys,
  ticketKeys,
} from "@/hooks/queries/keys";
import {
  dashboardSyncInvalidationPrefixes,
  riskAcceptanceInvalidationKeys,
  conversationAttachmentInvalidationKeys,
  conversationEntryInvalidationKeys,
  controlProgressInvalidationKeys,
  conversationInvalidationKeys,
  ticketLifecycleInvalidationKeys,
} from "@/hooks/queries/invalidation-rules";

describe("query key compatibility", () => {
  it("preserves entity key parameter order", () => {
    expect(assessmentKeys.detail("assessment-1")).toEqual(["assessment", "assessment-1"]);
    expect(automationKeys.provisioning("ios", "app-1")).toEqual([
      "appProvisioning",
      "ios",
      "app-1",
    ]);
    expect(conversationKeys.byRisk("app-1", "risk-1", undefined, false)).toEqual([
      "riskConversation",
      "app-1",
      "risk-1",
      null,
      false,
    ]);
    expect(ticketKeys.byFinding("finding-1")).toEqual([
      "tickets",
      { findingId: "finding-1" },
    ]);
  });

  it("keeps prefix keys distinct from exact entity keys", () => {
    expect(conversationKeys.entriesPrefix()).toEqual(["riskConversationEntries"]);
    expect(conversationKeys.entries("conversation-1")).toEqual([
      "riskConversationEntries",
      "conversation-1",
    ]);
    expect(ticketKeys.withRelations()).toEqual(["ticketsWithRelations"]);
    expect(ticketKeys.withRelations({ type: "remediation" })).toEqual([
      "ticketsWithRelations",
      { type: "remediation" },
    ]);
    expect(evidenceKeys.findings()).toEqual(["findings"]);
  });
});

describe("domain invalidation rules", () => {
  it("preserves conversation and control invalidation scope", () => {
    expect(conversationInvalidationKeys("conversation-1")).toEqual([
      ["riskConversationEntries", "conversation-1"],
      ["riskConversationAttachments"],
      ["riskConversationActivity"],
    ]);
    expect(controlProgressInvalidationKeys("ticket-1")).toEqual([
      ["ticketControls", "ticket-1"],
      ["ticketControlSteps", "ticket-1"],
      ["ticketControlsBulk"],
    ]);
    expect(conversationEntryInvalidationKeys("conversation-1")).toEqual([
      ["riskConversationEntries", "conversation-1"],
      ["riskConversationActivity"],
    ]);
    expect(conversationAttachmentInvalidationKeys()).toEqual([
      ["riskConversationAttachments"],
    ]);
  });

  it("only adds finding invalidations when a ticket has a finding", () => {
    expect(ticketLifecycleInvalidationKeys("ticket-1", null)).not.toContainEqual([
      "finding",
      null,
    ]);
    expect(ticketLifecycleInvalidationKeys("ticket-1", "finding-1")).toContainEqual([
      "finding",
      "finding-1",
    ]);
  });

  it("refreshes a risk's acceptance after a sync or an acceptance change", () => {
    expect(riskAcceptanceKeys.activeForFinding("finding-1")).toEqual(["riskAcceptance", "finding-1"]);
    expect(dashboardSyncInvalidationPrefixes).toContainEqual(["riskAcceptance"]);
    const keys = riskAcceptanceInvalidationKeys("conversation-1", "finding-1");
    expect(keys).toContainEqual(["riskAcceptance"]);
    expect(keys).toContainEqual(["riskConversationEntries", "conversation-1"]);
    expect(keys).toContainEqual(["findingRetests", "finding-1"]);
  });
});
