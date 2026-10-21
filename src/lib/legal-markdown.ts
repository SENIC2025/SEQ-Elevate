/**
 * Release 3 (D94, spec 12.2): the small Markdown subset counsel's legal texts
 * are written in (src/content/legal/**), read into a tree that
 * components/legal/LegalBody.tsx renders as React elements: no HTML string
 * is ever put into the page, so nothing in a text can run as script.
 *
 * The subset:
 * - `## heading` and `### heading`;
 * - paragraphs (lines in a row; a blank line ends one), each line its own:
 *   a line break in the text is one on the page, so an address or
 *   numbered points keep their lines;
 * - lists: `- item`, and `  - item` (indented) for a second level; a line
 *   under an item that starts no other block carries it on, on a new line;
 * - tables in the GitHub form: a header row, a `|---|---|` row, body rows;
 * - inline `**bold**` and `[text](address)`, the address only https:,
 *   mailto:, /legal/<document> or /help (the page adds the language);
 * - a backslash before * [ ] | or \ keeps that character as it is.
 * Anything else is plain text, shown as written: a link to any other
 * address, `#` or `####` headings, HTML (React escapes it).
 *
 * Pure, so it is tested on its own and runs wherever the page renders.
 */

/** The documents a text may link to by /legal/<document> (data/legal.ts names them too). */
export const LINKABLE_DOCS = ["privacy", "terms", "cookies", "accessibility", "notice"] as const;

/** Where a link goes: another site (https: or mailto:), or a page of ours, without its language. */
export type LegalHref = { kind: "external"; href: string } | { kind: "internal"; path: string };

export type Inline =
  | { type: "text"; text: string }
  | { type: "break" }
  | { type: "strong"; children: Inline[] }
  | { type: "link"; href: LegalHref; children: Inline[] };

export interface ListItem {
  children: Inline[];
  /** The second level, under this item. */
  items: ListItem[];
}

export type Block =
  | { type: "heading"; level: 2 | 3; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; items: ListItem[] }
  | { type: "table"; head: Inline[][]; rows: Inline[][][] };

/** A link's address, if the subset allows it; else null (the link is then plain text). */
export function legalHref(address: string): LegalHref | null {
  const a = address.trim();
  if (/^https:\/\//i.test(a)) {
    try {
      const url = new URL(a);
      return url.protocol === "https:" && url.hostname ? { kind: "external", href: url.href } : null;
    } catch {
      return null;
    }
  }
  if (/^mailto:[^\s@<>()"]+@[^\s@<>()"]+\.[^\s@<>()"]+$/i.test(a)) return { kind: "external", href: a };
  if (a === "/help") return { kind: "internal", path: a };
  const doc = /^\/legal\/([a-z]+)$/.exec(a)?.[1];
  if (doc && (LINKABLE_DOCS as readonly string[]).includes(doc)) return { kind: "internal", path: a };
  return null;
}

const ESCAPABLE = "*[]|\\";

/**
 * Inline text: bold, links, escapes, and a line break for each "\n";
 * `inLink`/`inStrong` stop either from nesting in itself.
 */
export function parseInline(source: string, inLink = false, inStrong = false): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ type: "text", text });
    text = "";
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "\n") {
      flush();
      out.push({ type: "break" });
      i += 1;
      continue;
    }
    if (c === "\\" && ESCAPABLE.includes(source[i + 1] ?? "")) {
      text += source[i + 1];
      i += 2;
      continue;
    }
    if (!inStrong && source.startsWith("**", i)) {
      const close = findUnescaped(source, "**", i + 2);
      if (close > i + 2) {
        flush();
        out.push({ type: "strong", children: parseInline(source.slice(i + 2, close), inLink, true) });
        i = close + 2;
        continue;
      }
    }
    if (!inLink && c === "[") {
      const link = readLink(source, i);
      if (link) {
        const href = legalHref(link.address);
        if (href) {
          flush();
          out.push({ type: "link", href, children: parseInline(link.label, true, inStrong) });
        } else {
          // Not an address the subset allows: the link as written, as text.
          text += source.slice(i, link.end);
        }
        i = link.end;
        continue;
      }
    }
    text += c;
    i += 1;
  }
  flush();
  return out;
}

/** The first `token` at or after `from` that no backslash escapes, or -1. */
function findUnescaped(source: string, token: string, from: number): number {
  for (let i = from; i <= source.length - token.length; i++) {
    if (source[i] === "\\") {
      i += 1;
      continue;
    }
    if (source.startsWith(token, i)) return i;
  }
  return -1;
}

/** `[label](address)` starting at `start`: the label holds no bracket, the address no space or parenthesis. */
function readLink(source: string, start: number): { label: string; address: string; end: number } | null {
  const m = /^\[((?:\\.|[^\]\\[])+)\]\(([^\s()]+)\)/.exec(source.slice(start));
  return m ? { label: m[1], address: m[2], end: start + m[0].length } : null;
}

const HEADING = /^(#{2,3})\s+(.+?)\s*#*\s*$/;
const ITEM = /^-\s+(.*)$/;
const NESTED_ITEM = /^(?: {2,}|\t+)-\s+(.*)$/;
const TABLE_ROW = /^\s*\|/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** A table row's cells: split on | that no backslash escapes, the outer pipes dropped. */
export function tableCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  const s = line.trim().replace(/^\|/, "");
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cell += "\\|";
      i += 1;
    } else if (s[i] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += s[i];
    }
  }
  if (cell.trim() || !s.endsWith("|")) cells.push(cell.trim());
  return cells;
}

/** Reads a legal text into blocks. Never throws: anything it doesn't know is a paragraph of plain text. */
export function parseLegalMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const blank = (line: string | undefined) => line === undefined || line.trim() === "";
  const startsBlock = (n: number) => {
    const line = lines[n];
    return (
      HEADING.test(line) || ITEM.test(line) || (TABLE_ROW.test(line) && TABLE_RULE.test(lines[n + 1] ?? ""))
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) {
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 2 | 3, children: parseInline(heading[2]) });
      i += 1;
      continue;
    }
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? "")) {
      const head = tableCells(line).map((c) => parseInline(c));
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        const cells = tableCells(lines[i]).map((c) => parseInline(c));
        // Every row has the header's number of cells.
        rows.push(head.map((_, k) => cells[k] ?? []));
        i += 1;
      }
      blocks.push({ type: "table", head, rows });
      continue;
    }
    if (ITEM.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length && !blank(lines[i])) {
        const top = ITEM.exec(lines[i]);
        const nested = NESTED_ITEM.exec(lines[i]);
        if (top) {
          items.push({ children: parseInline(top[1]), items: [] });
        } else if (nested && items.length) {
          items[items.length - 1].items.push({ children: parseInline(nested[1]), items: [] });
        } else if (startsBlock(i)) {
          break;
        } else {
          // A line that carries on the item above, on a line of its own.
          const last = items[items.length - 1];
          const target = last.items.length ? last.items[last.items.length - 1] : last;
          target.children.push(...parseInline(`\n${lines[i].trim()}`));
        }
        i += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && !blank(lines[i]) && (paragraph.length === 0 || !startsBlock(i))) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
  }
  return blocks;
}

/** Every link address a text writes, allowed or not (for the tests of the texts). */
export function linkAddresses(source: string): string[] {
  return [...source.matchAll(/\[(?:\\.|[^\]\\[])+\]\(([^\s()]+)\)/g)].map((m) => m[1]);
}

/** Words that mark a draft or a placeholder: never in a text that is shown (spec 12.5). */
export const PLACEHOLDER_WORDS: readonly RegExp[] = [
  /\bFor DIESIS\b/i,
  /\bSENIC to confirm\b/i,
  /\bUntil 20 November\b/i,
  /\bFrom 20 November\b/i,
  /\bTo be completed\b/i,
  /\bTODO\b/,
  /\bTBD\b/,
];

/**
 * What in a text reads as a placeholder (spec 12.5): a `[` that doesn't
 * start a Markdown link `[…](…)`, or a draft's words (PLACEHOLDER_WORDS).
 * Each finding is a short excerpt; none means the text is clean.
 */
export function legalPlaceholders(source: string): string[] {
  const found: string[] = [];
  const excerpt = (at: number) => source.slice(Math.max(0, at - 20), at + 40).replace(/\s+/g, " ").trim();
  for (let i = source.indexOf("["); i !== -1; i = source.indexOf("[", i + 1)) {
    if (!readLink(source, i)) found.push(`a "[" that starts no link: …${excerpt(i)}…`);
  }
  for (const word of PLACEHOLDER_WORDS) {
    const m = word.exec(source);
    if (m) found.push(`"${m[0]}": …${excerpt(m.index)}…`);
  }
  return found;
}
