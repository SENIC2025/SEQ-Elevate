import type { NarrativeBlock } from "@/lib/cms/types";

/**
 * The starting points offered by "Add block" — each makes one empty block
 * of a kind learners can already see (NarrativeStage renders all of them).
 * Paragraphs and key messages are written with formatting (bold, italic,
 * lists, indent — D36); a list block is a plain list of short points, shown
 * with bullets or numbers.
 *
 * Labels are authoring-tool copy, which stays English like the other tools.
 */
export interface BlockTemplate {
  id: "paragraph" | "callout" | "bulleted-list" | "numbered-list" | "compare";
  label: string;
  /** One line under the label, saying when to use it. */
  hint: string;
  make: () => NarrativeBlock;
}

export const BLOCK_TEMPLATES: readonly BlockTemplate[] = [
  {
    id: "paragraph",
    label: "Paragraph",
    hint: "Text with bold, italic, bullet points, numbering and indent.",
    make: () => ({ kind: "paragraph", text: "" }),
  },
  {
    id: "callout",
    label: "Key message (callout)",
    hint: "One point learners should remember, highlighted.",
    make: () => ({ kind: "callout", text: "" }),
  },
  {
    id: "bulleted-list",
    label: "Bulleted list",
    hint: "Short points in no particular order.",
    make: () => ({ kind: "list", items: ["", ""], listStyle: "bullet" }),
  },
  {
    id: "numbered-list",
    label: "Numbered list",
    hint: "Steps or points in order.",
    make: () => ({ kind: "list", items: ["", ""], listStyle: "number" }),
  },
  {
    id: "compare",
    label: "Compare two sides",
    hint: "Two ways side by side — for example, what to avoid and what to try.",
    make: () => ({
      kind: "compare",
      compare: [
        { label: "", text: "", tone: "negative" },
        { label: "", text: "", tone: "positive" },
      ],
    }),
  },
];

/**
 * A short name for a block, for its header and screen readers. A list is
 * named by how learners see it; one saved before list styles existed has
 * no style and shows numbers.
 */
export function blockLabel(
  block: Pick<NarrativeBlock, "kind" | "listStyle">
): string {
  switch (block.kind) {
    case "paragraph":
      return "Paragraph";
    case "callout":
      return "Key message";
    case "list":
      return block.listStyle === "bullet" ? "Bulleted list" : "Numbered list";
    case "compare":
      return "Compare two sides";
  }
}
