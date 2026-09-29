/**
 * Structure for authored plain text. Narrative paragraphs and callouts are
 * typed — or pasted from Word / Google Docs — into a plain <textarea>, so the
 * only structure they carry is line breaks and the bullet or number
 * characters the author typed. Rendered as-is, HTML collapses all of that
 * into one wall of text. This parser recovers it as plain data: paragraphs
 * (keeping their line breaks), bullet lists and numbered lists, which
 * FormattedText renders as semantic elements.
 *
 * Plain text in, plain text out: nothing is ever treated as HTML or markdown,
 * and only list markers and surrounding whitespace are dropped. Pure and
 * unit-tested, so a future rich-text editor can convert existing lesson text
 * with exactly the rules learners already see.
 */

export type LegacyNode =
  | { type: "paragraph"; lines: string[] }
  | { type: "bullets"; items: string[] }
  | { type: "numbers"; items: string[]; start: number };

/**
 * A bullet line. Bullet glyphs — the common Unicode bullets and U+F0B7 /
 * U+F0A7 (the private-use "Symbol" / "Wingdings" bullets Word lists often
 * paste as) — mark an item even when typed without a space ("•Pause"). The
 * middle dot and the typed "-", "–" and "*" need whitespace after them, so
 * "-5 °C", "-based" or "*note*" stay plain text. Word's plain-text copy of a
 * list writes "·", "o" and "§" plus a tab for levels one to three; "o" and
 * "§" only count with that tab, so ordinary words and "§ 12" stay text.
 * Nested levels become items of the same list.
 */
const BULLET_LINE = /^(?:[•◦▪●■‣⁃\uF0B7\uF0A7]\s*|[·*–-]\s+|[o§]\t\s*)(.+)$/;

/** A bullet glyph alone on its line — how bullets arrive when copied from a PDF. */
const LONE_BULLET = /^[•◦▪●■‣⁃·\uF0B7\uF0A7]$/;

/** "1. …" or "1) …" — up to three digits, so a year like "2024." stays text. */
const NUMBER_LINE = /^(\d{1,3})[.)]\s+(.*)$/;

/** A "•" between whitespace inside a line: a list pasted without its newlines. */
const INLINE_BULLET = /\s+•(?=\s)/;

type LineToken =
  | { kind: "text"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "number"; n: number; text: string };

type Token = LineToken | { kind: "break" };

export function parseLegacyText(text: string): LegacyNode[] {
  const nodes: LegacyNode[] = [];
  // The node the next token may extend. A blank line closes a paragraph but
  // not a list: Word and Docs often paste a blank line between list items.
  let current: LegacyNode | null = null;

  for (const token of tokenize(text)) {
    if (token.kind === "break") {
      if (current?.type === "paragraph") current = null;
    } else if (token.kind === "text") {
      if (current?.type === "paragraph") current.lines.push(token.text);
      else nodes.push((current = { type: "paragraph", lines: [token.text] }));
    } else if (token.kind === "bullet") {
      if (current?.type === "bullets") current.items.push(token.text);
      else nodes.push((current = { type: "bullets", items: [token.text] }));
    } else if (
      current?.type === "numbers" &&
      token.n === current.start + current.items.length
    ) {
      current.items.push(token.text);
    } else {
      // A number that doesn't continue the sequence starts a new list, so the
      // learner sees exactly the numbers the author typed.
      nodes.push(
        (current = { type: "numbers", items: [token.text], start: token.n })
      );
    }
  }

  return nodes;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let afterLoneBullet = false;

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      tokens.push({ kind: "break" });
      afterLoneBullet = false;
      continue;
    }
    if (LONE_BULLET.test(line)) {
      afterLoneBullet = true;
      continue;
    }

    const lineTokens = tokenizeLine(line);
    // The text after a lone bullet glyph is that bullet's item.
    if (afterLoneBullet && lineTokens[0].kind === "text") {
      lineTokens[0] = { kind: "bullet", text: lineTokens[0].text };
    }
    afterLoneBullet = false;

    // Inline splitting can leave empty items ("A • • B"); they carry no text.
    tokens.push(...lineTokens.filter((t) => t.text !== ""));
  }

  return tokens;
}

/** Tokens for one trimmed, non-empty line. */
function tokenizeLine(line: string): LineToken[] {
  const bullet = BULLET_LINE.exec(line);
  if (bullet) {
    // "• A • B" — a bulleted line that carries more bullets inline.
    const items = line.startsWith("•") ? splitInline(bullet[1]) : [bullet[1]];
    return items.map((text): LineToken => ({ kind: "bullet", text }));
  }

  const number = NUMBER_LINE.exec(line);
  if (number) {
    return [{ kind: "number", n: Number(number[1]), text: number[2] }];
  }

  // "Key points: • A • B • C" — two or more inline bullets make a list, with
  // the text before the first one kept as a lead-in. A single "•" is more
  // likely a separator ("Berlin • Athens"), so that line stays as written.
  const parts = splitInline(line);
  if (parts.length > 2) {
    const [lead, ...items] = parts;
    return [
      { kind: "text", text: lead },
      ...items.map((text): LineToken => ({ kind: "bullet", text })),
    ];
  }

  return [{ kind: "text", text: line }];
}

function splitInline(text: string): string[] {
  return text.split(INLINE_BULLET).map((part) => part.trim());
}
