import type { NarrativeBlock } from "@/lib/cms/types";

/**
 * The starting points offered by "Add block" — each makes one empty block
 * of a kind learners can already see (NarrativeStage renders all four).
 * Only what the learner view renders today: list blocks are always shown as
 * numbered lists, so there is no "Bulleted list" template yet — bullets in a
 * paragraph ("• " lines) already render as a real list (Round 1's
 * FormattedText). Round 3 adds bulleted list blocks.
 *
 * Labels are authoring-tool copy, which stays English like the other tools.
 */
export interface BlockTemplate {
  id: "paragraph" | "callout" | "numbered-list" | "compare";
  label: string;
  /** One line under the label, saying when to use it. */
  hint: string;
  make: () => NarrativeBlock;
}

export const BLOCK_TEMPLATES: readonly BlockTemplate[] = [
  {
    id: "paragraph",
    label: "Paragraph",
    hint: "Plain text. Start a line with • or - for a bullet point.",
    make: () => ({ kind: "paragraph", text: "" }),
  },
  {
    id: "callout",
    label: "Key message (callout)",
    hint: "One point learners should remember, highlighted.",
    make: () => ({ kind: "callout", text: "" }),
  },
  {
    id: "numbered-list",
    label: "Numbered list",
    hint: "Steps or points in order.",
    make: () => ({ kind: "list", items: ["", ""] }),
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

/** A short name for a block of this kind, for its header and screen readers. */
export const BLOCK_KIND_LABEL: Record<NarrativeBlock["kind"], string> = {
  paragraph: "Paragraph",
  callout: "Key message",
  list: "Numbered list",
  compare: "Compare two sides",
};
