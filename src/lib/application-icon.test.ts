import { describe, expect, it } from "vitest";
import { applicationIconUrl } from "@/lib/application-icon";

const sha = "a".repeat(64);
const base = {
  external_id: "example_app",
  platform: "ios" as const,
  icon_ref: `icons/${sha}.png`,
  icon_extraction_status: "available" as const,
  artifact_sha256: sha,
};

describe("applicationIconUrl", () => {
  it("addresses the backend by platform and backend app id", () => {
    expect(applicationIconUrl(base)).toContain("/config/ios/apps/example_app/icon");
  });

  it("never puts the stored reference in the URL", () => {
    expect(applicationIconUrl(base)).not.toContain("icons/");
    expect(applicationIconUrl(base)).not.toContain(".png");
  });

  it("versions the URL by build so a new artifact is never served from cache", () => {
    expect(applicationIconUrl(base)).toContain(`?v=${sha}`);
  });

  it("changes the URL when the build changes", () => {
    const next = "b".repeat(64);
    expect(applicationIconUrl(base)).not.toBe(
      applicationIconUrl({ ...base, artifact_sha256: next, icon_ref: `icons/${next}.png` }),
    );
  });

  it("omits the version for a row that has no checksum yet", () => {
    const url = applicationIconUrl({ ...base, artifact_sha256: null });
    expect(url).not.toContain("?v=");
    expect(url).toContain("/config/ios/apps/example_app/icon");
  });

  it("escapes identifiers rather than trusting them in a path", () => {
    const url = applicationIconUrl({ ...base, external_id: "../../etc/passwd" });
    expect(url).not.toContain("../");
    expect(url).toContain("%2F");
  });

  it("skips the request for an application with no icon reference", () => {
    expect(applicationIconUrl({ ...base, icon_ref: null })).toBeNull();
  });

  it("skips the request for an application the backend does not know", () => {
    expect(applicationIconUrl({ ...base, external_id: null })).toBeNull();
  });

  it("skips the request when extraction already reported no icon", () => {
    expect(applicationIconUrl({ ...base, icon_extraction_status: "unavailable" })).toBeNull();
    expect(applicationIconUrl({ ...base, icon_extraction_status: "failed" })).toBeNull();
  });

  it("tolerates a missing application", () => {
    expect(applicationIconUrl(null)).toBeNull();
    expect(applicationIconUrl(undefined)).toBeNull();
  });

  it("treats a row predating icon support as having no icon", () => {
    expect(
      applicationIconUrl({
        external_id: "example_app",
        platform: "android",
        icon_ref: null,
        icon_extraction_status: null,
      }),
    ).toBeNull();
  });
});
