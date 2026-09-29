import {
  RT_LIMITS,
  type RichTextV1,
  type RtBlock,
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
 * in types.ts, so an unknown node, mark or attribute (a link, an image, a
 * `style` or `onclick`) simply isn't copied. Recursion only follows lists
 * and stops at RT_LIMITS.maxListDepth; deeper lists are flattened with a
 * work stack, every node visited counts against RT_LIMITS.maxNodes, and
 * every character of text read against RT_LIMITS.maxJsonChars — so very
 * deep, cyclic or repetitive input ends in a result, never a stack overflow
 * or a hang. Raw input is never JSON.stringify'd (only the rebuilt value is).
 *
 * Pure, so it runs the same on the server and in the browser.
 */

/**
 * What the sanitizer found. The fatal ones (RtFatalIssue, below) leave no
 * value:
 * - "bad-envelope": not `{ v: 1, doc: { type: "doc", content: [...] } }`;
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
  /** A mark outside the whitelist (link, underline, code, …) was left out. */
  | "dropped-mark"
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

export interface RtSanitized {
  /** The canonical value, or null when a fatal issue stopped it. */
  value: RichTextV1 | null;
  issues: RtIssue[];
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

function sameMarks(a: RtMark[] | undefined, b: RtMark[]): boolean {
  const left = a ?? [];
  return left.length === b.length && left.every((m, i) => m.type === b[i].type);
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
    const out: RtInline[] = [];
    for (const node of arrayOf(raw)) {
      if (!this.take()) break;
      const type = typeOf(node);
      if (type === "hardBreak") out.push({ type: "hardBreak" });
      else if (type === "text") this.text(node as Rec, out);
      else this.issues.add("dropped-node");
    }
    // A line break at either end of a paragraph shows learners nothing.
    while (out[0]?.type === "hardBreak") out.shift();
    while (out[out.length - 1]?.type === "hardBreak") out.pop();
    // Nothing but spaces (Word pastes blank lines as a no-break space) is a
    // blank paragraph.
    return out.some((n) => n.type === "text" && n.text.trim()) ? out : [];
  }

  private text(node: Rec, out: RtInline[]) {
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
    const marks = this.marks(node.marks);
    const prev = out[out.length - 1];
    if (prev?.type === "text" && sameMarks(prev.marks, marks)) {
      prev.text += text;
    } else {
      out.push(
        marks.length ? { type: "text", text, marks } : { type: "text", text }
      );
    }
  }

  /** Bold, then italic; anything else is dropped. */
  private marks(raw: unknown): RtMark[] {
    let bold = false;
    let italic = false;
    for (const mark of arrayOf(raw)) {
      if (!this.take()) break;
      const type = typeOf(mark);
      if (type === "bold") bold = true;
      else if (type === "italic") italic = true;
      else this.issues.add("dropped-mark");
    }
    const marks: RtMark[] = [];
    if (bold) marks.push({ type: "bold" });
    if (italic) marks.push({ type: "italic" });
    return marks;
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
 * can't be stored. Never throws.
 */
export function sanitizeRichText(input: unknown): RtSanitized {
  const walker = new Walker();
  let content: RtBlock[];
  try {
    if (!isRecord(input) || input.v !== 1) return badEnvelope();
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
  if (walker.fatal) return { value: null, issues: [...walker.issues] };

  const value: RichTextV1 = {
    v: 1,
    doc: {
      type: "doc",
      content: content.length ? content : [{ type: "paragraph" }],
    },
  };
  if (JSON.stringify(value).length > RT_LIMITS.maxJsonChars) {
    walker.issues.add("too-large");
    return { value: null, issues: [...walker.issues] };
  }
  return { value, issues: [...walker.issues] };
}

function badEnvelope(): RtSanitized {
  return { value: null, issues: ["bad-envelope"] };
}

/** Does the doc hold no text at all? (The learner view then renders nothing.) */
export function isEmptyDoc(doc: { content: readonly RtBlock[] }): boolean {
  return doc.content.every(
    (block) => block.type === "paragraph" && !block.content?.length
  );
}

const tooMuch = (subject: string) =>
  `${subject} has too much formatting or too many list points to save. Split it into two blocks.`;

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

/** The message for the first fatal issue, or null when there is none. */
export function richTextProblem(
  issues: readonly RtIssue[],
  subject = "This text"
): string | null {
  const fatal = issues.find(isFatalIssue);
  return fatal ? RT_PROBLEM[fatal](subject) : null;
}
