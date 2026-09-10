export type CodeTokenKind = "plain" | "comment" | "string" | "keyword" | "number" | "flag";

export interface CodeToken {
  text: string;
  kind: CodeTokenKind;
}

const SWIFT_KEYWORDS =
  "as|async|await|break|case|catch|class|continue|default|defer|deinit|do|else|enum|extension|" +
  "fallthrough|false|final|for|func|guard|if|import|in|init|internal|is|lazy|let|nil|open|" +
  "override|private|protocol|public|repeat|return|self|static|struct|switch|throw|throws|true|" +
  "try|typealias|var|weak|where|while";

const SHELL_KEYWORDS =
  "case|cd|do|done|echo|elif|else|esac|exit|export|fi|for|function|if|in|local|read|return|" +
  "set|source|sudo|then|unset|until|while";

interface Rule {
  kind: CodeTokenKind;
  pattern: string;
}

const GRAMMARS: Record<string, Rule[]> = {
  swift: [
    { kind: "comment", pattern: String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/` },
    { kind: "string", pattern: String.raw`"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"` },
    { kind: "keyword", pattern: String.raw`\b(?:${SWIFT_KEYWORDS})\b` },
    { kind: "number", pattern: String.raw`\b\d[\d_]*(?:\.\d+)?\b` },
  ],
  shell: [
    { kind: "comment", pattern: String.raw`#[^\n]*` },
    { kind: "string", pattern: String.raw`"(?:\\.|[^"\\])*"|'[^']*'` },
    { kind: "flag", pattern: String.raw`(?<=^|\s)--?[A-Za-z][\w-]*` },
    { kind: "keyword", pattern: String.raw`\b(?:${SHELL_KEYWORDS})\b` },
    { kind: "number", pattern: String.raw`\b\d+\b` },
  ],
};

const ALIASES: Record<string, keyof typeof GRAMMARS> = {
  swift: "swift",
  shell: "shell",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  console: "shell",
  terminal: "shell",
};

export function highlightedLanguage(language: string | null | undefined): string | undefined {
  return language ? ALIASES[language.trim().toLowerCase()] : undefined;
}

/**
 * Splits code into display tokens. Concatenating every `text` reproduces the
 * input exactly, so highlighting can never alter what a reader copies.
 */
export function tokenize(code: string, language: string | null | undefined): CodeToken[] {
  const grammar = GRAMMARS[highlightedLanguage(language) ?? ""];
  if (!grammar || !code) return code ? [{ text: code, kind: "plain" }] : [];

  const scanner = new RegExp(grammar.map((rule) => `(${rule.pattern})`).join("|"), "gu");
  const tokens: CodeToken[] = [];
  let last = 0;

  for (const match of code.matchAll(scanner)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ text: code.slice(last, index), kind: "plain" });
    const group = match.slice(1).findIndex((value) => value !== undefined);
    tokens.push({ text: match[0], kind: grammar[group]?.kind ?? "plain" });
    last = index + match[0].length;
  }

  if (last < code.length) tokens.push({ text: code.slice(last), kind: "plain" });
  return tokens;
}
