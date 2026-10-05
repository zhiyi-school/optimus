import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PENDING_FILE_LINES,
  createDebug,
  createDebugFileSink,
  formatDebugLine,
  isDebugEnabled,
  redact,
} from "@/lib/debug";

describe("debug logger", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  let stored: Map<string, string>;

  beforeEach(() => {
    stored = new Map();
    vi.stubEnv("VITE_DEBUG", "false");
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null });
    spy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("stays silent by default", () => {
    createDebug("test")("hello");
    expect(isDebugEnabled()).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("logs with a scope when enabled through localStorage", () => {
    stored.set("optimus:debug", "1");
    createDebug("api")("request", { path: "/runs" });
    expect(spy).toHaveBeenCalledWith("[api] request", { path: "/runs" });
  });

  it("logs when VITE_DEBUG is true", () => {
    vi.stubEnv("VITE_DEBUG", "true");
    createDebug("api")("request");
    expect(spy).toHaveBeenCalledWith("[api] request");
  });

  it("redacts sensitive keys at any depth", () => {
    expect(
      redact({
        headers: { Authorization: "Bearer x", accept: "json" },
        items: [{ access_token: "t", id: 1 }],
        signedUrl: "https://storage.example.com/x?token=y",
        apikey: "k",
      }),
    ).toEqual({
      headers: { Authorization: "[redacted]", accept: "json" },
      items: [{ access_token: "[redacted]", id: 1 }],
      signedUrl: "[redacted]",
      apikey: "[redacted]",
    });
  });
});

describe("the debug log file", () => {
  it("formats an entry as one timestamped, scoped line with its details as JSON", () => {
    const line = formatDebugLine("hooks:queries:automation", "fetched", [{ count: 2 }, "text"], new Date("2026-01-01T00:00:00Z"));

    expect(line).toBe('2026-01-01T00:00:00.000Z [hooks:queries:automation] fetched {"count":2} "text"');
  });

  it("keeps an error's name and message rather than an empty object", () => {
    const line = formatDebugLine("api", "failed", [{ error: new TypeError("boom") }], new Date(0));

    expect(line).toContain('{"error":{"name":"TypeError","message":"boom"}}');
  });

  it("falls back to text for a detail JSON cannot hold", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(formatDebugLine("api", "odd", [cyclic], new Date(0))).toContain("[object Object]");
  });

  it("sends buffered lines together in one batch once the flush runs", () => {
    const batches: string[][] = [];
    let scheduled: (() => void) | undefined;
    const schedules: number[] = [];
    const sink = createDebugFileSink(
      (lines) => batches.push(lines),
      (flush) => {
        schedules.push(1);
        scheduled = flush;
      },
    );

    sink.write("one");
    sink.write("two");
    expect(batches).toEqual([]);
    scheduled!();

    expect(batches).toEqual([["one", "two"]]);
    expect(schedules).toHaveLength(1);
  });

  it("caps waiting lines and says how many were dropped", () => {
    const batches: string[][] = [];
    const sink = createDebugFileSink((lines) => batches.push(lines), () => {});

    for (let i = 0; i < MAX_PENDING_FILE_LINES + 3; i += 1) sink.write(`line ${i}`);
    sink.flush();

    expect(batches[0]).toHaveLength(MAX_PENDING_FILE_LINES + 1);
    expect(batches[0].at(-1)).toBe("3 debug line(s) dropped before they could be written");
  });

  it("sends nothing when nothing is waiting", () => {
    const batches: string[][] = [];
    createDebugFileSink((lines) => batches.push(lines), () => {}).flush();

    expect(batches).toEqual([]);
  });

  it("never posts to the dev server from tests or builds", () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("VITE_DEBUG", "true");
    const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    createDebug("api")("request", { token: "secret" });

    expect(consoleSpy).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
