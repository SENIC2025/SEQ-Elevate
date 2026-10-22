import type { NarrativeBlock } from "@/lib/cms/types";
import { RT_LIMITS, type RichText } from "./types";
import {
  RT_PROBLEM,
  cleanPlainText,
  linkProblemMessage,
  richTextProblem,
  sanitizeRichText,
  type RtAdvice,
} from "./sanitize";
import { docToPlainText } from "./to-plain";

/**
 * Checking a lesson's content blocks before they're saved (D36). A server
 * action's arguments come straight from the browser, so every block is
 * rebuilt from what its kind allows — never passed through:
 *
 * - a paragraph or key message with `rich` is sanitized, and its plain
 *   `text` is derived here from the doc (whatever the browser sent);
 * - one without `rich` stays plain text — it becomes rich only when an
 *   author edits it in the editor;
 * - lists keep their items and a valid `listStyle`; compare blocks keep two
 *   sides; unknown kinds are dropped.
 *
 * Text over a limit is refused with a message naming the block, rather than
 * cut short: silently losing the end of an author's text is worse than
 * asking them to split it. So is a link the sanitizer would leave out (an
 * address the check refuses, link text showing another address) or one to
 * our own file store (D104): the block and the link are named. Messages are
 * authoring-tool copy (English).
 */

export const NARRATIVE_LIMITS = {
  maxBlocks: RT_LIMITS.maxBlocks,
  /** A plain paragraph or key message (as for rich text). */
  maxTextChars: RT_LIMITS.maxTextChars,
  maxListItems: 50,
  maxListItemChars: 1_000,
  maxCompareSides: 2,
  maxCompareLabelChars: 120,
  maxCompareTextChars: 2_000,
} as const;

/**
 * How messages name each kind of block: the block editor's words, with one
 * name for both kinds of list.
 */
const KIND_LABEL: Record<NarrativeBlock["kind"], string> = {
  paragraph: "Paragraph",
  callout: "Key message",
  list: "List",
  compare: "Compare two sides",
};

export type NarrativeBlocksResult =
  | { ok: true; blocks: NarrativeBlock[] }
  | { ok: false; issues: string[] };

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const plain = (value: unknown): string =>
  typeof value === "string" ? cleanPlainText(value) : "";

/**
 * `value` as plain text (see plain), or null when that is over `max`
 * characters. A string over twice `max` is refused before it's cleaned:
 * whatever cleaning would remove, reading it is wasted work — and a server
 * action's arguments can repeat one huge string, by reference, in every
 * block and list point.
 */
function plainWithin(value: unknown, max: number): string | null {
  if (typeof value === "string" && value.length > 2 * max) return null;
  const text = plain(value);
  return text.length > max ? null : text;
}

const count = (n: number) => n.toLocaleString("en");

export function sanitizeNarrativeBlocks(input: unknown): NarrativeBlocksResult {
  if (!Array.isArray(input)) {
    return {
      ok: false,
      issues: [
        "The lesson's blocks couldn't be read. Reload the page and try again.",
      ],
    };
  }
  if (input.length > NARRATIVE_LIMITS.maxBlocks) {
    return {
      ok: false,
      issues: [
        `A lesson can have at most ${NARRATIVE_LIMITS.maxBlocks} blocks — this one has ${input.length}. Remove or combine some.`,
      ],
    };
  }

  const blocks: NarrativeBlock[] = [];
  const issues: string[] = [];
  input.forEach((raw, i) => {
    const block = sanitizeBlock(raw, i + 1, issues);
    if (block) blocks.push(block);
  });
  return issues.length ? { ok: false, issues } : { ok: true, blocks };
}

function sanitizeBlock(
  raw: unknown,
  n: number,
  issues: string[]
): NarrativeBlock | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  if (
    kind !== "paragraph" &&
    kind !== "callout" &&
    kind !== "list" &&
    kind !== "compare"
  ) {
    return null;
  }
  const name = `Block ${n} (${KIND_LABEL[kind]})`;

  if (kind === "paragraph" || kind === "callout") {
    // Anything but an envelope of a version a save reads — none, or a newer
    // version sent back by an older page — is kept as the plain text beside
    // it.
    if (isSavedEnvelope(raw.rich)) {
      const saved = richTextForSave(raw.rich, name);
      if (!saved.ok) {
        issues.push(...saved.issues);
        return null;
      }
      return { kind, rich: saved.rich, text: saved.text };
    }
    const text = plainWithin(raw.text, NARRATIVE_LIMITS.maxTextChars);
    if (text === null) {
      issues.push(RT_PROBLEM["too-much-text"](name));
      return null;
    }
    return { kind, text };
  }

  if (kind === "list") {
    const rawItems = Array.isArray(raw.items) ? raw.items : [];
    if (rawItems.length > NARRATIVE_LIMITS.maxListItems) {
      issues.push(
        `${name} has more than ${NARRATIVE_LIMITS.maxListItems} points. Split it into two lists.`
      );
      return null;
    }
    const items: string[] = [];
    for (const item of rawItems) {
      if (typeof item !== "string") continue;
      const text = plainWithin(item, NARRATIVE_LIMITS.maxListItemChars);
      if (text === null) {
        issues.push(
          `${name}: point ${items.length + 1} is too long — at most ${count(NARRATIVE_LIMITS.maxListItemChars)} characters.`
        );
        return null;
      }
      items.push(text);
    }
    const block: NarrativeBlock = { kind, items };
    if (raw.listStyle === "bullet" || raw.listStyle === "number") {
      block.listStyle = raw.listStyle;
    }
    return block;
  }

  // compare
  let ok = true;
  const sides = (Array.isArray(raw.compare) ? raw.compare : [])
    .slice(0, NARRATIVE_LIMITS.maxCompareSides)
    .filter(isRecord)
    .map((side, i) => {
      const label = plainWithin(
        side.label,
        NARRATIVE_LIMITS.maxCompareLabelChars
      );
      if (label === null) {
        issues.push(
          `${name}: the heading of side ${i + 1} is too long — at most ${NARRATIVE_LIMITS.maxCompareLabelChars} characters.`
        );
        ok = false;
      }
      const text = plainWithin(side.text, NARRATIVE_LIMITS.maxCompareTextChars);
      if (text === null) {
        issues.push(
          `${name}: the text of side ${i + 1} is too long — at most ${count(NARRATIVE_LIMITS.maxCompareTextChars)} characters.`
        );
        ok = false;
      }
      return {
        label: label ?? "",
        text: text ?? "",
        tone:
          side.tone === "positive"
            ? ("positive" as const)
            : ("negative" as const),
      };
    });
  return ok ? { kind, compare: sides } : null;
}

/** Is `raw` a rich-text envelope of a version a save reads (see richTextForSave)? */
function isSavedEnvelope(raw: unknown): raw is Rec {
  return isRecord(raw) && (raw.v === 1 || raw.v === 2);
}

export type RichTextForSave =
  | { ok: true; rich: RichText; text: string }
  | { ok: false; issues: string[] };

/**
 * Rich text as it is saved (D36), wherever it is saved: a lesson's
 * paragraphs and key messages (through sanitizeNarrativeBlocks) and any
 * other rich text an action stores. `raw` is the envelope the browser sent;
 * it is sanitized, and its plain `text` is derived here from the doc. When
 * it can't be stored, `issues` holds one sentence per problem, naming the
 * text as `name` ("Block 2 (Paragraph)", "The references list") and
 * ending with what to do, by what the text is (`advice`, RT_ADVICE: a
 * block's unless said otherwise). An
 * envelope of a version a save doesn't read (versions 1 and 2 are read) is
 * refused as unreadable.
 *
 * Links (D104) are refused, not cut: a link the sanitizer leaves out, and a
 * link to our own file store, refuse the text with one sentence per link,
 * naming it by its words ("Block 2 (Paragraph): the link “the guide” can't
 * be used. …"). A text with a link is stored as version 2.
 */
export function richTextForSave(raw: unknown, name: string, advice: RtAdvice = "block"): RichTextForSave {
  if (!isSavedEnvelope(raw)) return { ok: false, issues: [RT_PROBLEM["bad-envelope"](name, advice)] };
  const { value, issues: found, linkProblems, hasLinks } = sanitizeRichText(raw);
  if (!value) {
    return {
      ok: false,
      issues: [richTextProblem(found, name, hasLinks, advice) ?? RT_PROBLEM["bad-envelope"](name, advice)],
    };
  }
  if (found.includes("dropped-link") || found.includes("own-file-link")) {
    const named = linkProblems.length ? linkProblems : [{ text: "", reason: "refused" as const }];
    return { ok: false, issues: named.map((problem) => linkProblemMessage(problem, name)) };
  }
  return { ok: true, rich: value, text: docToPlainText(value.doc) };
}

/**
 * The plain text of a paragraph or key message: its `text`, or — for a rich
 * block stored without one (written directly, not through the save action)
 * — the text derived from `rich`. Undefined when it has neither.
 */
export function blockPlainText(block: {
  text?: unknown;
  rich?: unknown;
}): string | undefined {
  if (typeof block.text === "string") return block.text;
  if (block.rich == null) return undefined;
  const { value } = sanitizeRichText(block.rich);
  return value ? docToPlainText(value.doc) : undefined;
}

/**
 * A reflection lesson's introduction from its stored blocks: the first
 * paragraph, which is all the reflection editor writes. Its plain text (see
 * blockPlainText) and, when it has rich text that passes the check, that
 * too, sanitized — a doc that doesn't is left out, and learners see the
 * text. Undefined when there's no paragraph with either.
 *
 * Read from a stored lesson, which a direct database write or the external
 * CMS may have shaped differently, so anything that isn't a block is
 * skipped rather than trusted.
 */
export function introFromBlocks(
  blocks: unknown
): { text: string; rich?: RichText } | undefined {
  if (!Array.isArray(blocks)) return undefined;
  const paragraph = blocks.find(
    (block): block is Rec => isRecord(block) && block.kind === "paragraph"
  );
  if (!paragraph) return undefined;
  const text = blockPlainText(paragraph);
  if (text === undefined) return undefined;
  const rich =
    paragraph.rich == null ? null : sanitizeRichText(paragraph.rich).value;
  return rich ? { text, rich } : { text };
}

/**
 * A lesson title or subtitle as stored: one line, trimmed, invisible
 * characters removed, at most `max` characters (never splitting an emoji).
 */
export function cleanNarrativeLine(value: unknown, max: number): string {
  const line = plain(value).replace(/[\t\n\r]+/g, " ").trim();
  if (line.length <= max) return line;
  const last = line.charCodeAt(max - 1);
  const cut = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  return line.slice(0, cut).trimEnd();
}
