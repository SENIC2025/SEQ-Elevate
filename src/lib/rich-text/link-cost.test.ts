import { describe, it, expect } from "vitest";
import { checkLinkHref } from "./link-url";
import { linkTextProblem } from "./link-text";
import { sanitizeRichText } from "./sanitize";

/*
 * Release 4 (D103, D104): a host that DNS can't hold (a label of more than
 * 63 characters, a host of more than 253; RFC 1035) costs time in
 * proportion to its length wherever it is read. The address check refuses
 * it before it parses the address, and link text that shows one reads its
 * long labels in pieces: parsed whole, such a label costs its length times
 * the characters it holds (its punycode), and a lesson of them seconds a
 * save.
 *
 * Each is timed as the median of 20 runs after a warm-up. Where a bound in
 * milliseconds would leave a shared machine too little room, the time is
 * compared with that of other input of the same length in all.
 */

/** `length` different CJK ideographs, from the `from`th on. */
const cjk = (length: number, from = 0) =>
  Array.from({ length }, (_, i) => String.fromCodePoint(0x4e00 + ((from + i) % 20_000))).join("");

/** The median time `run` takes, in milliseconds, over `times` runs after three to warm up. */
function median(run: () => unknown, times = 20): number {
  for (let i = 0; i < 3; i++) run();
  const took: number[] = [];
  for (let i = 0; i < times; i++) {
    const started = performance.now();
    run();
    took.push(performance.now() - started);
  }
  took.sort((a, b) => a - b);
  return (took[times / 2 - 1] + took[times / 2]) / 2;
}

const EVIL = "https://evil.example/login";

describe("checkLinkHref refuses an address whose host DNS can't hold before it parses it", () => {
  const address = `https://${cjk(2_017)}.com/`;

  it("a 2,030-character international address: refused as a host, in under 1 ms", () => {
    expect(address).toHaveLength(2_030);
    expect(checkLinkHref(address)).toEqual({ ok: false, reason: "host" });
    expect(median(() => checkLinkHref(address))).toBeLessThan(1);
  }, 60_000);

  it("a 2,030-character international address, in about the time of another of its length", () => {
    const other = `https://bücher.example/${cjk(2_007)}`;
    expect(other).toHaveLength(2_030);
    expect(median(() => checkLinkHref(address)) / median(() => checkLinkHref(other))).toBeLessThan(5);
  }, 60_000);
});

describe("link text that shows a host DNS can't hold is read in time in proportion to its length", () => {
  // Each read as before: a name that ends in a top-level domain shows its site.
  const shapes: [string, (label: string) => string, ReturnType<typeof linkTextProblem>][] = [
    ["a bare name", (label) => `${label}.com`, "misleading"],
    ["an address after a word", (label) => `Login:https://${label}.com`, "misleading"],
    ["a www. name", (label) => `www.${label}.com`, "misleading"],
    ["an email address", (label) => `info@${label}.com`, "misleading"],
    ["another site's name in front", (label) => `paypal.com.${label}.evil.example`, "misleading"],
    ["the link's own site behind it", (label) => `${label}.evil.example`, null],
  ];

  it.each(shapes)(
    "%s of 10,000 characters, one international label, in about the time of eighty of 125",
    (_, make, problem) => {
      const long = make(cjk(10_000 - make("").length));
      const short = Array.from({ length: 80 }, (__, k) => make(cjk(125 - make("").length, k * 125)));
      expect(long).toHaveLength(10_000);
      for (const text of [long, ...short]) expect(linkTextProblem(text, EVIL)).toBe(problem);
      const ratio = median(() => linkTextProblem(long, EVIL)) / median(() => short.forEach((text) => linkTextProblem(text, EVIL)));
      expect(ratio).toBeLessThan(3);
    },
    60_000
  );
});

describe("a lesson of long international hrefs and link text is checked in time in proportion to its size", () => {
  const rich = (content: unknown[]) => ({ v: 1, doc: { type: "doc", content: [{ type: "paragraph", content }] } });
  const link = (text: string, href: string) => ({ type: "text", text, marks: [{ type: "link", attrs: { href } }] });
  // As the design review's lesson-1mb.mts: a block of 22 links, each to a
  // host of one 2,030-character label; and a block of one link whose text
  // is a name of one 9,960-character label (in turns, shapes from above).
  const hrefBlock = (k: number) =>
    rich(Array.from({ length: 22 }, (_, i) => [link("a", `https://${cjk(2_030, k)}.com/${k}-${i}`), { type: "text", text: " " }]).flat());
  const texts = [
    (label: string) => `${label}.com`,
    (label: string) => `https://${label}.com`,
    (label: string) => `info@${label}.com`,
    (label: string) => `paypal.com.${label}.evil.example`,
  ];
  const textBlock = (k: number) => rich([link(texts[k % texts.length](cjk(9_960, k)), `https://evil.example/${k}`)]);

  /** The blocks, in turns, that a save of at most 1 MB holds (a request's JSON body, as lesson blocks). */
  function lesson(): unknown[] {
    const blocks: unknown[] = [];
    let bytes = 2;
    for (let k = 0; ; k++) {
      const block = { kind: "paragraph", text: "", rich: k % 2 ? textBlock(k) : hrefBlock(k) };
      const size = Buffer.byteLength(JSON.stringify(block)) + 1;
      if (bytes + size > 1024 * 1024) return blocks;
      blocks.push(block.rich);
      bytes += size;
    }
  }

  it("a crafted 1 MB lesson, every block refused, in under 0.5 s", () => {
    const blocks = lesson();
    expect(blocks.length).toBeGreaterThanOrEqual(10);
    const started = performance.now();
    const issues = blocks.map((block) => sanitizeRichText(block).issues);
    const took = performance.now() - started;
    for (const found of issues) expect(found.length).toBeGreaterThan(0);
    expect(took).toBeLessThan(500);
  }, 120_000);
});
