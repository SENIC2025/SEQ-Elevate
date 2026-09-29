/**
 * The stored rich-text format for lesson paragraphs and key messages (D36).
 *
 * A narrative block keeps `rich = { v: 1, doc }` next to its plain `text`.
 * `doc` is a small subset of the editor's (ProseMirror) JSON: paragraphs with
 * bold and italic text and line breaks, an optional indent, and bulleted or
 * numbered lists nested up to three levels. Nothing else is ever stored —
 * no links, images, styles or headings — and every read and write goes
 * through sanitizeRichText, which rebuilds the doc from this whitelist.
 *
 * Canonical form (what sanitizeRichText returns, and what legacyTextToDoc
 * builds): default attributes are omitted (indent 0, start 1); marks are
 * ordered bold, then italic; neighbouring text with the same marks is one
 * node; blank paragraphs at the top level are dropped (learners never see
 * blank lines), keeping one when the doc would otherwise be empty.
 *
 * Pure types and limits, safe to import anywhere.
 */

export const RT_LIMITS = {
  /** The sanitized value as JSON text. */
  maxJsonChars: 50_000,
  /** Every node and mark visited, dropped ones included. */
  maxNodes: 1_500,
  /** Characters of text in one block. */
  maxTextChars: 10_000,
  /** Lists nested deeper than this are flattened into the deepest level. */
  maxListDepth: 3,
  /** Indent steps of a top-level paragraph (1.5rem each). */
  maxIndent: 4,
  maxOrderedStart: 999,
  /** Content blocks in one lesson (see sanitizeNarrativeBlocks). */
  maxBlocks: 100,
} as const;

export type RtMark = { type: "bold" } | { type: "italic" };

export type RtText = { type: "text"; text: string; marks?: RtMark[] };
export type RtHardBreak = { type: "hardBreak" };
export type RtInline = RtText | RtHardBreak;

/**
 * `indent` (1–4) only on top-level paragraphs: inside a list, nesting is
 * the indent. An empty paragraph has no `content`.
 */
export type RtParagraph = {
  type: "paragraph";
  attrs?: { indent: number };
  content?: RtInline[];
};

/** content[0] is always a paragraph; more paragraphs and nested lists follow. */
export type RtListItem = { type: "listItem"; content: RtBlock[] };

export type RtBulletList = { type: "bulletList"; content: RtListItem[] };
/** `start` 0–999; absent = 1. */
export type RtOrderedList = {
  type: "orderedList";
  attrs?: { start: number };
  content: RtListItem[];
};
export type RtList = RtBulletList | RtOrderedList;

export type RtBlock = RtParagraph | RtList;

/** Never empty: an empty doc holds one empty paragraph. */
export type RtDoc = { type: "doc"; content: RtBlock[] };

export interface RichTextV1 {
  v: 1;
  doc: RtDoc;
}

/**
 * Every stored version. An unknown `v` (a newer format read by an older
 * deployment) is rendered from the block's plain `text` instead.
 */
export type RichText = RichTextV1;
