import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("react-router-dom", () => ({
  useParams: () => ({ assessmentId: "a1", testId: "ios-feature-02-risk-01" }),
  Link: () => null,
  useNavigate: () => () => {},
}));

const TestDetail = (await import("./TestDetail")).default;

describe("TestDetail", () => {
  it("keys the page by testId so run state cannot survive a test switch", () => {
    const element = TestDetail() as ReactElement;
    expect(element.key).toBe("ios-feature-02-risk-01");
  });
});
