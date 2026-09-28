import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebug, isDebugEnabled, redact } from "@/lib/debug";

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
