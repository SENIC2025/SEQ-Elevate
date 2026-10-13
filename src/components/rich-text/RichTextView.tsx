import { Fragment, type ReactNode } from "react";
import { legacyTextToDoc } from "@/lib/rich-text/from-legacy";
import { linkifyInline } from "@/lib/rich-text/linkify";
import { isEmptyDoc, sanitizeRichText } from "@/lib/rich-text/sanitize";
import {
  RT_LIMITS,
  type RtBlock,
  type RtInline,
  type RtListItem,
  type RtParagraph,
  type RtText,
} from "@/lib/rich-text/types";
import { cn } from "@/lib/utils";
import { QuickLink } from "./QuickLink";

/**
 * The one renderer for lesson text (D36): rich paragraphs and key messages
 * from the editor, and every plain text that came before them (through
 * FormattedText), so learners, the course page and the editor's previews
 * all show a block the same way.
 *
 * `rich` is sanitized here on every render, whatever it claims to be: a
 * lesson can also arrive from a direct database write or the external CMS
 * without passing the save action. Without usable rich text — none, an
 * unknown format version, or one that fails the check — the block's plain
 * `text` is shown by Round 1's rules (parseLegacyText), exactly as typed.
 *
 * Only whitelisted elements come out: p, br, strong, em, ul, ol and li,
 * with text always as React text nodes (escaped), never as HTML. The only
 * attributes are a numbered list's start and a paragraph's indent (an
 * inline padding), both clamped here once more. Lists render no deeper
 * than RT_LIMITS.maxListDepth, so recursion is bounded even on its own.
 *
 * Quick links: web and email addresses in the text are shown as links
 * (QuickLink, an <a> opening an https, http or mailto address in a new
 * tab), found at render time by linkifyInline — nothing stored changes,
 * and text without an address renders exactly as before.
 *
 * Pure (no hooks of its own, no editor code), so server and client render
 * the same markup. Renders nothing when there is no text.
 */
export function RichTextView({
  rich,
  text,
  className,
  compact = false,
  inertLinks = false,
}: {
  /** A block's stored rich text, unchecked. */
  rich?: unknown;
  /** The block's plain text, shown when `rich` isn't usable. */
  text?: string;
  className?: string;
  /** Tighter spacing, for small containers such as callouts. */
  compact?: boolean;
  /**
   * Show addresses looking like links, but not as links: for a preview
   * that is itself a button (the lesson editor's block preview), where a
   * link would be a control inside a control and a click would leave the
   * editor instead of opening it.
   */
  inertLinks?: boolean;
}) {
  const value = rich == null ? null : sanitizeRichText(rich).value;
  // Plain text is converted, not sanitized: existing lessons must render
  // byte for byte as they did before rich text (legacy-parity.test.ts).
  const doc =
    value?.doc ?? legacyTextToDoc(typeof text === "string" ? text : "");
  if (isEmptyDoc(doc)) return null;

  return (
    <div
      className={cn(
        "seq-prose",
        compact && "seq-prose-compact",
        // Spaces as the editor keeps them (its white-space is break-spaces):
        // runs of them, and spaces typed to indent a line, show as typed.
        // Sanitized text holds no line breaks or tabs, and plain text keeps
        // Round 1's rendering.
        value && "whitespace-break-spaces",
        className
      )}
    >
      {doc.content.map((block, i) =>
        renderBlock(block, i, 1, inertLinks ? "inert" : "live")
      )}
    </div>
  );
}

/** One indent step, in rem. */
export const RT_INDENT_STEP_REM = 1.5;

/**
 * A paragraph's indent as its padding-inline-start ("3rem" for two steps),
 * or null for none. Anything but a number of steps is none; more than
 * RT_LIMITS.maxIndent is the most. The editor writes an indent with the
 * same value, so a paragraph sits in the same place while it's edited.
 */
export function indentPadding(indent: unknown): string | null {
  if (typeof indent !== "number" || !Number.isFinite(indent)) return null;
  const steps = Math.min(RT_LIMITS.maxIndent, Math.max(0, Math.trunc(indent)));
  return steps > 0 ? `${steps * RT_INDENT_STEP_REM}rem` : null;
}

/** A numbered list's first number: RT_LIMITS' range, otherwise 1. */
function listStart(start: unknown): number {
  return typeof start === "number" &&
    Number.isInteger(start) &&
    start >= 0 &&
    start <= RT_LIMITS.maxOrderedStart
    ? start
    : 1;
}

/** Whether addresses are real links or only look like them. */
type LinkMode = "live" | "inert";

/**
 * A paragraph or list. `listDepth` is the depth a list here would have
 * (1 at the top level); only top-level paragraphs are indented.
 */
function renderBlock(
  block: RtBlock,
  key: number,
  listDepth: number,
  links: LinkMode
): ReactNode {
  switch (block.type) {
    case "paragraph":
      return renderParagraph(block, key, listDepth === 1, links);
    case "bulletList":
    case "orderedList": {
      if (listDepth > RT_LIMITS.maxListDepth) return null;
      const items = block.content.map((item, i) =>
        renderItem(item, i, listDepth, links)
      );
      return block.type === "bulletList" ? (
        <ul key={key}>{items}</ul>
      ) : (
        // Always written out, even for 1: Round 1 does the same.
        <ol key={key} start={listStart(block.attrs?.start)}>
          {items}
        </ol>
      );
    }
    default:
      return null;
  }
}

function renderParagraph(
  paragraph: RtParagraph,
  key: number,
  topLevel: boolean,
  links: LinkMode
): ReactNode {
  // An empty paragraph adds no space for learners.
  if (!paragraph.content?.length) return null;
  const padding = topLevel ? indentPadding(paragraph.attrs?.indent) : null;
  return (
    <p key={key} style={padding ? { paddingInlineStart: padding } : undefined}>
      {renderInline(paragraph.content, links)}
    </p>
  );
}

/**
 * A list item, rendered tight: the first paragraph's text sits directly in
 * the <li> (so "• Pause" is <li>Pause</li>, as in Round 1), and anything
 * after it — more paragraphs, a nested list — follows as blocks. A point
 * whose own text was deleted but that still holds a sub-list starts with an
 * empty line, as in the editor, so its bullet doesn't join the sub-list's.
 */
function renderItem(
  item: RtListItem,
  key: number,
  listDepth: number,
  links: LinkMode
) {
  const [first, ...rest] = item.content;
  const lead = first?.type === "paragraph" ? first : null;
  const after = lead ? rest : item.content;
  return (
    <li key={key}>
      {lead?.content?.length ? (
        renderInline(lead.content, links)
      ) : after.length ? (
        <br />
      ) : null}
      {after.map((block, i) => renderBlock(block, i, listDepth + 1, links))}
    </li>
  );
}

/**
 * A paragraph's text, line breaks and links. An address keeps its bold and
 * italic inside the link: <a><strong>…</strong></a>.
 */
function renderInline(
  content: readonly RtInline[],
  links: LinkMode
): ReactNode[] {
  return linkifyInline(content).map((node, i) => {
    if (node.type === "hardBreak") return <br key={i} />;
    if (node.type === "text") {
      return <Fragment key={i}>{withMarks(node)}</Fragment>;
    }
    if (node.type === "link") {
      const text = node.content.map((part, j) => (
        <Fragment key={j}>{withMarks(part)}</Fragment>
      ));
      return links === "live" ? (
        <QuickLink key={i} href={node.href}>
          {text}
        </QuickLink>
      ) : (
        <span key={i} className="seq-link">
          {text}
        </span>
      );
    }
    return null;
  });
}

/**
 * A plain string — a list block's point, say — with its web and email
 * addresses as links, by the same rules as lesson text. A string without
 * an address is rendered as it is.
 */
export function LinkedText({ text }: { text: string }) {
  return <>{renderInline([{ type: "text", text }], "live")}</>;
}

/** Bold outside italic: <strong><em>…</em></strong>. */
function withMarks(node: RtText): ReactNode {
  const marks = node.marks ?? [];
  let out: ReactNode = node.text;
  if (marks.some((mark) => mark.type === "italic")) out = <em>{out}</em>;
  if (marks.some((mark) => mark.type === "bold")) out = <strong>{out}</strong>;
  return out;
}
