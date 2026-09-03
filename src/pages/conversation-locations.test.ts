import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

function sourceFiles(dir = "src"): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const PAGES = sourceFiles("src/pages").concat(sourceFiles("src/components"));

describe("the conversation has exactly one home", () => {
  it("is rendered only by each role's own feature-risk workspace", () => {
    const renderers = PAGES.filter((path) => /<RiskConversationPanel/.test(source(path))).sort();
    expect(renderers).toEqual(["src/pages/ResolveRisk.tsx", "src/pages/TestDetail.tsx"]);
  });

  it("is rendered once on each of them", () => {
    for (const path of ["src/pages/TestDetail.tsx", "src/pages/ResolveRisk.tsx"]) {
      expect(source(path).match(/<RiskConversationPanel/g), path).toHaveLength(1);
    }
  });

  it("is not on the assessment overview", () => {
    const assessment = source("src/pages/AssessmentDetail.tsx");
    expect(assessment).not.toContain("conversation-panel");
    expect(assessment).not.toContain("ConversationPanel");
    expect(assessment).not.toContain("<textarea");
  });

  it("is not composed on the remediation section", () => {
    const page = source("src/pages/ResolveTicket.tsx");
    expect(page).not.toContain("<RiskConversationPanel");
  });

  it("is not pointed at from the remediation section, which is already on the same page", () => {
    for (const path of ["src/pages/ResolveTicket.tsx", "src/pages/ResolveRisk.tsx"]) {
      expect(source(path), path).not.toContain("RiskConversationLink");
      expect(source(path), path).not.toContain("Talking to security");
      expect(source(path), path).not.toContain("Open risk conversation");
    }
  });

  it("has no helper left that would route a developer through an Assess page to reach it", () => {
    for (const path of sourceFiles()) {
      expect(source(path), path).not.toContain("riskConversationPath");
    }
  });

  it("is reached from an old finding link by the redirect that maps it", () => {
    const redirect = source("src/lib/legacy-routes.ts");
    expect(redirect).toContain("/assessments/${location.assessmentId}/tests/");
    expect(redirect).toContain("/resolve/applications/${location.applicationId}/risks/");
  });

  it("owns the classification control, which no longer sits on the finding page", () => {
    expect(source("src/components/ticket-actions.tsx")).toContain("useClassifyRisk");
  });

  it("owns the reassessment controls, which no longer sit on a ticket page", () => {
    expect(source("src/components/ticket-actions.tsx")).toContain("RiskConversationActions");
    const page = source("src/pages/ResolveTicket.tsx");
    expect(page).not.toContain("RequestReassessment");
    expect(page).not.toContain("RunRetest");
  });
});

describe("the conversation is keyed by application, not by assessment", () => {
  it("asks for it with the application the assessment belongs to", () => {
    const page = source("src/pages/TestDetail.tsx");
    expect(page).toContain("useRiskConversation(\n    assessment?.application_id,");
  });

  it("looks it up and creates it on the application key alone", () => {
    const service = source("src/data/services/assessments.ts");
    expect(service).toContain('.eq("application_id", applicationId)');
    expect(service).toContain('onConflict: "application_id,risk_id"');
    for (const path of sourceFiles()) {
      expect(source(path), `${path} still keys a conversation on an assessment`).not.toContain(
        '"assessment_id,risk_id"',
      );
    }
  });

  it("reuses the application's conversation when a remediation starts", () => {
    const actions = source("src/components/ticket-actions.tsx");
    expect(actions).toContain("applicationId: finding.application_id");
    expect(actions).toContain("originAssessmentId: finding.assessment_id");
  });
});

describe("the automated test history has no card of its own", () => {
  it("is combined into the conversation rather than listed beside it", () => {
    const page = source("src/pages/TestDetail.tsx");
    expect(page).not.toContain("Automated Test History");
    expect(page).toContain("conversationTimeline(entries.data, history)");
  });

  it("is still sourced from the automation backend, never copied into entries", () => {
    const model = source("src/lib/conversation-timeline.ts");
    expect(model).toContain("AutomationResultRow");
    for (const path of sourceFiles()) {
      expect(source(path), `${path} writes run history into the conversation`).not.toMatch(
        /kind:\s*"test_run"[^}]*conversation_id/,
      );
    }
  });

  it("keeps the live run progress separate from the history", () => {
    const page = source("src/pages/TestDetail.tsx");
    expect(page).toContain("Automated test is running");
    expect(page).toContain("<RunEventTimeline");
  });
});

describe("the legacy conversations are gone from the dashboard", () => {
  it("has no source reading or writing a legacy conversation table", () => {
    for (const path of sourceFiles()) {
      const text = source(path);
      for (const table of ["ticket_messages", "assessment_messages", "ticket_attachments"]) {
        expect(text, `${path} references ${table}`).not.toContain(table);
      }
    }
  });

  it("has no hook left for a legacy conversation", () => {
    const hooks = source("src/hooks/queries.ts");
    for (const hook of [
      "useAssessmentMessages",
      "useSendAssessmentMessage",
      "useTicketMessages",
      "useSendMessage",
      "useTicketAttachments",
      "useUploadAttachment",
    ]) {
      expect(hooks, hook).not.toContain(hook);
    }
  });

  it("has no legacy realtime subscription left", () => {
    const services = sourceFiles("src/data").map(source).join("\n");
    expect(services).not.toContain("subscribeToTicket");
    expect(services).not.toContain("subscribeToAssessment");
    expect(services).toContain("subscribeToConversation");
  });

  it("subscribes to one conversation at a time, scoped to that conversation", () => {
    const services = source("src/data/services/assessments.ts");
    expect(services).toContain("filter: `conversation_id=eq.${conversationId}`");
    expect(source("src/hooks/queries.ts").match(/subscribeToConversation/g)).toHaveLength(1);
  });
});
