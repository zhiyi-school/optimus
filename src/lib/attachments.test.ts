import { describe, expect, it } from "vitest";
import { attachmentMeta, attachmentSource, attachmentStorageKey } from "@/lib/attachments";
import type { RiskConversationAttachment } from "@/data/types";

function attachment(
  overrides: Partial<RiskConversationAttachment> = {},
): RiskConversationAttachment {
  return {
    id: "example-attachment-id",
    entry_id: "example-entry-id",
    uploaded_by: "example-profile-id",
    storage_path: "conversation-example/1700000000000-report.pdf",
    file_name: "report.pdf",
    mime_type: "application/pdf",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("where an attachment's bytes live", () => {
  it("reads a row written before the provider column as a Supabase object", () => {
    expect(attachmentSource(attachment())).toEqual({
      provider: "supabase",
      path: "conversation-example/1700000000000-report.pdf",
    });
  });

  it("reads an explicit supabase row the same way", () => {
    expect(attachmentSource(attachment({ storage_provider: "supabase" })).provider).toBe(
      "supabase",
    );
  });

  it("reads a server row as a key held by the automation server", () => {
    expect(attachmentSource(attachment({ storage_provider: "server" }))).toEqual({
      provider: "server",
      key: "conversation-example/1700000000000-report.pdf",
    });
  });
});

describe("the storage key an upload is given", () => {
  it("keeps the file inside its own conversation folder", () => {
    expect(attachmentStorageKey("example-conversation", "report.pdf", 17)).toBe(
      "conversation-example-conversation/17-report.pdf",
    );
  });

  it("cannot be walked out of that folder by the file name", () => {
    const key = attachmentStorageKey("example-conversation", "../../etc/passwd", 17);
    expect(key.startsWith("conversation-example-conversation/")).toBe(true);
    expect(key).not.toContain("..");
    expect(key).not.toContain("/etc/");
  });

  it("reduces spaces and non-Latin characters to something a bucket accepts", () => {
    expect(attachmentStorageKey("c", "評価 report (final).pdf", 17)).toBe(
      "conversation-c/17-___report__final_.pdf",
    );
  });

  it("names a file that sanitises away to nothing rather than producing an empty key", () => {
    expect(attachmentStorageKey("c", "...", 17)).toBe("conversation-c/17-attachment");
  });
});

describe("what is shown beside the file name", () => {
  it("gives the size and the type when both are recorded", () => {
    expect(attachmentMeta(attachment({ size_bytes: 2048 }))).toBe("2 KB · application/pdf");
  });

  it("gives only the type on a row uploaded before sizes were recorded", () => {
    expect(attachmentMeta(attachment())).toBe("application/pdf");
  });

  it("says nothing at all when neither was recorded", () => {
    expect(attachmentMeta(attachment({ mime_type: null }))).toBe("");
  });

  it("still reports an empty file rather than hiding its size", () => {
    expect(attachmentMeta(attachment({ size_bytes: 0, mime_type: null }))).toBe("0 B");
  });
});
