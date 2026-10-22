import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
 * Release 4 (U3, D104): links that touch are read together, and that costs
 * time in proportion to the paragraph, never to the number of links times
 * its length. The sanitizer runs on every render (the server's page, and
 * the learner's browser), so a paragraph of hundreds of touching links must
 * cost what any paragraph of its length costs.
 *
 * Measured as work, not time (a shared machine's timings vary): the text
 * read for addresses (findLinks) and the URLs parsed.
 */

const read = vi.hoisted(() => ({ chars: 0, calls: 0 }));

vi.mock("./linkify", async (importOriginal) => {
  const original = await importOriginal<typeof import("./linkify")>();
  return {
    ...original,
    findLinks: (text: string) => {
      read.chars += text.length;
      read.calls++;
      return original.findLinks(text);
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
    ["520 touching links to two addresses of one site, each text an email address of it", 520, (i) => ["a@x.ex ", `https://x.ex/${i % 2}`], []],
    // Read as one word, "a@x.exa@x.ex…" shows a@x.exa, of another site: none kept.
    ["520 touching links with no space between them", 520, (i) => ["a@x.ex", `https://x.ex/${i % 2}`], ["dropped-link"]],
    ["480 touching links, each to its own address on one site", 480, (i) => ["a@x.ex ", `https://x.ex/${i}`], []],
    ["740 touching links, over the size limit", 740, (i) => ["a@x.ex ", `https://x.ex/${i % 2}`], ["too-large"]],
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
