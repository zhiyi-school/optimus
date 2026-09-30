/**
 * Rendering and plain-text conversion for the inline markdown used in playbook content.
 */

import type { ReactNode } from "react";

const TOKEN =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+)/g;

/** An external link that opens in a new tab without referrer. */
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

const LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
const CODE_SPAN = /`([^`]+)`/g;
const ASTERISK_EMPHASIS = /(\*{1,3})(\S(?:[\s\S]*?\S)?)\1/g;
const UNDERSCORE_EMPHASIS = /(^|[^\w])(_{1,3})(\S(?:[\s\S]*?\S)?)\2(?!\w)/g;

/** Strips links, code spans and (nested) emphasis from markdown, for places that render plain text. */
export function plainText(text: string | undefined | null): string {
  if (!text) return "";
  let result = text.replace(LINK, "$1").replace(CODE_SPAN, "$1");
  for (let pass = 0; pass < 3; pass += 1) {
    const next = result.replace(ASTERISK_EMPHASIS, "$2").replace(UNDERSCORE_EMPHASIS, "$1$3");
    if (next === result) break;
    result = next;
  }
  return result.trim();
}

/** Renders the playbook's inline markdown subset: code spans, bold, links and bare URLs. */
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
