import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cpuRatio, leastCpuMs } from "./cpu-time.test-helpers";

/*
 * Release 4 (U3, D104; verdict §7: 10 ms a text, 0.5 s a 1 MB save): links
 * that touch are read together, and that costs time in proportion to the
 * paragraph, never to the number of links times its length or times the
 * names it shows. The sanitizer runs on every render (the server's page,
 * and the learner's browser), so a paragraph of hundreds of touching links
 * must cost what any paragraph of its length costs.
 *
 * Measured as work where a counter can state it: the text read for
 * addresses (addressesShown), the URLs parsed, and the sites looked up in
 * the Public Suffix List (registrableDomain and publicSuffixLength); and as
 * CPU time (cpu-time.test-helpers.ts: the least of nine rounds, two pieces
 * of work in turn), against the same text drawn another way.
 */

const read = vi.hoisted(() => ({ chars: 0, calls: 0 }));
const looked = vi.hoisted(() => ({ count: 0 }));

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

vi.mock("./top-level-domains", async (importOriginal) => {
  const original = await importOriginal<typeof import("./top-level-domains")>();
  return {
    ...original,
    registrableDomain: (hostname: string) => {
      looked.count++;
      return original.registrableDomain(hostname);
    },
    publicSuffixLength: (labels: readonly string[], end?: number) => {
      looked.count++;
      return original.publicSuffixLength(labels, end);
    },
  };
});

const { sanitizeRichText } = await import("./sanitize");
const { sanitizeNarrativeBlocks } = await import("./narrative");

let parsed = 0;
const RealURL = globalThis.URL;
beforeEach(() => {
  read.chars = 0;
  read.calls = 0;
  looked.count = 0;
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

/** 440 touching links, alternately to two addresses of one site, each text three names of another host of it (9,240 characters). */
const sameHost = (i: number): [string, string] => ["b.a.de,".repeat(3), `https://c.a.de/${i % 2}`];
/** Link i, of 330 that touch, to its own host of one site, its text three names of another host of its own (9,570 characters). */
const ownHost = (i: number): [string, string] => [`b${i}.a.de,`.repeat(3), `https://c${i}.a.de/`];

describe("sanitizeRichText reads touching links in time proportional to the text", () => {
  const cases: [string, number, (i: number) => [string, string], string[]][] = [
    // One site, shown and opened: every link kept.
    ["520 touching links to two addresses of one site, each text an email address of it", 520, (i) => ["a@x.de ", `https://x.de/${i % 2}`], []],
    // Read as one word, "x.dex.dex.de…" shows dex.de, another site: none kept.
    ["520 touching links with no space between them", 520, (i) => ["x.de", `https://x.de/${i % 2}`], ["dropped-link"]],
    ["480 touching links, each to its own address on one site", 480, (i) => ["a@x.de ", `https://x.de/${i}`], []],
    ["740 touching links, over the size limit", 740, (i) => ["a@x.de ", `https://x.de/${i % 2}`], ["too-large"]],
    // Names of one site over links to it, all read together: every link kept.
    ["440 touching links to two addresses of one site, each text three names of another host of it", 440, sameHost, []],
    ["330 touching links, each to its own host of one site, each text three names of another host of its own", 330, ownHost, []],
  ];
  it.each(cases)("%s", (_, runs, make, issues) => {
    const content = Array.from({ length: runs }, (__, i) => linkNode(...make(i)));
    const text = content.map((node) => node.text).join("");
    expect(sanitizeRichText(paragraphOf(content)).issues).toEqual(issues);
    expect(read.chars, "characters read for addresses").toBeLessThanOrEqual(4 * text.length);
    // A few for each link (its address, and each reading's), never one for each link it touches.
    expect(parsed, "URLs parsed").toBeLessThanOrEqual(12 * runs);
    // A few for each name and link, never one for each name and link together.
    expect(looked.count, "sites looked up").toBeLessThanOrEqual(text.length);
  });

  it("reads 440 touching links in less than 3 times the CPU time of the same text as one link", () => {
    const content = Array.from({ length: 440 }, (_, i) => linkNode(...sameHost(i)));
    const many = paragraphOf(content);
    const one = paragraphOf([linkNode(content.map((node) => node.text).join(""), sameHost(0)[1])]);
    expect(sanitizeRichText(many).issues).toEqual([]);
    const { long, ratio } = cpuRatio(() => sanitizeRichText(many), () => sanitizeRichText(one));
    expect(ratio, `${long.toFixed(2)} ms, ${ratio.toFixed(1)} times`).toBeLessThan(3);
  }, 60_000);

  it("reads 330 touching links, each to its own host, in less than 3 times the CPU time of the same links apart", () => {
    const touching = paragraphOf(Array.from({ length: 330 }, (_, i) => linkNode(...ownHost(i))));
    const apart = paragraphOf(Array.from({ length: 330 }, (_, i) => [linkNode(...ownHost(i)), { type: "text", text: " " }]).flat());
    expect(sanitizeRichText(touching).issues).toEqual([]);
    expect(sanitizeRichText(apart).issues).toEqual([]);
    const { long, ratio } = cpuRatio(() => sanitizeRichText(touching), () => sanitizeRichText(apart));
    expect(ratio, `${long.toFixed(2)} ms, ${ratio.toFixed(1)} times`).toBeLessThan(3);
  }, 60_000);
});

/*
 * A save of at most 1 MB (a request's JSON body, as lesson blocks) of
 * paragraphs of five touching links, each link 280 names of one site:
 * every block kept, in under 0.5 s of CPU time (the least of three saves).
 */
describe("a 1 MB save of paragraphs of touching links", () => {
  const lesson = (link: (block: number, i: number) => [string, string]) => {
    const blocks: unknown[] = [];
    let bytes = 2;
    for (let b = 0; b < 100; b++) {
      const block = { kind: "paragraph", text: "", rich: paragraphOf(Array.from({ length: 5 }, (_, i) => linkNode(...link(b, i)))) };
      const size = Buffer.byteLength(JSON.stringify(block)) + 1;
      if (bytes + size > 1024 * 1024) break;
      blocks.push(block);
      bytes += size;
    }
    return blocks;
  };
  const savedInTime = (blocks: unknown[]) => {
    expect(blocks).toHaveLength(100);
    let result: ReturnType<typeof sanitizeNarrativeBlocks> | null = null;
    const [took] = leastCpuMs([() => (result = sanitizeNarrativeBlocks(blocks))], 3);
    expect(result).toMatchObject({ ok: true });
    expect(took, `${took.toFixed(0)} ms of CPU time`).toBeLessThan(500);
  };

  it("100 blocks, each link to one of two addresses of one site, in under 0.5 s", () => {
    savedInTime(lesson((_, i) => ["b.a.de ".repeat(280), `https://c.a.de/${i % 2}`]));
  }, 60_000);

  it("100 blocks, each link to its own host of one site, its names of ten more, in under 0.5 s", () => {
    const names = (i: number) => Array.from({ length: 280 }, (_, j) => `b${j % 10}${i}.a.de `).join("").slice(0, 1_960);
    savedInTime(lesson((b, i) => [names(i), `https://c${i}.a.de/${b}`]));
  }, 60_000);
});

/*
 * A name or an address of up to 10,000 characters (a block's most) costs
 * time in proportion to its length, within 10 ms: compared as eight links
 * of 1,250 characters against one of 10,000, the same characters in all,
 * by CPU time, it takes about as long, never eight times as long. A stretch
 * of text is read once: two links that touch and make one word are read
 * each, and once together; a misleading text is read once.
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
  it.each(texts)("%s, as one link and as two touching links", (_, make) => {
    const one = (n: number) => paragraphOf([linkNode(make(n), EVIL)]);
    const two = (n: number) => {
      const text = make(n);
      const half = Math.floor(text.length / 2);
      return paragraphOf([linkNode(text.slice(0, half), "https://evil.example/a"), linkNode(text.slice(half), "https://evil.example/b")]);
    };
    for (const block of [one, two]) {
      const save = (blocks: unknown[]) => () => {
        for (const saved of blocks) sanitizeRichText(saved);
      };
      const { long, ratio } = cpuRatio(save([block(10_000)]), save(Array.from({ length: 8 }, () => block(1_250))));
      expect(ratio, `${long.toFixed(2)} ms, ${ratio.toFixed(1)} times`).toBeLessThan(3);
      expect(long, "the long text, in ms of CPU time").toBeLessThan(10);
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
