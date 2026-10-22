import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
 * Release 4 (U3, D104): links that touch are read together, and that costs
 * time in proportion to the paragraph, never to the number of links times
 * its length. The sanitizer runs on every render (the server's page, and
 * the learner's browser), so a paragraph of hundreds of touching links must
 * cost what any paragraph of its length costs.
 *
 * Measured as work, not time (a shared machine's timings vary): the text
 * read for addresses (addressesShown) and the URLs parsed.
 */

const read = vi.hoisted(() => ({ chars: 0, calls: 0 }));

vi.mock("./link-text", async (importOriginal) => {
  const original = await importOriginal<typeof import("./link-text")>();
  return {
    ...original,
    addressesShown: (text: string) => {
      read.chars += text.length;
      read.calls++;
      return original.addressesShown(text);
    },
  };
});

const { sanitizeRichText } = await import("./sanitize");

let parsed = 0;
const RealURL = globalThis.URL;
beforeEach(() => {
  read.chars = 0;
  read.calls = 0;
  parsed = 0;
  globalThis.URL = class extends RealURL {
    constructor(url: string | URL, base?: string | URL) {
      parsed++;
      super(url, base);
    }
  } as typeof URL;
});
afterEach(() => {
  globalThis.URL = RealURL;
});

const linkNode = (text: string, href: string) => ({ type: "text", text, marks: [{ type: "link", attrs: { href } }] });
const paragraphOf = (content: unknown[]) => ({ v: 2, doc: { type: "doc", content: [{ type: "paragraph", content }] } });

describe("sanitizeRichText reads touching links in time proportional to the text", () => {
  const cases: [string, number, (i: number) => [string, string], string[]][] = [
    // One site, shown and opened: every link kept.
    ["520 touching links to two addresses of one site, each text an email address of it", 520, (i) => ["a@x.de ", `https://x.de/${i % 2}`], []],
    // Read as one word, "x.dex.dex.de…" shows dex.de, another site: none kept.
    ["520 touching links with no space between them", 520, (i) => ["x.de", `https://x.de/${i % 2}`], ["dropped-link"]],
    ["480 touching links, each to its own address on one site", 480, (i) => ["a@x.de ", `https://x.de/${i}`], []],
    ["740 touching links, over the size limit", 740, (i) => ["a@x.de ", `https://x.de/${i % 2}`], ["too-large"]],
  ];
  it.each(cases)("%s", (_, runs, make, issues) => {
    const content = Array.from({ length: runs }, (__, i) => linkNode(...make(i)));
    const text = content.map((node) => node.text).join("");
    expect(sanitizeRichText(paragraphOf(content)).issues).toEqual(issues);
    expect(read.chars, "characters read for addresses").toBeLessThanOrEqual(4 * text.length);
    // A few for each link (its address, and each reading's), never one for each link it touches.
    expect(parsed, "URLs parsed").toBeLessThanOrEqual(12 * runs);
  });
});

/*
 * A name or an address of up to 10,000 characters (a block's most) costs
 * time in proportion to its length: compared as eight links of 1,250
 * characters against one of 10,000, the same characters in all, it takes
 * about as long, never eight times as long. A stretch of text is read once:
 * two links that touch and make one word are read each, and once together;
 * a misleading text is read once.
 */
describe("sanitizeRichText reads a long name or address in time proportional to its length", () => {
  const EVIL = "https://evil.example/login";
  const dottedTitle = (n: number) => `Dr.${"de.".repeat(Math.floor((n - 5) / 3))}de`;
  const companyForm = (n: number) => `${"Co.".repeat(Math.floor((n - 2) / 3))}UK`;
  const texts: [string, (n: number) => string][] = [
    ["a title before thousands of labels", dottedTitle],
    ["a company form before thousands of labels", companyForm],
    ["an address of thousands of commas", (n) => `https://a${",".repeat(n - 10)}b`],
    ["an email address of thousands of commas", (n) => `mailto:a@b${",".repeat(n - 11)}c`],
    ["an address of thousands of dots", (n) => `https://a${".".repeat(n - 10)}b`],
  ];
  const time = (blocks: unknown[]) => {
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      const started = performance.now();
      for (const block of blocks) sanitizeRichText(block);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  it.each(texts)("%s, as one link and as two touching links", (_, make) => {
    const one = (n: number) => paragraphOf([linkNode(make(n), EVIL)]);
    const two = (n: number) => {
      const text = make(n);
      const half = Math.floor(text.length / 2);
      return paragraphOf([linkNode(text.slice(0, half), "https://evil.example/a"), linkNode(text.slice(half), "https://evil.example/b")]);
    };
    for (const block of [one, two]) {
      const short = Array.from({ length: 8 }, () => block(1_250));
      time(short);
      // Within the budget of 10 ms a text, a fraction of a millisecond is noise: under 3 ms passes.
      const long = time([block(10_000)]);
      const ratio = long / time(short);
      expect(long < 3 || ratio < 3, `${long.toFixed(2)} ms, ${ratio.toFixed(1)} times`).toBe(true);
    }
  }, 60_000);

  it("reads two touching links that make one word each, and once together", () => {
    // Each a company form before many labels, and so the two together: no
    // host (its top-level domain in capitals).
    const first = "Co.".repeat(1_665);
    const second = companyForm(5_000);
    const result = sanitizeRichText(paragraphOf([linkNode(first, "https://evil.example/a"), linkNode(second, "https://evil.example/b")]));
    expect(result.issues).toEqual([]);
    expect(read.chars, "characters read for addresses").toBeLessThanOrEqual(2 * (first.length + second.length));
  });

  it("reads a misleading link's text once", () => {
    const text = `https://bank.example/${"a".repeat(5_000)}`;
    expect(sanitizeRichText(paragraphOf([linkNode(text, EVIL)])).issues).toEqual(["dropped-link"]);
    expect(read.chars, "characters read for addresses").toBeLessThanOrEqual(text.length);
  });
});
