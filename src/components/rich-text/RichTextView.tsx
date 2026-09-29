import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { legacyTextToDoc } from "@/lib/rich-text/from-legacy";
import { isEmptyDoc, sanitizeRichText } from "@/lib/rich-text/sanitize";
import type { RtBlock, RtInline, RtListItem } from "@/lib/rich-text/types";

/**
 * STAND-IN for R3-B's RichTextView (design §2.5), with the same export and
 * props, so the editor's block previews build and render on the editor
 * branch. R3-B's file replaces this one when the branches merge.
 *
 * Stored rich text is sanitized on every render; without a readable `rich`,
 * the plain `text` renders by Round 1's rules. Only React elements and text
 * nodes — never HTML.
 */
export function RichTextView({
  rich,
  text,
  className,
  compact = false,
}: {
  rich?: unknown;
  text?: string;
  className?: string;
  compact?: boolean;
}) {
  const value = rich == null ? null : sanitizeRichText(rich).value;
  const doc = value?.doc ?? legacyTextToDoc(text);
  if (isEmptyDoc(doc)) return null;
  return (
    <div className={cn("seq-prose", compact && "seq-prose-compact", className)}>
      {doc.content.map(renderBlock)}
    </div>
  );
}

function renderBlock(block: RtBlock, key: number): ReactNode {
  if (block.type === "paragraph") {
    if (!block.content?.length) return null;
    const indent = Math.min(block.attrs?.indent ?? 0, 4);
    return (
      <p
        key={key}
        style={indent ? { paddingInlineStart: `${indent * 1.5}rem` } : undefined}
      >
        {renderInline(block.content)}
      </p>
    );
  }
  const items = block.content.map(renderItem);
  return block.type === "bulletList" ? (
    <ul key={key}>{items}</ul>
  ) : (
    <ol key={key} start={block.attrs?.start ?? 1}>
      {items}
    </ol>
  );
}

function renderItem(item: RtListItem, key: number): ReactNode {
  const [first, ...rest] = item.content;
  return (
    <li key={key}>
      {first?.type === "paragraph" ? renderInline(first.content ?? []) : null}
      {rest.map(renderBlock)}
    </li>
  );
}

function renderInline(content: RtInline[]): ReactNode {
  return content.map((node, i) => {
    if (node.type === "hardBreak") return <br key={i} />;
    let out: ReactNode = node.text;
    const marks = node.marks?.map((m) => m.type) ?? [];
    if (marks.includes("italic")) out = <em>{out}</em>;
    if (marks.includes("bold")) out = <strong>{out}</strong>;
    return <Fragment key={i}>{out}</Fragment>;
  });
}
