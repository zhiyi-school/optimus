import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEBUG_LOG_ENDPOINT,
  MAX_BODY_BYTES,
  MAX_FILE_BYTES,
  MAX_LINE_LENGTH,
  appendDebugLines,
  debugLogPlugin,
  handleDebugLogRequest,
  parseDebugLines,
  sanitizeLine,
} from "./debug-log";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "optimus-debug-log-"));
  file = path.join(dir, "logs", "dashboard-debug.log");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function request(method: string, body = ""): IncomingMessage {
  return Object.assign(Readable.from(body ? [Buffer.from(body)] : []), { method }) as unknown as IncomingMessage;
}

function response() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    ended: false,
    headers,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    end: () => {
      res.ended = true;
    },
  };
  return res;
}

async function send(method: string, body = "") {
  const res = response();
  await handleDebugLogRequest(request(method, body), res as unknown as ServerResponse, file);
  return res;
}

describe("the debug-log endpoint", () => {
  it("names the same path the browser posts to", async () => {
    const client = await readFile(path.resolve(__dirname, "../src/lib/debug.ts"), "utf8");

    expect(client).toContain(`export const DEBUG_LOG_ENDPOINT = "${DEBUG_LOG_ENDPOINT}";`);
  });

  it("appends each posted line to the file, creating its folder", async () => {
    const res = await send("POST", JSON.stringify({ lines: ["first", "second"] }));
    await send("POST", JSON.stringify({ lines: ["third"] }));

    expect(res.statusCode).toBe(204);
    expect(await readFile(file, "utf8")).toBe("first\nsecond\nthird\n");
  });

  it("refuses anything but POST", async () => {
    const res = await send("GET");

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe("POST");
    await expect(stat(file)).rejects.toThrow();
  });

  it.each(["not json", "{}", JSON.stringify({ lines: "one" }), JSON.stringify({ lines: [1] }), "null"])(
    "refuses a body that is not a list of lines: %s",
    async (body) => {
      expect((await send("POST", body)).statusCode).toBe(400);
    },
  );

  it("refuses a body over the size limit without writing it", async () => {
    const res = await send("POST", JSON.stringify({ lines: ["x".repeat(MAX_BODY_BYTES)] }));

    expect(res.statusCode).toBe(413);
    await expect(stat(file)).rejects.toThrow();
  });

  it("is only added to the dev server, never to a build", () => {
    expect(debugLogPlugin().apply).toBe("serve");
  });
});

describe("writing lines", () => {
  it("keeps a posted entry on one line so it cannot forge others", () => {
    expect(sanitizeLine("real\n2026-01-01T00:00:00.000Z [forged] entry\r\u0007end")).toBe(
      "real 2026-01-01T00:00:00.000Z [forged] entry end",
    );
  });

  it("caps an entry's length", () => {
    expect(sanitizeLine("x".repeat(MAX_LINE_LENGTH + 10))).toHaveLength(MAX_LINE_LENGTH);
  });

  it("reads only a lines array of strings", () => {
    expect(parseDebugLines(JSON.stringify({ lines: ["a", "b"] }))).toEqual(["a", "b"]);
    expect(parseDebugLines(JSON.stringify({ lines: ["a", null] }))).toBeNull();
  });

  it("moves a full file aside before writing more", async () => {
    await appendDebugLines(file, ["seed"]);
    await writeFile(file, "x".repeat(MAX_FILE_BYTES));

    await appendDebugLines(file, ["fresh"]);

    expect(await readFile(file, "utf8")).toBe("fresh\n");
    expect((await stat(`${file}.1`)).size).toBe(MAX_FILE_BYTES);
  });

  it("writes nothing for an empty batch", async () => {
    await appendDebugLines(file, []);

    await expect(stat(file)).rejects.toThrow();
  });
});
