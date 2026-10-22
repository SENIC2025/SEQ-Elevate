import { checkLinkHref } from "./link-url";
import { linkTextProblem } from "./link-text";
import { ownFileHost } from "./own-file-host";
import {
  RT_LIMITS,
  type RichText,
  type RtBlock,
  type RtHardBreak,
  type RtInline,
  type RtList,
  type RtListItem,
  type RtMark,
  type RtParagraph,
} from "./types";

/**
 * The one gate for stored rich text (D36): the save action runs it before
 * writing, the editor after every change, and the learner view on every
 * render — content can also reach the page from a direct DB write or the
 * external CMS, unchecked.
 *
 * It never passes input through: it rebuilds a fresh doc from the whitelist
 * in types.ts, so an unknown node, mark or attribute (an image, a `style` or
 * `onclick`) simply isn't copied. Recursion only follows lists
 * and stops at RT_LIMITS.maxListDepth; deeper lists are flattened with a
 * work stack, every node visited counts against RT_LIMITS.maxNodes, and
 * every character of text read against RT_LIMITS.maxJsonChars — so very
 * deep, cyclic or repetitive input ends in a result, never a stack overflow
 * or a hang. Raw input is never JSON.stringify'd (only the rebuilt value is).
 *
 * Links (D104): a text keeps at most one link mark, holding only its
 * address, and only when the one address check (checkLinkHref, link-url.ts)
 * accepts it; the address stored is the normalised one. A link is also
 * dropped when its text, read together with any link it touches, shows
 * another address than it opens (linkTextProblem, link-text.ts), and,
 * silently, when its text is only spaces. Its text is always kept. A doc
 * that still holds a link comes back as version 2, any other as version 1,
 * whatever the input claimed. A save refuses what was dropped (narrative.ts,
 * richTextForSave); a render shows the text without the link.
 *
 * Pure, so it runs the same on the server and in the browser.
 */

/**
 * What the sanitizer found. The fatal ones (RtFatalIssue, below) leave no
 * value:
 * - "bad-envelope": not `{ v: 1 or 2, doc: { type: "doc", content: [...] } }`;
 * - "too-many-nodes", "too-much-text": over RT_LIMITS;
 * - "too-large": the rebuilt value is over RT_LIMITS.maxJsonChars as JSON.
 * The rest were repaired and are only reported.
 */
export type RtFatalIssue =
  | "bad-envelope"
  | "too-many-nodes"
  | "too-much-text"
  | "too-large";

export type RtIssue =
  | RtFatalIssue
  /** A node outside the whitelist (heading, image, table, …) was left out. */
  | "dropped-node"
  /** A mark outside the whitelist (underline, code, …) was left out. */
  | "dropped-mark"
  /**
   * A link was left out, its text kept: an address the check refuses, two
   * links on one text, or link text that shows another address. Named in
   * linkProblems. A save refuses it.
   */
  | "dropped-link"
  /**
   * A link to our own file store was kept (stored links stay links); named
   * in linkProblems. A save refuses it: new links to our files aren't made.
   */
  | "own-file-link"
  /** Lists nested deeper than RT_LIMITS.maxListDepth joined the deepest one. */
  | "list-flattened";

const FATAL: ReadonlySet<RtIssue> = new Set<RtFatalIssue>([
  "bad-envelope",
  "too-many-nodes",
  "too-much-text",
  "too-large",
]);

export function isFatalIssue(issue: RtIssue): issue is RtFatalIssue {
  return FATAL.has(issue);
}

/** Why a link was left out (or, for "own-file", is refused on a save). */
export type LinkProblemReason = "refused" | "redirect" | "misleading" | "own-file";

/**
 * A link a save refuses, by its text: "refused" (the address check refused
 * its address, or the text held two links), "redirect" (an Outlook safe
 * link), "misleading" (its text shows another address) or "own-file".
 */
export interface LinkProblem {
  /** The link's text (for "misleading", with the links it touches), cut to 60 characters. */
  text: string;
  reason: LinkProblemReason;
}

/** At most this many link problems are named. */
const MAX_LINK_PROBLEMS = 5;
/** A link's text in a problem is cut to this many characters. */
const PROBLEM_TEXT_CHARS = 60;

export interface RtSanitized {
  /**
   * The canonical value, or null when a fatal issue stopped it: version 2
   * when it holds a link, else version 1.
   */
  value: RichText | null;
  issues: RtIssue[];
  /** The links behind "dropped-link" and "own-file-link", in order (at most 5). */
  linkProblems: LinkProblem[];
  /** Whether the input held a link mark, as far as it was read. */
  hasLinks: boolean;
}

/* ------------------------------ Characters ------------------------------ */

// Line-breaking whitespace: inside a text node a line break is a hardBreak
// node, so these become plain spaces.
const SPACE_LIKE = /[\t\n\v\f\r\u2028\u2029]/g;

// The other C0 controls, DEL and the C1 controls (invisible, and Postgres
// refuses a NUL in JSON), the bidi embedding/override and isolate characters
// (they make text display differently from how it was typed) and the BOM.
const INVISIBLE =
  /[\u0000-\u0008\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

// A surrogate pair (an emoji: kept) or a lone half of one (dropped — it isn't
// a character, and Postgres refuses JSON holding one).
const SURROGATES = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;
const keepPairs = (m: string) => (m.length === 2 ? m : "");

/** Text for a text node: one line, without invisible characters. */
export function cleanInlineText(text: string): string {
  return text
    .replace(SPACE_LIKE, " ")
    .replace(INVISIBLE, "")
    .replace(SURROGATES, keepPairs);
}

/**
 * Plain text as authors type it (a legacy paragraph, a list item, a title):
 * tabs and line breaks stay, since they carry its structure (see
 * parseLegacyText); a vertical tab or form feed — Word's manual line and
 * page breaks — becomes a line break.
 */
export function cleanPlainText(text: string): string {
  return text
    .replace(/[\v\f]/g, "\n")
    .replace(INVISIBLE, "")
    .replace(SURROGATES, keepPairs);
}

/* -------------------------------- Walker -------------------------------- */

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const typeOf = (node: unknown): string | null =>
  isRecord(node) && typeof node.type === "string" ? node.type : null;

const arrayOf = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const attrOf = (node: Rec, key: string): unknown =>
  isRecord(node.attrs) ? node.attrs[key] : undefined;

/** A whole number within [min, max]; `fallback` for anything but a number. */
function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

const isList = (type: string | null): type is RtList["type"] =>
  type === "bulletList" || type === "orderedList";

/**
 * A text node while the doc is walked: its formatting, and its link as
 * read. A link refused by the check keeps a `key` (its address as sent, or
 * an object of its own) so the text it spans is named once.
 */
type WalkLink =
  | { ok: true; href: string; ownFile: boolean }
  | { ok: false; reason: "refused" | "redirect"; key: unknown };
type WalkText = { type: "text"; text: string; bold: boolean; italic: boolean; link: WalkLink | null };
type WalkInline = WalkText | RtHardBreak;

/** The same link: the same accepted address, or the same refused one. */
function sameLink(a: WalkLink | null, b: WalkLink | null): boolean {
  if (!a || !b) return a === b;
  if (a.ok && b.ok) return a.href === b.href;
  return !a.ok && !b.ok && a.key === b.key;
}

/** Same bold, italic and link (sameMarks, compared by address for links). */
function sameFormat(a: WalkText, b: WalkText): boolean {
  return a.bold === b.bold && a.italic === b.italic && sameLink(a.link, b.link);
}

/** Text for a link problem: trimmed, at most PROBLEM_TEXT_CHARS (never half an emoji). */
function problemText(text: string): string {
  const shown = text.replace(/\s+/g, " ").trim();
  if (shown.length <= PROBLEM_TEXT_CHARS) return shown;
  let cut = PROBLEM_TEXT_CHARS - 1;
  const last = shown.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut--;
  return `${shown.slice(0, cut)}…`;
}

/** Bold, then italic, then link: the canonical order. */
function marksOf(node: WalkText): RtMark[] {
  const marks: RtMark[] = [];
  if (node.bold) marks.push({ type: "bold" });
  if (node.italic) marks.push({ type: "italic" });
  if (node.link?.ok) marks.push({ type: "link", attrs: { href: node.link.href } });
  return marks;
}

/**
 * A list item from its kept children: the first must be a paragraph (an
 * empty one is added otherwise), blank further paragraphs are dropped, and
 * an item with no text at all is left out — learners would see an empty
 * bullet.
 */
function makeItem(kept: RtBlock[]): RtListItem | null {
  const first: RtParagraph =
    kept[0]?.type === "paragraph"
      ? (kept.shift() as RtParagraph)
      : { type: "paragraph" };
  const rest = kept.filter((b) => b.type !== "paragraph" || b.content);
  if (!first.content && rest.length === 0) return null;
  return { type: "listItem", content: [first, ...rest] };
}

class Walker {
  private nodes = 0;
  private chars = 0;
  /** Raw characters looked at, kept or not (see text()). */
  private scanned = 0;
  fatal: RtIssue | null = null;
  readonly issues = new Set<RtIssue>();
  readonly linkProblems: LinkProblem[] = [];
  /** A link mark was read (kept or not). */
  sawLink = false;
  /** A link was kept: the doc is version 2. */
  keptLink = false;

  /** Count one visited node or mark; false once over budget (or failed). */
  private take(): boolean {
    if (this.fatal) return false;
    if (++this.nodes > RT_LIMITS.maxNodes) {
      this.fail("too-many-nodes");
      return false;
    }
    return true;
  }

  private fail(issue: RtIssue) {
    if (this.fatal) return;
    this.fatal = issue;
    this.issues.add(issue);
  }

  /** The doc's top level: paragraphs (blank ones dropped) and lists. */
  blocks(raw: unknown[]): RtBlock[] {
    const out: RtBlock[] = [];
    for (const node of raw) {
      if (!this.take()) break;
      const type = typeOf(node);
      if (type === "paragraph") {
        const paragraph = this.paragraph(node as Rec, false);
        if (paragraph.content) out.push(paragraph);
      } else if (isList(type)) {
        const list = this.list(node as Rec, 1);
        if (list) out.push(list);
      } else {
        this.issues.add("dropped-node");
      }
    }
    return out;
  }

  private paragraph(node: Rec, inList: boolean): RtParagraph {
    const content = this.inline(node.content);
    const paragraph: RtParagraph = { type: "paragraph" };
    // Inside a list, nesting is the indent (and the first paragraph renders
    // inline in its <li>), so only top-level paragraphs keep one.
    const indent = inList
      ? 0
      : clampInt(attrOf(node, "indent"), 0, RT_LIMITS.maxIndent, 0);
    if (content.length) {
      if (indent > 0) paragraph.attrs = { indent };
      paragraph.content = content;
    }
    return paragraph;
  }

  private inline(raw: unknown): RtInline[] {
    const walked: WalkInline[] = [];
    for (const node of arrayOf(raw)) {
      if (!this.take()) break;
      const type = typeOf(node);
      if (type === "hardBreak") walked.push({ type: "hardBreak" });
      else if (type === "text") this.text(node as Rec, walked);
      else this.issues.add("dropped-node");
    }
    const out = this.finishLinks(walked);
    // A line break at either end of a paragraph shows learners nothing.
    while (out[0]?.type === "hardBreak") out.shift();
    while (out[out.length - 1]?.type === "hardBreak") out.pop();
    // Nothing but spaces (Word pastes blank lines as a no-break space) is a
    // blank paragraph.
    return out.some((n) => n.type === "text" && n.text.trim()) ? out : [];
  }

  private text(node: Rec, out: WalkInline[]) {
    const raw = node.text;
    if (typeof raw !== "string") {
      this.issues.add("dropped-node");
      return;
    }
    // Count what is scanned, not what is kept: text that cleans to nothing,
    // or one string referenced many times (a server action's arguments may
    // repeat a value by reference), must not be scanned without end. Real
    // text is at most maxTextChars once cleaned, so this never refuses it.
    this.scanned += raw.length;
    if (this.scanned > RT_LIMITS.maxJsonChars) {
      this.fail("too-much-text");
      return;
    }
    const text = cleanInlineText(raw);
    if (!text) return;
    this.chars += text.length;
    if (this.chars > RT_LIMITS.maxTextChars) {
      this.fail("too-much-text");
      return;
    }
    const current: WalkText = { type: "text", text, ...this.marks(node.marks) };
    if (this.fatal) return;
    const prev = out[out.length - 1];
    if (prev?.type === "text" && sameFormat(prev, current)) {
      prev.text += text;
    } else {
      out.push(current);
    }
  }

  /** Bold, italic and at most one link; anything else is dropped. */
  private marks(raw: unknown): Omit<WalkText, "type" | "text"> {
    let bold = false;
    let italic = false;
    let link: WalkLink | null = null;
    let links = 0;
    for (const mark of arrayOf(raw)) {
      if (!this.take()) break;
      const type = typeOf(mark);
      if (type === "bold") bold = true;
      else if (type === "italic") italic = true;
      else if (type === "link") {
        this.sawLink = true;
        if (++links === 1) link = this.link(mark as Rec);
      } else this.issues.add("dropped-mark");
    }
    // Two links on one text: which one would a learner get? Neither.
    if (links > 1) link = { ok: false, reason: "refused", key: {} };
    return { bold, italic, link };
  }

  /**
   * A link mark's address, checked. Its length counts against the scanned
   * budget first, so a huge address costs one length check, never a parse.
   * Every attribute but `href` is ignored.
   */
  private link(mark: Rec): WalkLink {
    const href = attrOf(mark, "href");
    if (typeof href !== "string") return { ok: false, reason: "refused", key: {} };
    this.scanned += href.length;
    if (this.scanned > RT_LIMITS.maxJsonChars) {
      this.fail("too-much-text");
      return { ok: false, reason: "refused", key: {} };
    }
    const check = checkLinkHref(href, { ownFileHost: ownFileHost() });
    if (!check.ok) {
      return { ok: false, reason: check.reason === "redirect" ? "redirect" : "refused", key: href };
    }
    return { ok: true, href: check.href, ownFile: check.ownFile };
  }

  private problem(reason: LinkProblemReason, text: string) {
    if (this.linkProblems.length < MAX_LINK_PROBLEMS) {
      this.linkProblems.push({ text: problemText(text), reason });
    }
  }

  /**
   * A paragraph's links, once its text is read. A link is the run of
   * neighbouring text with the same address (a line break ends it):
   * - a refused one loses its link (dropped-link);
   * - one whose text is only spaces loses its link, silently (learners
   *   would see an underlined space);
   * - links that touch (no unlinked character between them) are read
   *   together, as learners see them: when their text shows another address
   *   than any of them opens, all of them lose their link (dropped-link) —
   *   "https://bank." and "example" linked apart read "https://bank.example";
   * - a kept link to our own file store is reported (own-file-link).
   * Then the text nodes are rebuilt, neighbours with the same marks joined.
   */
  private finishLinks(nodes: WalkInline[]): RtInline[] {
    type Run = { start: number; end: number; link: WalkLink };
    const runs: Run[] = [];
    for (let i = 0; i < nodes.length; ) {
      const node = nodes[i];
      if (node.type !== "text" || !node.link) {
        i++;
        continue;
      }
      let end = i + 1;
      while (end < nodes.length) {
        const next = nodes[end];
        if (next.type !== "text" || !sameLink(next.link, node.link)) break;
        end++;
      }
      runs.push({ start: i, end, link: node.link });
      i = end;
    }
    const textOf = (run: Run) =>
      nodes
        .slice(run.start, run.end)
        .map((n) => (n.type === "text" ? n.text : ""))
        .join("");
    const unlink = (run: Run) => {
      for (let k = run.start; k < run.end; k++) {
        const n = nodes[k];
        if (n.type === "text") n.link = null;
      }
    };

    const kept: Run[] = [];
    for (const run of runs) {
      if (!run.link.ok) {
        this.problem(run.link.reason, textOf(run));
        this.issues.add("dropped-link");
        unlink(run);
      } else if (!textOf(run).trim()) {
        unlink(run);
      } else {
        kept.push(run);
      }
    }

    // Touching links, read together.
    let group: Run[] = [];
    const flush = () => {
      if (!group.length) return;
      const joined = group.map(textOf).join("");
      const misleading = group.some(
        (run) => run.link.ok && linkTextProblem(joined, run.link.href) === "misleading"
      );
      if (misleading) {
        this.problem("misleading", joined);
        this.issues.add("dropped-link");
        group.forEach(unlink);
      } else {
        for (const run of group) {
          if (run.link.ok && run.link.ownFile) {
            this.problem("own-file", textOf(run));
            this.issues.add("own-file-link");
          }
        }
      }
      group = [];
    };
    for (const run of kept) {
      const last = group[group.length - 1];
      if (last && last.end !== run.start) flush();
      group.push(run);
    }
    flush();

    const out: RtInline[] = [];
    let prev: WalkText | null = null;
    for (const node of nodes) {
      if (node.type !== "text") {
        out.push(node);
        prev = null;
      } else if (prev && sameFormat(prev, node)) {
        (out[out.length - 1] as { text: string }).text += node.text;
      } else {
        const marks = marksOf(node);
        if (node.link?.ok) this.keptLink = true;
        out.push(marks.length ? { type: "text", text: node.text, marks } : { type: "text", text: node.text });
        prev = node;
      }
    }
    return out;
  }

  /** A list at `depth` (a top-level list is 1); null when no item has text. */
  private list(node: Rec, depth: number): RtList | null {
    const raw = arrayOf(node.content);
    const items =
      depth < RT_LIMITS.maxListDepth
        ? this.items(raw, depth)
        : this.flatItems(raw);
    if (items.length === 0) return null;
    if (node.type === "bulletList") return { type: "bulletList", content: items };
    const start = clampInt(
      attrOf(node, "start"),
      0,
      RT_LIMITS.maxOrderedStart,
      1
    );
    // Tiptap's `type` attribute ("1", "a", …) is dropped: always numbers.
    return start === 1
      ? { type: "orderedList", content: items }
      : { type: "orderedList", attrs: { start }, content: items };
  }

  private items(raw: unknown[], depth: number): RtListItem[] {
    const out: RtListItem[] = [];
    for (const node of raw) {
      if (!this.take()) break;
      if (typeOf(node) !== "listItem") {
        this.issues.add("dropped-node");
        continue;
      }
      const kept: RtBlock[] = [];
      for (const child of arrayOf((node as Rec).content)) {
        if (!this.take()) break;
        const type = typeOf(child);
        if (type === "paragraph") {
          kept.push(this.paragraph(child as Rec, true));
        } else if (isList(type)) {
          const list = this.list(child as Rec, depth + 1);
          if (list) kept.push(list);
        } else {
          this.issues.add("dropped-node");
        }
      }
      const item = makeItem(kept);
      if (item) out.push(item);
    }
    return out;
  }

  /**
   * The items of a list at the deepest allowed level. Lists nested inside
   * them are flattened into this one, each item followed by the items of
   * the lists it held — no text is lost, it just stops indenting (Word can
   * paste nine levels). A work stack instead of recursion; the node budget
   * ends cyclic input.
   */
  private flatItems(raw: unknown[]): RtListItem[] {
    const out: RtListItem[] = [];
    const stack = [{ nodes: raw, next: 0 }];
    while (stack.length > 0 && !this.fatal) {
      const top = stack[stack.length - 1];
      if (top.next >= top.nodes.length) {
        stack.pop();
        continue;
      }
      const node = top.nodes[top.next++];
      if (!this.take()) break;
      if (typeOf(node) !== "listItem") {
        this.issues.add("dropped-node");
        continue;
      }
      const kept: RtBlock[] = [];
      const nested: unknown[][] = [];
      for (const child of arrayOf((node as Rec).content)) {
        if (!this.take()) break;
        const type = typeOf(child);
        if (type === "paragraph") {
          kept.push(this.paragraph(child as Rec, true));
        } else if (isList(type)) {
          nested.push(arrayOf((child as Rec).content));
          this.issues.add("list-flattened");
        } else {
          this.issues.add("dropped-node");
        }
      }
      const item = makeItem(kept);
      if (item) out.push(item);
      for (let i = nested.length - 1; i >= 0; i--) {
        stack.push({ nodes: nested[i], next: 0 });
      }
    }
    return out;
  }
}

/* --------------------------------- API ---------------------------------- */

/**
 * Rebuild `input` as canonical rich text (see types.ts), or say why it
 * can't be stored. Reads versions 1 and 2. Never throws.
 */
export function sanitizeRichText(input: unknown): RtSanitized {
  const walker = new Walker();
  let content: RtBlock[];
  try {
    if (!isRecord(input) || (input.v !== 1 && input.v !== 2)) return badEnvelope();
    const doc = input.doc;
    if (!isRecord(doc) || doc.type !== "doc" || !Array.isArray(doc.content)) {
      return badEnvelope();
    }
    content = walker.blocks(doc.content);
  } catch {
    // Only reachable through exotic objects (a throwing getter); JSON from
    // a request or the database can't do that.
    return badEnvelope();
  }
  const failed = (): RtSanitized => ({
    value: null,
    issues: [...walker.issues],
    linkProblems: [],
    hasLinks: walker.sawLink,
  });
  if (walker.fatal) return failed();

  const doc = {
    type: "doc" as const,
    content: content.length ? content : [{ type: "paragraph" as const }],
  };
  const value: RichText = walker.keptLink ? { v: 2, doc } : { v: 1, doc };
  if (JSON.stringify(value).length > RT_LIMITS.maxJsonChars) {
    walker.issues.add("too-large");
    return failed();
  }
  return {
    value,
    issues: [...walker.issues],
    linkProblems: walker.linkProblems,
    hasLinks: walker.sawLink,
  };
}

function badEnvelope(): RtSanitized {
  return { value: null, issues: ["bad-envelope"], linkProblems: [], hasLinks: false };
}

/** Does the doc hold no text at all? (The learner view then renders nothing.) */
export function isEmptyDoc(doc: { content: readonly RtBlock[] }): boolean {
  return doc.content.every(
    (block) => block.type === "paragraph" && !block.content?.length
  );
}

const tooMuch = (subject: string) =>
  `${subject} has too much formatting or too many list points to save. Split it into two blocks.`;
const tooMuchWithLinks = (subject: string) =>
  `${subject} has too many links or too much formatting to save. Split it into two blocks.`;

/**
 * Why text can't be saved, for authors: "`subject` is too long — …".
 * Authoring-tool copy (English).
 */
export const RT_PROBLEM: Record<RtFatalIssue, (subject: string) => string> = {
  "bad-envelope": (subject) =>
    `${subject} couldn't be read. Copy its text into a new block, then remove this one.`,
  "too-much-text": (subject) =>
    `${subject} is too long — at most ${RT_LIMITS.maxTextChars.toLocaleString("en")} characters. Split it into two blocks.`,
  "too-many-nodes": tooMuch,
  "too-large": tooMuch,
};

/**
 * The message for the first fatal issue, or null when there is none.
 * `hasLinks` (RtSanitized.hasLinks): a doc over a size limit that holds
 * links says so.
 */
export function richTextProblem(
  issues: readonly RtIssue[],
  subject = "This text",
  hasLinks = false
): string | null {
  const fatal = issues.find(isFatalIssue);
  if (!fatal) return null;
  if (hasLinks && (fatal === "too-many-nodes" || fatal === "too-large")) {
    return tooMuchWithLinks(subject);
  }
  return RT_PROBLEM[fatal](subject);
}

/**
 * Why a link can't be saved, naming it by its text (authoring-tool copy,
 * English), as a sentence to follow "Block 2 (Paragraph): ".
 */
export const LINK_PROBLEM: Record<LinkProblemReason, (text: string) => string> = {
  refused: (text) =>
    `the link “${text}” can't be used. Use an address starting with https:// or http://, or an email address.`,
  redirect: (text) =>
    `the link “${text}” is an Outlook safe link, which carries the address of the mailbox it was sent to. Use the original address instead.`,
  misleading: (text) =>
    `the link text “${text}” shows a different address than the link opens. Show the real address, or use a few words.`,
  "own-file": (text) =>
    `the link “${text}” points to a file uploaded to the platform. Add the file to the lesson as a document instead.`,
};

/**
 * A link problem as a save names it ("Block 2 (Paragraph): the link …"),
 * or, without `subject`, as the editor does, on its own ("The link …").
 */
export function linkProblemMessage(problem: LinkProblem, subject?: string): string {
  const sentence = LINK_PROBLEM[problem.reason](problem.text);
  return subject ? `${subject}: ${sentence}` : sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
