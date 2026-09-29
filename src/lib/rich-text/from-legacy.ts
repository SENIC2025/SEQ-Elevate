import { parseLegacyText, type LegacyNode } from "./legacy";
import type { RtBlock, RtDoc, RtInline, RtListItem } from "./types";

/**
 * Plain lesson text as a rich-text doc — by exactly the rules learners
 * already see (parseLegacyText, Round 1), so opening an old block in the
 * editor shows the paragraphs and lists it already had, and the learner
 * view renders old and new blocks through one renderer.
 *
 * A paragraph's lines are joined by line breaks; "•" and "1." lines become
 * bulleted and numbered lists, keeping the number a list starts at. The
 * structure is already canonical (see types.ts); the text is kept exactly
 * as typed, as Round 1 renders it. An empty text is a doc holding one empty
 * paragraph, as the editor needs.
 */
export function legacyNodesToDoc(nodes: readonly LegacyNode[]): RtDoc {
  const content = nodes.map(toBlock);
  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
}

export function legacyTextToDoc(text: string | null | undefined): RtDoc {
  return legacyNodesToDoc(parseLegacyText(typeof text === "string" ? text : ""));
}

function toBlock(node: LegacyNode): RtBlock {
  if (node.type === "paragraph") {
    const content: RtInline[] = [];
    node.lines.forEach((line, i) => {
      if (i > 0) content.push({ type: "hardBreak" });
      content.push({ type: "text", text: line });
    });
    return { type: "paragraph", content };
  }
  const items = node.items.map(toItem);
  if (node.type === "bullets") return { type: "bulletList", content: items };
  return node.start === 1
    ? { type: "orderedList", content: items }
    : { type: "orderedList", attrs: { start: node.start }, content: items };
}

function toItem(text: string): RtListItem {
  return {
    type: "listItem",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}
