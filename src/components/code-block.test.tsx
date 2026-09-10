// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "@/components/code-block";
import { PlaybookContent } from "@/components/playbook-content";
import type { PlaybookBlock } from "@/api/playbook-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SWIFT = 'let key = "example"\n\n\tif key.isEmpty {\n\t\treturn "\\(key)"\n\t}';

let container: HTMLDivElement;
let root: Root;
let writeText: ReturnType<typeof vi.fn>;

function setClipboard(impl: (() => Promise<void>) | null) {
  if (impl === null) {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    return;
  }
  writeText = vi.fn(impl);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  setClipboard(() => Promise.resolve());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

function copyButtons() {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].filter((button) =>
    (button.getAttribute("aria-label") ?? "").startsWith("Copy "),
  );
}

async function clickCopy(index = 0) {
  await act(async () => {
    copyButtons()[index].click();
  });
}

function text() {
  return container.textContent ?? "";
}

describe("rendering a code block", () => {
  it("keeps the code as selectable pre-formatted text", () => {
    render(<CodeBlock code={SWIFT} language="swift" />);
    const code = container.querySelector("pre > code");

    expect(code).not.toBeNull();
    expect(code?.textContent).toBe(SWIFT);
  });

  it("names the language when the block declares one", () => {
    render(<CodeBlock code="echo hi" language="shell" />);
    expect(text()).toContain("shell");
    expect(copyButtons()[0].getAttribute("aria-label")).toBe("Copy shell code");
  });

  it("still offers a copy for a block with no language", () => {
    render(<CodeBlock code="echo hi" />);
    expect(copyButtons()[0].getAttribute("aria-label")).toBe("Copy code");
  });

  it("renders an unknown language as plain text with no markup of its own", () => {
    render(<CodeBlock code="fn main() {}" language="rust" />);
    const code = container.querySelector("pre > code")!;

    expect(code.textContent).toBe("fn main() {}");
    expect(code.querySelectorAll("span")).toHaveLength(0);
  });

  it("renders source as text rather than as markup", () => {
    render(<CodeBlock code="<img src=x onerror=alert(1)>" language="swift" />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("pre > code")?.textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("lets the code scroll without the copy control scrolling away", () => {
    render(<CodeBlock code={SWIFT} language="swift" />);
    const pre = container.querySelector("pre")!;

    expect(pre.className).toContain("overflow-x-auto");
    expect(pre.contains(copyButtons()[0])).toBe(false);
  });
});

describe("copying a block", () => {
  it("writes the exact raw code, fences and labels excluded", async () => {
    render(<CodeBlock code={SWIFT} language="swift" />);
    await clickCopy();

    expect(writeText).toHaveBeenCalledWith(SWIFT);
    const written = writeText.mock.calls[0][0] as string;
    expect(written).not.toContain("```");
    expect(written).not.toContain("swift\n");
    expect(written).not.toContain("Copy");
  });

  it("preserves tabs, blank lines, quotes, backslashes and Unicode", async () => {
    const awkward = 'a\tb\n\n  "quoted" \\ \'single\'\ncafé — ✅';
    render(<CodeBlock code={awkward} language="shell" />);
    await clickCopy();

    expect(writeText).toHaveBeenCalledWith(awkward);
  });

  it("copies the highlighted block's raw text, not its rendered spans", async () => {
    render(<CodeBlock code={SWIFT} language="swift" />);
    expect(container.querySelectorAll("pre > code span").length).toBeGreaterThan(0);

    await clickCopy();
    expect(writeText).toHaveBeenCalledWith(SWIFT);
  });

  it("says Copied only once the write has succeeded", async () => {
    let release = () => {};
    setClipboard(() => new Promise<void>((resolve) => (release = resolve)));
    render(<CodeBlock code="echo hi" language="shell" />);

    await act(async () => {
      copyButtons()[0].click();
    });
    expect(text()).not.toContain("Copied");

    await act(async () => {
      release();
    });
    expect(text()).toContain("Copied");
  });

  it("returns to its normal state after the confirmation", async () => {
    render(<CodeBlock code="echo hi" language="shell" />);
    await clickCopy();
    expect(text()).toContain("Copied");

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(text()).not.toContain("Copied");
    expect(text()).toContain("Copy");
  });

  it("announces the result to a screen reader", async () => {
    render(<CodeBlock code="echo hi" language="shell" />);
    await clickCopy();

    const status = container.querySelector("[role='status']")!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("copied");
  });

  it("copies from the keyboard, because it is a real button", async () => {
    render(<CodeBlock code="echo hi" language="shell" />);
    const button = copyButtons()[0];

    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");

    button.focus();
    expect(document.activeElement).toBe(button);
    // A focused button turns Enter and Space into a click.
    await act(async () => {
      button.click();
    });
    expect(writeText).toHaveBeenCalledWith("echo hi");
  });
});

describe("when the clipboard refuses", () => {
  it("reports a rejected write instead of claiming success", async () => {
    setClipboard(() => Promise.reject(new Error("denied")));
    render(<CodeBlock code="echo hi" language="shell" />);
    await clickCopy();

    expect(text()).not.toContain("Copied");
    expect(text()).toContain("Copy is unavailable");
    expect(container.querySelector("pre > code")?.textContent).toBe("echo hi");
  });

  it("reports a missing Clipboard API without throwing", async () => {
    setClipboard(null);
    render(<CodeBlock code="echo hi" language="shell" />);
    await clickCopy();

    expect(text()).not.toContain("Copied");
    expect(text()).toContain("Copy is unavailable");
  });

  it("does not keep asking after a refusal", async () => {
    setClipboard(() => Promise.reject(new Error("denied")));
    render(<CodeBlock code="echo hi" language="shell" />);
    await clickCopy();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain("Copy is unavailable");
  });
});

describe("several blocks on one page", () => {
  const blocks: PlaybookBlock[] = [
    { type: "code", language: "swift", text: 'let a = "first"' },
    { type: "code", language: "shell", text: "echo second" },
  ];

  it("copies each block's own text", async () => {
    render(<PlaybookContent blocks={blocks} />);
    expect(copyButtons()).toHaveLength(2);

    await clickCopy(1);
    expect(writeText).toHaveBeenCalledWith("echo second");

    await clickCopy(0);
    expect(writeText).toHaveBeenLastCalledWith('let a = "first"');
  });

  it("confirms only the block that was copied", async () => {
    render(<PlaybookContent blocks={blocks} />);
    await clickCopy(0);

    const labels = copyButtons().map((button) => button.textContent);
    expect(labels[0]).toContain("Copied");
    expect(labels[1]).not.toContain("Copied");
  });

  it("does not carry a confirmation over to replaced content", async () => {
    render(<CodeBlock code="echo first" language="shell" />);
    await clickCopy();
    expect(text()).toContain("Copied");

    render(<CodeBlock code="echo second" language="shell" />);
    expect(text()).not.toContain("Copied");
  });

  it("drops its pending timer when it unmounts", async () => {
    const clearTimer = vi.spyOn(globalThis, "clearTimeout");
    render(<CodeBlock code="echo hi" language="shell" />);
    await clickCopy();

    act(() => root.unmount());
    expect(clearTimer).toHaveBeenCalled();

    // Nothing is left to fire against the unmounted tree.
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    root = createRoot(container);
  });
});

describe("copying inside a form", () => {
  it("neither submits the form nor activates anything else", async () => {
    const submitted = vi.fn((event: React.FormEvent) => event.preventDefault());
    const toggled = vi.fn();

    render(
      <form onSubmit={submitted}>
        <CodeBlock code="echo hi" language="shell" />
        <button type="button" onClick={toggled}>
          Mark complete
        </button>
      </form>,
    );
    await clickCopy();

    expect(writeText).toHaveBeenCalledWith("echo hi");
    expect(submitted).not.toHaveBeenCalled();
    expect(toggled).not.toHaveBeenCalled();
  });
});
