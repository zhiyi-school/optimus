import { describe, expect, it } from "vitest";
import { streamStateLabel } from "@/lib/run-stream";

describe("streamStateLabel", () => {
  it("says live updates are unavailable rather than promising polling", () => {
    expect(streamStateLabel("unavailable")).toBe("Live updates unavailable");
    expect(streamStateLabel("unavailable")).not.toMatch(/poll/i);
  });

  it("describes the stream in its other states", () => {
    expect(streamStateLabel("open")).toBe("Streaming");
    expect(streamStateLabel("connecting")).toBe("Connecting");
    expect(streamStateLabel("idle")).toBe("Connecting");
  });
});
