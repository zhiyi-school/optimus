// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadFile, filenameFromDisposition } from "@/lib/download";

const created: string[] = [];
const revoked: string[] = [];
let clicked: { href: string; download: string }[] = [];

function response(
  body: BodyInit | null,
  init: ResponseInit & { headers?: Record<string, string> } = {},
): Response {
  return new Response(body, init);
}

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  clicked = [];
  let next = 0;
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:example/${(next += 1)}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
  // jsdom does not navigate, so the click is recorded rather than performed.
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download });
  };
});

afterEach(() => vi.restoreAllMocks());

describe("naming the saved file", () => {
  it("prefers the name the server sent", () => {
    expect(filenameFromDisposition('attachment; filename="original.ipa"')).toBe("original.ipa");
  });

  it("reads an encoded name", () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''critical%20findings.json")).toBe(
      "critical findings.json",
    );
  });

  it("has no name to offer when the header is absent or empty", () => {
    expect(filenameFromDisposition(null)).toBeUndefined();
    expect(filenameFromDisposition("attachment")).toBeUndefined();
  });
});

describe("downloading an artifact", () => {
  it("saves the body under the server's own filename", async () => {
    const fetchImpl = vi.fn(async () =>
      response("PKexample", {
        headers: { "content-disposition": 'attachment; filename="original.ipa"' },
      }),
    );

    await downloadFile("/example/evidence", "fallback.bin", fetchImpl as unknown as typeof fetch);

    expect(clicked).toEqual([{ href: created[0], download: "original.ipa" }]);
  });

  it("falls back to the caller's filename when the server sent none", async () => {
    const fetchImpl = vi.fn(async () => response("example"));
    await downloadFile("/example/evidence", "report.json", fetchImpl as unknown as typeof fetch);
    expect(clicked[0].download).toBe("report.json");
  });

  it("revokes the object URL it created", async () => {
    const fetchImpl = vi.fn(async () => response("example"));
    await downloadFile("/example/evidence", "report.json", fetchImpl as unknown as typeof fetch);
    expect(revoked).toEqual(created);
  });

  it("never saves a refusal as the file that was asked for", async () => {
    const fetchImpl = vi.fn(async () =>
      response(JSON.stringify({ detail: "Evidence file not found for this run" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      downloadFile("/example/evidence", "original.ipa", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("Evidence file not found for this run");

    expect(clicked).toEqual([]);
    expect(created).toEqual([]);
  });

  it("reports a refusal that carries no structured detail", async () => {
    const fetchImpl = vi.fn(async () => response("Internal Server Error", { status: 500 }));

    await expect(
      downloadFile("/example/evidence", "original.ipa", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("(500)");
    expect(clicked).toEqual([]);
  });

  it("reports a transport failure rather than saving nothing silently", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Network request failed");
    });

    await expect(
      downloadFile("/example/evidence", "original.ipa", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("Could not reach the server");
    expect(clicked).toEqual([]);
  });

  it("surfaces its errors as user-facing ones, so they are shown rather than swallowed", async () => {
    const fetchImpl = vi.fn(async () => response("nope", { status: 403 }));
    await downloadFile("/e", "f", fetchImpl as unknown as typeof fetch).catch((error) => {
      expect((error as { userFacing?: boolean }).userFacing).toBe(true);
    });
  });
});
