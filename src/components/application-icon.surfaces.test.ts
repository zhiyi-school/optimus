import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Every surface that shows an application identity must go through the shared component. */
const SURFACES = [
  "src/pages/Assessments.tsx",
  "src/pages/NewAssessment.tsx",
  "src/pages/Admin.tsx",
  "src/components/risk-sidebar.tsx",
];

describe("application icon surfaces", () => {
  it.each(SURFACES)("%s renders the shared ApplicationIcon", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain('from "@/components/application-icon"');
    expect(source).toContain("<ApplicationIcon");
  });

  it.each(SURFACES)("%s does not hand-roll the placeholder next to an app name", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toContain("appTypeIcon(");
  });

  it("keeps icon fetching out of the query layer so a page never blocks on it", () => {
    const component = readFileSync("src/components/application-icon.tsx", "utf8");
    expect(component).not.toContain("useQuery");
    expect(component).not.toContain("supabase");
    expect(component).toContain("onError");
  });

  it("never stores or reads image bytes in the dashboard database", () => {
    const services = readFileSync("src/data/services/applications.ts", "utf8");
    expect(services).not.toContain("base64");
    expect(services).not.toContain("icon_data");
  });
});
