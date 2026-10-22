import { emailAddressOf } from "./link-url";
import { findLinks } from "./linkify";
import type { RtBlock, RtDoc, RtInline, RtList, RtText } from "./types";

/**
 * The plain `text` stored beside a rich block (D36), derived on the server
 * from the doc. It is what code reading `.text` shows — the reflection
 * intro (db-course.ts), a deployment from before rich text, or a reader of
 * a format version it doesn't know — so it's written the way authors type
 * lists, and parseLegacyText reads it back as the same paragraphs and
 * lists, only without bold, italic, indent and nesting:
 *
 * - blocks are separated by a blank line; a line break stays a line break;
 * - a bullet is "• item", a numbered item "3. item" with its real number;
 * - nested items follow their parent, each with its own list's marker;
 * - inside an item, further paragraphs and line breaks join its line with
 *   a space, since a new line would end the list;
 * - a link (D104) is its text followed by its address in brackets, "the
 *   guide (https://example.org/guide)" (an email link's bare address), or
 *   its text alone when that already shows the address — so a reader of
 *   `text` still sees where every link goes, and draws the address as a
 *   quick link.
 *
 * (A paragraph that itself starts with "- " or "1. " reads back as a list:
 * plain text has no way to say otherwise.)
 */
export function docToPlainText(doc: Pick<RtDoc, "content">): string {
  return doc.content
    .map(blockText)
    .filter((text) => text.trim() !== "")
    .join("\n\n");
}

function blockText(block: RtBlock): string {
  if (block.type === "paragraph") return inlineText(block.content, "\n");
  const lines: string[] = [];
  listLines(block, lines);
  return lines.join("\n");
}

function inlineText(content: RtInline[] | undefined, lineBreak: string) {
  const nodes = content ?? [];
  let out = "";
  for (let i = 0; i < nodes.length; ) {
    const node = nodes[i];
    if (node.type !== "text") {
      out += lineBreak;
      i++;
      continue;
    }
    const href = linkOf(node);
    if (href === null) {
      out += node.text;
      i++;
      continue;
    }
    // One link: neighbouring text with the same address.
    let label = node.text;
    for (i++; i < nodes.length; i++) {
      const next = nodes[i];
      if (next.type !== "text" || linkOf(next) !== href) break;
      label += next.text;
    }
    out += withAddress(label, href);
  }
  return out;
}

function linkOf(node: RtText): string | null {
  const mark = node.marks?.find((m) => m.type === "link");
  return mark?.type === "link" ? mark.attrs.href : null;
}

/** "label (address)", or the label alone when it shows the address already. */
function withAddress(label: string, href: string): string {
  const email = emailAddressOf(href);
  const address = email ?? href;
  if (shows(label, href, email)) return label;
  const core = label.trim();
  if (!core) return label;
  const lead = label.slice(0, label.length - label.trimStart().length);
  const trail = label.slice(label.trimEnd().length);
  return `${lead}${core} (${address})${trail}`;
}

/** Does `label` show the link's address (as typed, or as a quick link reads it)? */
function shows(label: string, href: string, email: string | null): boolean {
  if (label.includes(email ?? href)) return true;
  return findLinks(label).some((found) =>
    email === null
      ? found.href === href
      : emailAddressOf(found.href)?.toLowerCase() === email.toLowerCase()
  );
}

function listLines(list: RtList, out: string[]) {
  const start = list.type === "orderedList" ? (list.attrs?.start ?? 1) : 0;
  list.content.forEach((item, i) => {
    const own = item.content
      .map((child) =>
        child.type === "paragraph" ? inlineText(child.content, " ").trim() : ""
      )
      .filter(Boolean)
      .join(" ");
    // An item with no text of its own (only a nested list) gets no line: a
    // bare "3." would read back as a paragraph. It still counts, so the
    // numbers after it stay right.
    if (own) {
      out.push(
        list.type === "bulletList" ? `• ${own}` : `${start + i}. ${own}`
      );
    }
    for (const child of item.content) {
      if (child.type !== "paragraph") listLines(child, out);
    }
  });
}
