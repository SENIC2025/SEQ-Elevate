import { Fragment, type ReactNode } from "react";
import { legacyTextToDoc } from "@/lib/rich-text/from-legacy";
import { linkSite, textIsSite } from "@/lib/rich-text/link-site";
import { emailAddressOf } from "@/lib/rich-text/link-url";
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
 * Only whitelisted elements come out: p, br, strong, em, ul, ol, li, and
 * for links a and span, with text always as React text nodes (escaped),
 * never as HTML. The only attributes are a numbered list's start, a
 * paragraph's indent (an inline padding), both clamped here once more, and
 * a link's (below). Lists render no deeper than RT_LIMITS.maxListDepth, so
 * recursion is bounded even on its own.
 *
 * Links (QuickLink, an <a> opening an https, http or mailto address in a
 * new tab): a named link (D104) is the run of neighbouring text with the
 * same link mark — an address the sanitizer has just checked and
 * normalised — drawn as one <a> with its bold and italic inside it; a line
 * break ends it. After its words, inside it, a named web link shows the
 * site it opens in a small box (link-site.ts; the owner's decision of 22
 * October 2026), unless its words are its address. Quick links: web and
 * email addresses typed in the rest of the text are found at render time
 * by linkifyInline, which never looks inside a named link, so no link is
 * ever inside another and a typed address never runs into a named one;
 * their words are the address, so they show no box. Text without a link
 * renders exactly as before.
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
  lang,
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
   * editor instead of opening it. A named link's address shows as its
   * title, so authors can see where it goes, and its site's box as
   * learners see it.
   */
  inertLinks?: boolean;
  /**
   * The text's language, when it isn't the page's (WCAG 3.1.2): a course
   * shown in English on a German page. Absent, nothing is added.
   */
  lang?: string;
}) {
  const value = rich == null ? null : sanitizeRichText(rich).value;
  // Plain text is converted, not sanitized: existing lessons must render
  // byte for byte as they did before rich text (legacy-parity.test.ts).
  const doc =
    value?.doc ?? legacyTextToDoc(typeof text === "string" ? text : "");
  if (isEmptyDoc(doc)) return null;

  return (
    <div
      lang={lang}
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

/** A named link's address, from its mark (already checked), or null. */
function namedHref(node: RtInline): string | null {
  if (node.type !== "text") return null;
  const mark = node.marks?.find((m) => m.type === "link");
  return mark?.type === "link" ? mark.attrs.href : null;
}

/**
 * A paragraph's text, line breaks and links. A link keeps its bold and
 * italic inside it: <a><strong>…</strong></a>. Named links are taken out
 * first; quick links are looked for in the unlinked text between them.
 */
function renderInline(
  content: readonly RtInline[],
  links: LinkMode
): ReactNode[] {
  const out: ReactNode[] = [];
  let unlinked: RtInline[] = [];
  const flush = () => {
    if (!unlinked.length) return;
    for (const node of linkifyInline(unlinked)) {
      const key = out.length;
      if (node.type === "hardBreak") out.push(<br key={key} />);
      else if (node.type === "text") out.push(<Fragment key={key}>{withMarks(node)}</Fragment>);
      else out.push(renderLink(node.href, node.content, key, links, false));
    }
    unlinked = [];
  };
  for (let i = 0; i < content.length; ) {
    const href = namedHref(content[i]);
    if (href === null) {
      unlinked.push(content[i]);
      i++;
      continue;
    }
    flush();
    const run: RtText[] = [];
    while (i < content.length && namedHref(content[i]) === href) {
      run.push(content[i] as RtText);
      i++;
    }
    out.push(renderLink(href, run, out.length, links, true));
  }
  flush();
  return out;
}

/**
 * One link: live, a QuickLink; inert, a span that looks like one (a named
 * link's span says where it goes: the address, or an email link's bare
 * address). A named link's words are followed by its site's box, if it
 * has one.
 */
function renderLink(
  href: string,
  content: readonly RtText[],
  key: number,
  links: LinkMode,
  named: boolean
): ReactNode {
  const text = content.map((part, j) => (
    <Fragment key={j}>{withMarks(part)}</Fragment>
  ));
  const site = named ? siteLabel(href, content) : null;
  if (links === "live") {
    return (
      <QuickLink key={key} href={href}>
        {text}
        {site}
      </QuickLink>
    );
  }
  return (
    <span
      key={key}
      className="seq-link"
      title={named ? (emailAddressOf(href) ?? href) : undefined}
    >
      {text}
      {site}
    </span>
  );
}

/**
 * The site a named link opens (linkSite), drawn after its words: a ", "
 * only screen readers hear, then the site in a box (.seq-link-site in
 * globals.css), so its name reads "the guide, example.org (opens in a new
 * tab)". The ", " is hidden by .seq-link-sep, not .sr-only: an absolutely
 * positioned element counts as a block in a link's name, and browsers put
 * a space before it ("the guide , example.org"). Nothing when the link
 * has no site (an email link) or its words are its address (textIsSite).
 */
function siteLabel(href: string, content: readonly RtText[]): ReactNode {
  const site = linkSite(href);
  if (site === null) return null;
  if (textIsSite(content.map((part) => part.text).join(""), href)) return null;
  return (
    <>
      <span className="seq-link-sep">, </span>
      <span className="seq-link-site">{site}</span>
    </>
  );
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
