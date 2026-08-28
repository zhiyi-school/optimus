import type { ReactNode } from "react";

const TOKEN =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+)/g;

function link(href: string, label: string, key: number): ReactNode {
  return (
    <a
      key={key}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline underline-offset-2 hover:no-underline"
    >
      {label}
    </a>
  );
}

/** The subset of markdown the playbook uses inline: code spans, bold, links. */
export function renderInline(text: string | undefined | null): ReactNode {
  if (!text) return null;
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;

  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(text); match !== null; match = TOKEN.exec(text)) {
    const [whole, code, bold, linkLabel, linkHref, bareUrl] = match;
    if (match.index > last) parts.push(text.slice(last, match.index));

    if (code) {
      parts.push(
        <code
          key={key++}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground"
        >
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      parts.push(
        <strong key={key++} className="font-semibold">
          {bold.slice(2, -2)}
        </strong>,
      );
    } else if (linkHref) {
      parts.push(link(linkHref, linkLabel, key++));
    } else if (bareUrl) {
      parts.push(link(bareUrl, bareUrl, key++));
    }

    last = match.index + whole.length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : parts;
}
