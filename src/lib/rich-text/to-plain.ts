import type { RtBlock, RtDoc, RtInline, RtList } from "./types";

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
 *   a space, since a new line would end the list.
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
  return (content ?? [])
    .map((node) => (node.type === "text" ? node.text : lineBreak))
    .join("");
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
