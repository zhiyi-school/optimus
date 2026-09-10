import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { tokenize, type CodeTokenKind } from "@/lib/code-highlight";

const FEEDBACK_MS = 1500;

const TOKEN_CLASS: Record<CodeTokenKind, string> = {
  plain: "",
  comment: "text-muted-foreground italic",
  string: "text-success",
  keyword: "text-primary font-medium",
  number: "text-warning",
  flag: "text-primary",
};

type CopyState = "idle" | "copied" | "failed";

export function CodeBlock({ code, language }: { code: string; language?: string | null }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tokens = useMemo(() => tokenize(code, language), [code, language]);
  const label = language?.trim() || null;

  // Feedback belongs to the text that was copied, not to whatever replaces it.
  useEffect(() => {
    clearTimeout(timer.current);
    setState("idle");
  }, [code]);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    let next: CopyState = "failed";
    try {
      if (typeof navigator.clipboard?.writeText !== "function") throw new Error("unavailable");
      await navigator.clipboard.writeText(code);
      next = "copied";
    } catch {
      next = "failed";
    }
    setState(next);
    timer.current = setTimeout(() => setState("idle"), FEEDBACK_MS);
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted/40">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/60 px-3 py-1.5">
        <span className="font-mono text-xs text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2">
          {state === "failed" && (
            <span className="inline-flex items-center gap-1 text-xs text-danger">
              <TriangleAlert className="h-3.5 w-3.5" />
              Copy is unavailable — select the code to copy it.
            </span>
          )}
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={label ? `Copy ${label} code` : "Copy code"}
            className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {state === "copied" ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {state === "copied" ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-xs leading-relaxed text-foreground">
        <code className="font-mono">
          {tokens.map((token, index) =>
            token.kind === "plain" ? (
              token.text
            ) : (
              <span key={index} className={TOKEN_CLASS[token.kind]}>
                {token.text}
              </span>
            ),
          )}
        </code>
      </pre>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "copied" ? "Code copied to clipboard" : ""}
        {state === "failed" ? "Could not copy the code to the clipboard" : ""}
      </span>
    </div>
  );
}
