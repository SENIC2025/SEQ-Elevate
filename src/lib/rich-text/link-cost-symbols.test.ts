import { describe, it, expect } from "vitest";
import { checkLinkHref } from "./link-url";
import { linkSite, textIsSite } from "./link-site";
import { linkTextProblem } from "./link-text";
import { sanitizeRichText } from "./sanitize";
import { cpuMs, cpuRatio, leastCpuMs } from "./cpu-time.test-helpers";

/*
 * The length guards' verifier (D103, D104): a host made of symbols,
 * punctuation or combining marks, which the URL parser keeps in a host (in
 * punycode), costs its length times the characters it holds once parsed.
 * The guards count every character of a host (beyondDns), so the address
 * check refuses one DNS can't hold before it parses it; link text reads a
 * name in letters only, so such a host ends a name and is read in time in
 * proportion to its length. Link text accepted is drawn with the box naming
 * the site its link opens (link-site.ts). Same harness as link-cost.test.ts.
 * A save of a lesson whose links are kept is the sanitizer's, where it keeps
 * links (Part A), and timed by its own test.
 */

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

/** The median CPU time `run` takes, in milliseconds, over `times` runs after three to warm up (cpu-time.test-helpers.ts). */
function median(run: () => unknown, times = 20): number {
  for (let i = 0; i < 3; i++) run();
  const took: number[] = [];
  for (let i = 0; i < times; i++) took.push(cpuMs(run));
  took.sort((a, b) => a - b);
  return (took[times / 2 - 1] + took[times / 2]) / 2;
}

const EVIL = "https://evil.example/login";

/** Accepted, and drawn with the box naming the site `href` opens. */
function drawnWithItsSite(text: string, href: string) {
  expect(linkTextProblem(text, href)).toBeNull();
  expect(linkSite(href)).toBe("evil.example");
  expect(textIsSite(text, href)).toBe(false);
}

it("finds thousands of symbols the URL parser keeps in a host", () => {
  expect(SYMBOLS.length).toBeGreaterThan(3_000);
});

describe("link text that shows a host of symbols DNS can't hold", () => {
  const shapes: [string, (label: string) => string][] = [
    ["an address after a word", (label) => `Login:https://${label}.com`],
    ["the link's own site behind it", (label) => `https://${label}.evil.example`],
  ];
  it.each(shapes)("%s of 10,000 characters: drawn with the link's site, in under 10 ms and about the time of eighty of 125", (_, make) => {
    const long = make(symbols(10_000 - make("").length));
    const short = Array.from({ length: 80 }, (__, k) => make(symbols(125 - make("").length, k * 125)));
    expect(long.length).toBeGreaterThan(9_990);
    drawnWithItsSite(long, EVIL);
    const took = median(() => linkTextProblem(long, EVIL));
    const { ratio } = cpuRatio(() => linkTextProblem(long, EVIL), () => short.forEach((text) => linkTextProblem(text, EVIL)));
    expect(took, `took ${took.toFixed(1)} ms of CPU time, ratio ${ratio.toFixed(1)}`).toBeLessThan(10);
    expect(ratio, `ratio ${ratio.toFixed(1)}`).toBeLessThan(3);
  }, 60_000);
});

describe("a 1 MB lesson of hosts of symbols", () => {
  const rich = (content: unknown[]) => ({ v: 1, doc: { type: "doc", content: [{ type: "paragraph", content }] } });
  const link = (text: string, href: string) => ({ type: "text", text, marks: [{ type: "link", attrs: { href } }] });
  function lesson(block: (k: number) => unknown): unknown[] {
    const blocks: unknown[] = [];
    let bytes = 2;
    for (let k = 0; k < 100; k++) {
      const b = { kind: "paragraph", text: "", rich: block(k) };
      const size = Buffer.byteLength(JSON.stringify(b)) + 1;
      if (bytes + size > 1024 * 1024) break;
      blocks.push(b.rich);
      bytes += size;
    }
    return blocks;
  }
  /** The save's issues and its CPU time, the least of three. */
  const save = (blocks: unknown[]) => {
    let issues: string[][] = [];
    const [took] = leastCpuMs([() => (issues = blocks.map((b) => sanitizeRichText(b).issues))], 3);
    return { took, issues };
  };

  it("24 hrefs per block, each a host of 2,017 symbols, in under 0.5 s", () => {
    const blocks = lesson((k) => rich(Array.from({ length: 24 }, (_, i) => [link("a", `https://${symbols(2_017, k * 31 + i)}.com/`), { type: "text", text: " " }]).flat()));
    expect(checkLinkHref(`https://${symbols(2_017)}.com/`)).toEqual({ ok: false, reason: "host" });
    const { took, issues } = save(blocks);
    for (const found of issues) expect(found.length).toBeGreaterThan(0);
    expect(took, `${blocks.length} blocks: ${took.toFixed(0)} ms of CPU time`).toBeLessThan(500);
  }, 120_000);
});

describe("an address whose host is punctuation or combining marks DNS can't hold", () => {
  it("is refused before it is parsed, in under 1 ms", () => {
    for (const host of ["‿".repeat(64), `a${"\u0301".repeat(2_000)}`, `${"·".repeat(300)}.example`]) {
      const address = `https://${host}.com/`;
      expect(checkLinkHref(address), host.slice(0, 8)).toEqual({ ok: false, reason: "host" });
      expect(median(() => checkLinkHref(address)), host.slice(0, 8)).toBeLessThan(1);
    }
  });
});

/*
 * A long label (64 letters, longer than DNS allows) whose fifth letter
 * carries 9,800 combining marks: before the guards counted every character,
 * the long label's pieces each held that letter with its marks, so the
 * label cost several whole parses (f5702c8: about 23 ms a text and 0.86 s
 * for a 1 MB lesson; 292949e: about 96 ms and 3.5 s).
 */
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
/** 64 CJK ideographs from the `k`th on, the fifth carrying `marks` marks (9,800). */
const heavyLabel = (k = 0, marks = 9_800) =>
  Array.from({ length: 64 }, (_, i) => String.fromCodePoint(0x4e00 + (i + k) * 7) + (i === 4 ? Array.from({ length: marks }, (__, j) => MARKS[(k * 13 + j) % MARKS.length]).join("") : "")).join("");

describe("a long label whose fifth letter carries 9,800 marks", () => {
  it("as link text, drawn with the link's site, in under 10 ms", () => {
    const text = `https://${heavyLabel()}.com`;
    expect(text.length).toBeLessThanOrEqual(10_000);
    drawnWithItsSite(text, EVIL);
    const took = median(() => linkTextProblem(text, EVIL), 6);
    expect(took, `took ${took.toFixed(1)} ms`).toBeLessThan(10);
  }, 60_000);

  it("as an address (with 1,900 marks: within 2,048 characters), refused before it is parsed, in under 1 ms", () => {
    const address = `https://${heavyLabel(0, 1_900)}.com/`;
    expect(address.length).toBeLessThanOrEqual(2_048);
    expect(checkLinkHref(address)).toEqual({ ok: false, reason: "host" });
    expect(median(() => checkLinkHref(address))).toBeLessThan(1);
  });
});
