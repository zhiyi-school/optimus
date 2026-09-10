import { describe, expect, it } from "vitest";
import { highlightedLanguage, tokenize } from "@/lib/code-highlight";

function rebuilt(code: string, language: string | null | undefined) {
  return tokenize(code, language)
    .map((token) => token.text)
    .join("");
}

const SAMPLES: Record<string, string> = {
  swift: 'let name = "example" // a note\nvar count = 42',
  shell: '# a note\nunzip example.ipa -d out --verbose\necho "done"',
  text: "plain content",
};

describe("which languages are highlighted", () => {
  it.each([
    ["swift", "swift"],
    ["Swift", "swift"],
    ["shell", "shell"],
    ["bash", "shell"],
    ["sh", "shell"],
    ["zsh", "shell"],
  ])("recognises %s", (input, expected) => {
    expect(highlightedLanguage(input)).toBe(expected);
  });

  it.each(["text", "env", "rust", "", null, undefined])(
    "leaves %s to render as plain text",
    (input) => {
      expect(highlightedLanguage(input)).toBeUndefined();
    },
  );
});

describe("tokenizing never changes the code", () => {
  it.each(Object.entries(SAMPLES))("rebuilds %s exactly", (language, code) => {
    expect(rebuilt(code, language)).toBe(code);
  });

  it.each(["swift", "shell", "text", null])(
    "rebuilds awkward characters exactly for %s",
    (language) => {
      const code = 'a\t"b" \\\\ \'c\' — café ✅\n\n  indented\n';
      expect(rebuilt(code, language)).toBe(code);
    },
  );

  it("rebuilds an unterminated string exactly", () => {
    const code = 'let a = "never closed\nlet b = 1';
    expect(rebuilt(code, "swift")).toBe(code);
  });

  it("has nothing to show for empty code", () => {
    expect(tokenize("", "swift")).toEqual([]);
  });
});

describe("what each grammar marks", () => {
  it("marks Swift keywords, strings, comments and numbers", () => {
    const kinds = new Map(tokenize(SAMPLES.swift, "swift").map((t) => [t.text, t.kind]));
    expect(kinds.get("let")).toBe("keyword");
    expect(kinds.get('"example"')).toBe("string");
    expect(kinds.get("// a note")).toBe("comment");
    expect(kinds.get("42")).toBe("number");
  });

  it("marks shell comments, flags and strings", () => {
    const kinds = new Map(tokenize(SAMPLES.shell, "shell").map((t) => [t.text, t.kind]));
    expect(kinds.get("# a note")).toBe("comment");
    expect(kinds.get("--verbose")).toBe("flag");
    expect(kinds.get("-d")).toBe("flag");
    expect(kinds.get('"done"')).toBe("string");
    expect(kinds.get("echo")).toBe("keyword");
  });

  it("does not mistake a hyphen inside a word for a flag", () => {
    expect(tokenize("patched-ipa", "shell").every((t) => t.kind === "plain")).toBe(true);
  });

  it("gives an unknown language one plain token", () => {
    expect(tokenize("anything at all", "rust")).toEqual([
      { text: "anything at all", kind: "plain" },
    ]);
  });

  it("gives code with no language one plain token", () => {
    expect(tokenize("anything at all", null)).toEqual([
      { text: "anything at all", kind: "plain" },
    ]);
  });
});
