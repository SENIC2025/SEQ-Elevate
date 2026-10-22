import { describe, it, expect } from "vitest";
import { linkSite } from "./link-site";
import { sanitizeRichText } from "./sanitize";
import corpus from "./link-text.corpus.json";

/*
 * Part A's save (D104, U3): the sanitizer keeps a named link whose text the
 * rule accepts and drops one it refuses, for the link-rules corpora
 * (link-text.corpus.json, whose answers link-text.corpus.test.ts checks
 * against the rule itself), and saves the length guards' verifier's 1 MB
 * lessons in time. Lessons of accepted links are drawn with the box naming
 * the site each link opens (link-site.ts).
 */

type Honest = { text: string; href: string; answer: "misleading" | null };
const honest = corpus.honest as Honest[];
const refusedHostile = corpus.refusedHostile as [string, string][];

/** One paragraph holding `text` linked to `href` (version 2, as a save stores a doc with a link; the verifier's lessons send version 1). */
const linked = (text: string, href: string, v = 2) => ({
  v,
  doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text, marks: [{ type: "link", attrs: { href } }] }] }] },
});

describe("the link-rules corpora, saved", () => {
  it("keeps each accepted honest text's link, and drops each refused one", () => {
    for (const row of honest) {
      const dropped = sanitizeRichText(linked(row.text, row.href)).issues.includes("dropped-link");
      expect(dropped, `${row.text} over ${row.href}`).toBe(row.answer === "misleading");
    }
  });

  it("drops the link of every refused phishing probe", () => {
    for (const [text, href] of refusedHostile) {
      expect(sanitizeRichText(linked(text, href)).issues, `${text} over ${href}`).toContain("dropped-link");
    }
  });
});

/** Symbols the URL parser keeps in a host, unchanged by NFKC, outside the modifier-letter block. */
const SYMBOLS: string[] = [];
for (let cp = 0xa0; cp < 0x1fbff && SYMBOLS.length < 6_000; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  if (cp >= 0x2b0 && cp <= 0x2ff) continue;
  const char = String.fromCodePoint(cp);
  if (!/^\p{S}$/u.test(char) || char.normalize("NFKC") !== char) continue;
  try {
    if (!new URL(`https://a${char}b.com`).hostname.startsWith("xn--")) continue;
  } catch {
    continue;
  }
  SYMBOLS.push(char);
}
/** At most `units` UTF-16 units of different symbols, from the `from`th on. */
function symbols(units: number, from = 0): string {
  let out = "";
  for (let i = from; ; i++) {
    const char = SYMBOLS[i % SYMBOLS.length];
    if (out.length + char.length > units) return out;
    out += char;
  }
}

/** Combining marks the URL parser keeps in a host, unchanged by NFC. */
const MARKS: string[] = [];
for (let cp = 0x300; cp < 0x10000; cp++) {
  const char = String.fromCodePoint(cp);
  if (!/^\p{M}$/u.test(char) || char.normalize("NFC") !== char) continue;
  try {
    if (new URL(`https://a${char}b.com`).hostname.startsWith("xn--")) MARKS.push(char);
  } catch {
    // not in a host
  }
}
/** 64 CJK ideographs from the `k`th on, the fifth carrying 9,800 marks: a label longer than DNS allows. */
const heavyLabel = (k: number) =>
  Array.from({ length: 64 }, (_, i) => String.fromCodePoint(0x4e00 + (i + k) * 7) + (i === 4 ? Array.from({ length: 9_800 }, (__, j) => MARKS[(k * 13 + j) % MARKS.length]).join("") : "")).join("");

/** The blocks of a save of at most 1 MB (a request's JSON body, as lesson blocks), each one link. */
function lesson(block: (k: number) => { text: string; href: string }): unknown[] {
  const blocks: unknown[] = [];
  let bytes = 2;
  for (let k = 0; k < 100; k++) {
    const { text, href } = block(k);
    const rich = linked(text, href, 1);
    const size = Buffer.byteLength(JSON.stringify({ kind: "paragraph", text: "", rich })) + 1;
    if (bytes + size > 1024 * 1024) break;
    blocks.push(rich);
    bytes += size;
  }
  return blocks;
}

/** Every block saved with its link, the whole save in under 0.5 s. */
function savedWhole(blocks: unknown[]) {
  const started = performance.now();
  const issues = blocks.map((b) => sanitizeRichText(b).issues);
  const took = performance.now() - started;
  for (const found of issues) expect(found).toEqual([]);
  expect(took, `${blocks.length} blocks: ${took.toFixed(0)} ms`).toBeLessThan(500);
}

describe("the length guards' verifier's 1 MB lessons, saved (every block accepted)", () => {
  it("link text of a host of symbols on the link's own site, in under 0.5 s", () => {
    const blocks = lesson((k) => ({ text: `https://${symbols(10_000 - 21, k)}.evil.example`, href: `https://evil.example/${k}` }));
    expect(blocks.length).toBeGreaterThanOrEqual(30);
    savedWhole(blocks);
  }, 120_000);

  it("link text of a host of symbols the rule reads as no site, drawn with the link's site, in under 0.5 s", () => {
    const blocks = lesson((k) => ({ text: `https://${symbols(10_000 - 12, k)}.com`, href: `https://evil.example/${k}` }));
    expect(blocks.length).toBeGreaterThanOrEqual(30);
    savedWhole(blocks);
    for (let k = 0; k < blocks.length; k++) expect(linkSite(`https://evil.example/${k}`)).toBe("evil.example");
  }, 120_000);

  it("link text of a long label whose fifth letter carries 9,800 marks, on the link's own site, in under 0.5 s", () => {
    const blocks = lesson((k) => ({ text: `https://${heavyLabel(k)}.evil.example`, href: `https://evil.example/${k}` }));
    expect(blocks.length).toBeGreaterThanOrEqual(10);
    savedWhole(blocks);
  }, 120_000);
});
