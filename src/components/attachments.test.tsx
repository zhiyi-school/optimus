// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RiskConversationAttachment } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let signed: { data: { signedUrl: string } | null; error: unknown } = {
  data: { signedUrl: "https://example.test/signed/report.pdf?token=example" },
  error: null,
};
const signRequests: string[] = [];

vi.mock("@/data/services", () => ({
  riskConversationData: {
    getSignedUrl: (path: string) => {
      signRequests.push(path);
      return Promise.resolve(signed);
    },
  },
}));

const { AttachmentList } = await import("@/components/attachments");

function attachment(
  overrides: Partial<RiskConversationAttachment> = {},
): RiskConversationAttachment {
  return {
    id: "example-attachment-id",
    entry_id: "example-entry-id",
    uploaded_by: "example-uploader-id",
    storage_path: "conversation-example/1700000000000-report.pdf",
    file_name: "quarterly report.pdf",
    mime_type: "application/pdf",
    size_bytes: 2048,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
let saved: { name: string; href: string }[];
let created: string[];
let revoked: string[];
let fetchMock: ReturnType<typeof vi.fn>;

function response(body: BodyInit, init: ResponseInit = {}) {
  return new Response(body, { status: 200, ...init });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  saved = [];
  created = [];
  revoked = [];
  signRequests.length = 0;
  signed = {
    data: { signedUrl: "https://example.test/signed/report.pdf?token=example" },
    error: null,
  };

  let next = 0;
  Object.assign(URL, {
    createObjectURL: () => {
      next += 1;
      const url = `blob:example/${next}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => revoked.push(url),
  });

  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, href: this.href });
  });

  fetchMock = vi.fn(async () => response("example-bytes"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function render(attachments: RiskConversationAttachment[]) {
  act(() => root.render(<AttachmentList attachments={attachments} />));
}

function download(label = "Download quarterly report.pdf") {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function text() {
  return container.textContent ?? "";
}

describe("the files attached to a conversation entry", () => {
  it("offers every attachment a download, whoever uploaded it", () => {
    render([
      attachment(),
      attachment({
        id: "second",
        file_name: "trace.log",
        uploaded_by: "someone-else-entirely",
      }),
    ]);

    expect(download()).not.toBeNull();
    expect(download("Download trace.log")).not.toBeNull();
  });

  it("shows the name, the size and the type", () => {
    render([attachment()]);
    expect(text()).toContain("quarterly report.pdf");
    expect(text()).toContain("2 KB");
    expect(text()).toContain("application/pdf");
  });

  it("shows nothing when an entry has no files", () => {
    render([]);
    expect(container.querySelector("ul")).toBeNull();
  });

  it("saves the bytes under the name the uploader gave the file", async () => {
    render([attachment()]);
    await act(async () => download()?.click());

    expect(signRequests).toEqual(["conversation-example/1700000000000-report.pdf"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/signed/report.pdf?token=example",
    );
    expect(saved).toEqual([{ name: "quarterly report.pdf", href: "blob:example/1" }]);
  });

  it("revokes the temporary object URL it created", async () => {
    render([attachment()]);
    await act(async () => download()?.click());
    expect(revoked).toEqual(created);
  });

  it("signs a fresh link for every download rather than keeping an expiring one", async () => {
    render([attachment()]);
    await act(async () => download()?.click());
    await act(async () => download()?.click());
    expect(signRequests).toHaveLength(2);
  });

  it("reports a refusal and saves no file, with a way to try again", async () => {
    fetchMock.mockResolvedValue(
      response(JSON.stringify({ detail: "Object not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    render([attachment()]);
    await act(async () => download()?.click());

    expect(saved).toEqual([]);
    expect(revoked).toEqual([]);
    expect(text()).toContain("Object not found");

    fetchMock.mockResolvedValue(response("example-bytes"));
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Try again",
    );
    await act(async () => retry?.click());
    expect(saved).toEqual([{ name: "quarterly report.pdf", href: "blob:example/1" }]);
  });

  it("says so when the file has gone from storage, instead of downloading nothing", async () => {
    signed = { data: null, error: { message: "Object not found" } };
    render([attachment()]);
    await act(async () => download()?.click());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(text()).toContain("may have been removed from storage");
  });

  it("marks only the file being fetched as busy", async () => {
    let release = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(response("example-bytes"));
        }),
    );
    render([attachment(), attachment({ id: "second", file_name: "trace.log" })]);

    await act(async () => download()?.click());
    expect(download()?.disabled).toBe(true);
    expect(download("Download trace.log")?.disabled).toBe(false);

    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(download()?.disabled).toBe(false);
  });

  it("explains a server-held file rather than fetching a URL it cannot build", async () => {
    render([attachment({ storage_provider: "server" })]);
    await act(async () => download()?.click());

    expect(signRequests).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(text()).toContain("automation server");
  });
});
