import { describe, it, expect } from "vitest";
import { findLinks, linkifyInline } from "./linkify";
import type { RtInline } from "./types";

/** What a learner would see as links in `text`: [linked text, href]. */
function links(text: string): [string, string][] {
  return findLinks(text).map((link) => [
    text.slice(link.start, link.end),
    link.href,
  ]);
}

/** The linked text only. */
function linked(text: string): string[] {
  return links(text).map(([shown]) => shown);
}

describe("findLinks — web addresses", () => {
  it("links https and http addresses typed in text", () => {
    expect(links("See https://example.org for more.")).toEqual([
      ["https://example.org", "https://example.org/"],
    ]);
    expect(links("Old site: http://example.org/a/b?x=1&y=2#top")).toEqual([
      ["http://example.org/a/b?x=1&y=2#top", "http://example.org/a/b?x=1&y=2#top"],
    ]);
  });

  it("finds every address, at the start, middle and end of the text", () => {
    expect(
      linked("https://a.example one https://b.example/x two https://c.example")
    ).toEqual(["https://a.example", "https://b.example/x", "https://c.example"]);
  });

  it("accepts the scheme in any letter case, keeping the text as typed", () => {
    expect(links("HTTPS://Example.ORG/Path")).toEqual([
      ["HTTPS://Example.ORG/Path", "https://example.org/Path"],
    ]);
    expect(linked("Http://example.org")).toEqual(["Http://example.org"]);
  });

  it("keeps trailing punctuation outside the link", () => {
    for (const end of [".", ",", ";", ":", "!", "?", "…", "'", '"', "*", "_", "~"]) {
      expect(linked(`Go to https://example.org/page${end}`)).toEqual([
        "https://example.org/page",
      ]);
    }
    // Several in a row, and a Greek question mark (;) and ano teleia (·).
    expect(linked("Really, https://example.org?!")).toEqual(["https://example.org"]);
    expect(linked("Δες https://example.gr; ή https://example.gr/a·")).toEqual([
      "https://example.gr",
      "https://example.gr/a",
    ]);
    // Closing quotes in English, German and Greek style.
    expect(linked("“https://example.org”")).toEqual(["https://example.org"]);
    expect(linked("„https://example.de“")).toEqual(["https://example.de"]);
    expect(linked("«https://example.gr»")).toEqual(["https://example.gr"]);
  });

  it("keeps punctuation inside the address when more of it follows", () => {
    expect(linked("https://example.org/a.b,c;d!e?f=g.h")).toEqual([
      "https://example.org/a.b,c;d!e?f=g.h",
    ]);
  });

  it("keeps an unbalanced closing bracket outside the link", () => {
    expect(linked("(see https://example.org/page)")).toEqual([
      "https://example.org/page",
    ]);
    expect(linked("[https://example.org]")).toEqual(["https://example.org"]);
    expect(linked("{https://example.org}")).toEqual(["https://example.org"]);
    expect(linked("(see https://example.org/page).")).toEqual([
      "https://example.org/page",
    ]);
  });

  it("keeps balanced brackets that belong to the address", () => {
    expect(linked("https://en.wikipedia.org/wiki/Mercury_(planet)")).toEqual([
      "https://en.wikipedia.org/wiki/Mercury_(planet)",
    ]);
    expect(
      linked("(see https://en.wikipedia.org/wiki/Mercury_(planet))")
    ).toEqual(["https://en.wikipedia.org/wiki/Mercury_(planet)"]);
    expect(linked("https://example.org/a[1]")).toEqual([
      "https://example.org/a[1]",
    ]);
    // In a path, query or fragment, a "[" isn't in the host.
    expect(linked("https://example.org/?a[]=1&b[x]=2 and https://example.org/#[x] and https://example.org\\a[1]")).toEqual([
      "https://example.org/?a[]=1&b[x]=2",
      "https://example.org/#[x]",
      "https://example.org\\a[1]",
    ]);
  });

  it("ends an address at a space, line break, quote or angle bracket", () => {
    expect(linked("https://example.org\nnext line")).toEqual(["https://example.org"]);
    expect(linked("https://example.org\u00a0next")).toEqual(["https://example.org"]);
    expect(linked('<https://example.org>')).toEqual(["https://example.org"]);
    expect(linked('"https://example.org"x')).toEqual(["https://example.org"]);
  });

  it("links addresses with international domain names, by their ASCII form", () => {
    expect(links("https://παράδειγμα.ελ/σελίδα")).toEqual([
      [
        "https://παράδειγμα.ελ/σελίδα",
        "https://xn--hxajbheg2az3al.xn--qxam/%CF%83%CE%B5%CE%BB%CE%AF%CE%B4%CE%B1",
      ],
    ]);
  });

  it("doesn't link a scheme without an address after it", () => {
    for (const text of ["https://", "http:// example.org", "https://.", "https://...", "(https://)"]) {
      expect(findLinks(text)).toEqual([]);
    }
  });

  it("doesn't link a scheme glued to the word before it", () => {
    expect(findLinks("xhttps://example.org")).toEqual([]);
    expect(findLinks("abc123http://example.org")).toEqual([]);
    expect(findLinks("javascript:https://example.org")).toEqual([]);
  });

  it("doesn't link an address that hides its real host behind a user name", () => {
    expect(findLinks("https://trusted.example@evil.example/login")).toEqual([]);
    expect(findLinks("https://user:pass@example.org")).toEqual([]);
  });

  it("doesn't link an address with an invalid port", () => {
    expect(findLinks("https://example.org:99999/")).toEqual([]);
  });

  it("stops at direction-changing characters that could disguise an address", () => {
    expect(linked("https://example.org\u202Egro.live")).toEqual([
      "https://example.org",
    ]);
  });
});

describe("findLinks — never anything but web and email links", () => {
  const HOSTILE = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "JAVASCRIPT:alert(document.cookie)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "DATA:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "VBScript:msgbox(1)",
    "file:///etc/passwd",
    "FILE://C:/Windows",
    "ftp://example.org/file",
    "tel:+3012345678",
    "sms:+3012345678",
    "blob:https://example.org/uuid",
    "about:blank",
    "chrome://settings",
    "intent://scan/#Intent;scheme=zxing;end",
    "www.example.org",
    "example.org",
    "//example.org/path",
  ];

  it("links none of these", () => {
    for (const text of HOSTILE) {
      expect(findLinks(text), text).toEqual([]);
    }
  });

  it("only ever produces http, https and mailto hrefs", () => {
    const mixed = [
      ...HOSTILE,
      "https://ok.example",
      "mailto:a@b.example",
      "a@b.example",
      "http://ok.example/x",
    ].join(" ");
    const hrefs = findLinks(mixed).map((link) => link.href);
    expect(hrefs).toHaveLength(4);
    for (const href of hrefs) {
      expect(href).toMatch(/^(?:https?:\/\/|mailto:)/);
    }
  });

  it("links a web address inside other text only as itself", () => {
    // The web address is a plain https link; nothing around it is linked.
    expect(links("data:text/html,https://example.org")).toEqual([
      ["https://example.org", "https://example.org/"],
    ]);
  });
});

describe("findLinks — email addresses", () => {
  it("links a bare email address as mailto", () => {
    expect(links("Write to help@example.org today.")).toEqual([
      ["help@example.org", "mailto:help@example.org"],
    ]);
    expect(links("first.last+tag@mail.example.co.uk")).toEqual([
      ["first.last+tag@mail.example.co.uk", "mailto:first.last+tag@mail.example.co.uk"],
    ]);
  });

  it("links a typed mailto: address, in any letter case", () => {
    expect(links("mailto:help@example.org")).toEqual([
      ["mailto:help@example.org", "mailto:help@example.org"],
    ]);
    expect(links("MailTo:Help@Example.org")).toEqual([
      ["MailTo:Help@Example.org", "mailto:Help@Example.org"],
    ]);
    expect(links("mailto:help@example.org?subject=Hello")).toEqual([
      ["mailto:help@example.org?subject=Hello", "mailto:help@example.org?subject=Hello"],
    ]);
  });

  it("keeps trailing punctuation and brackets outside an email link", () => {
    expect(linked("Mail help@example.org.")).toEqual(["help@example.org"]);
    expect(linked("(help@example.org)")).toEqual(["help@example.org"]);
    expect(linked("Mail mailto:help@example.org, please.")).toEqual([
      "mailto:help@example.org",
    ]);
    expect(linked("help@example.org?")).toEqual(["help@example.org"]);
  });

  it("links addresses with letters beyond ASCII", () => {
    expect(linked("müller@beispiel.de")).toEqual(["müller@beispiel.de"]);
    expect(linked("γιώργος@παράδειγμα.ελ")).toEqual(["γιώργος@παράδειγμα.ελ"]);
  });

  it("doesn't link things that only look a little like an address", () => {
    for (const text of [
      "@example.org",
      "user@",
      "user@localhost",
      "user@example",
      "user@example.c",
      "user@-example.org",
      "user@example-.org",
      "user@exa..mple.org",
      "a.@example.org",
      "a..b@example.org",
      "@handle on social media",
      "x@y@example.org",
      "mailto:",
      "mailto:not-an-address",
      "mailto:@example.org",
      "costs 5@3.50 each",
    ]) {
      expect(findLinks(text), text).toEqual([]);
    }
  });

  it("doesn't link the user part of another scheme's address as an email", () => {
    expect(findLinks("ftp://user@example.org/file")).toEqual([]);
    expect(findLinks("ssh:user@example.org")).toEqual([]);
  });
});

describe("findLinks — a host within DNS's limits", () => {
  const a = (n: number) => "a".repeat(n);
  // Letters beyond the Basic Multilingual Plane: two UTF-16 units each, one character.
  const astral = (n: number) => Array.from({ length: n }, (_, i) => String.fromCodePoint(0x20000 + i)).join("");
  /** A host of `total` characters: labels of 63, then the rest, dot-separated. */
  const host = (total: number) => {
    const labels: string[] = [];
    let left = total;
    for (const c of "abcdefgh") {
      const n = Math.min(63, left - (labels.length ? 1 : 0));
      if (n <= 0) break;
      labels.push(c.repeat(n));
      left -= n + (labels.length > 1 ? 1 : 0);
    }
    return labels.join(".");
  };

  it("links a host whose labels have up to 63 characters, in any script, each character counted once", () => {
    expect(linked(`https://${a(63)}.example/x`)).toEqual([`https://${a(63)}.example/x`]);
    expect(linked(`https://${"α".repeat(63)}.ελ`)).toEqual([`https://${"α".repeat(63)}.ελ`]);
    expect(linked(`https://${astral(63)}.example`)).toEqual([`https://${astral(63)}.example`]);
    expect(linked(`write to help@${a(63)}.example.`)).toEqual([`help@${a(63)}.example`]);
  });

  it("doesn't link a host with a label over 63 characters, letters or not, nor its email address", () => {
    for (const label of [a(64), "α".repeat(64), astral(64), `${a(63)}\u00ad`, `${a(32)}-${a(31)}`, "1".repeat(64)]) {
      expect(findLinks(`See https://${label}.example/x today`), label).toEqual([]);
      expect(findLinks(`help@${label}.example`), label).toEqual([]);
      expect(findLinks(`mailto:help@${label}.example`), label).toEqual([]);
    }
  });

  it("links a host of up to 253 characters (a final dot aside), and none longer", () => {
    expect(host(253)).toHaveLength(253);
    expect(linked(`https://${host(253)}/x`)).toEqual([`https://${host(253)}/x`]);
    expect(linked(`https://${host(253)}./x`)).toEqual([`https://${host(253)}./x`]);
    expect(linked(`help@${host(253)}`)).toEqual([`help@${host(253)}`]);
    expect(findLinks(`https://${host(254)}/x`)).toEqual([]);
    expect(findLinks(`help@${host(254)}`)).toEqual([]);
  });

  it("counts labels between the full stops the URL parser reads, and the host without its port or user name", () => {
    const word = "例".repeat(40);
    expect(linked(`https://${word}。${word}.jp`)).toEqual([`https://${word}。${word}.jp`]);
    expect(linked(`https://${word}．${word}.jp`)).toEqual([`https://${word}．${word}.jp`]);
    expect(linked(`https://${a(63)}.example:8080/x`)).toEqual([`https://${a(63)}.example:8080/x`]);
    expect(linked(`https:///${a(63)}.example`)).toEqual([`https:///${a(63)}.example`]);
  });
});

describe("findLinks — performance", () => {
  it("handles a block at the text limit without slowing down", () => {
    const worst = [
      "a".repeat(10_000),
      "@".repeat(10_000),
      "a@".repeat(5_000),
      `https://example.org/${")".repeat(9_000)}`,
      `https://${"a.".repeat(4_990)}`,
      `x@${"a-".repeat(4_990)}`,
      "https://".repeat(1_200),
      "mailto:".repeat(1_400),
    ];
    const started = performance.now();
    for (const text of worst) findLinks(text);
    expect(performance.now() - started).toBeLessThan(500);
  });

  // Ordinary lesson text: many short paragraphs with addresses, 10,000 characters in all.
  const paragraphs = [
    "Read more at https://www.bpb.de/themen/ or write to help@example.org before Friday.",
    "Μάθε περισσότερα στο https://παράδειγμα.ελ/σελίδα και γράψε στο info@example.gr.",
    "Mehr dazu unter https://www.bundesregierung.de/breg-de/themen (Stand: 2026).",
    "Pause before you answer. Ask why: who benefits, and who is left out?",
    "See (https://en.wikipedia.org/wiki/Social_enterprise) and mailto:team@example.org?subject=Hi.",
  ];
  const ordinary: string[] = [];
  for (let length = 0, i = 0; length < 10_000; i++) {
    ordinary.push(paragraphs[i % paragraphs.length]);
    length += paragraphs[i % paragraphs.length].length;
  }
  const letters = (from: number, n: number) => Array.from({ length: n }, (_, i) => String.fromCodePoint(from + i)).join("");
  const timed = (texts: readonly string[]) => {
    const started = performance.now();
    for (const text of texts) findLinks(text);
    return performance.now() - started;
  };
  /**
   * Each of `hostile` costs less than 15 times ordinary text of the same
   * length: the best of several rounds, taken in turn, so a busy machine
   * slows both alike.
   */
  function costsAsOrdinary(hostile: readonly string[]) {
    let best = Infinity;
    const worst = hostile.map(() => Infinity);
    for (let round = 0; round < 9; round++) {
      best = Math.min(best, timed(ordinary));
      hostile.forEach((text, i) => (worst[i] = Math.min(worst[i], timed([text]))));
    }
    for (const [i, ms] of worst.entries()) {
      expect(ms / best, `text ${i}: ${ms.toFixed(2)} ms against ${best.toFixed(2)} ms`).toBeLessThan(15);
    }
  }

  it("costs no more for a host past DNS's limits than for ordinary text of the same length", () => {
    // One block at the text limit each: a host of thousands of different
    // letters, which the URL parser would convert at a cost growing with the
    // square of its length.
    costsAsOrdinary([
      `https://${letters(0x4e00, 9_980)}.com`,
      Array.from({ length: 4 }, (_, k) => `https://${letters(0x4e00 + k * 2_490, 2_490)}.com`).join(" "),
      `https://www.example.org.${letters(0xac00, 9_960)}/`,
      `mailto:help@${letters(0x4e00, 9_970)}.com`,
      `help@${letters(0x4e00, 9_980)}.com`,
    ]);
  });

  it("reads a host with a '[' in it as the URL parser does: a ':' inside '[…]' doesn't end it, so a long one costs no more", () => {
    // For the URL parser a "[" anywhere in the host opens "[…]", and a ":"
    // inside doesn't start the port: the host it converts is the long one.
    const hostile = [
      `https://x[:]${letters(0x4e00, 9_970)}.com`,
      Array.from({ length: 4 }, (_, k) => `https://x[:]${letters(0x4e00 + k * 2_480, 2_480)}.com`).join(" "),
      `http://a.b[1:2]${letters(0xac00, 9_960)}/`,
    ];
    for (const text of hostile) expect(findLinks(text)).toEqual([]);
    costsAsOrdinary(hostile);
  });

  it("a '[' in a host anywhere but at its start: not an address, whatever follows the '[', so a long one behind it costs no more", () => {
    // For the URL parser a "[" opens "[…]" up to the next "]" (or the end),
    // a "/", "?" or "\\" inside included, and it refuses every host with a
    // "[" anywhere but at its start: a host behind one is never parsed.
    const at = (head: string) => `https://${head}${letters(0x4e00, 10_000 - 12 - [...head].length)}.com`;
    const forms = ["x[?", "x[/", "x[\\", "x[?:]", "x[\\:]", "x[?]", "a[?@", "u]@x[?", "a@x[/", "[/", "[?", "[\\"];
    const hostile = forms.map(at);
    for (const text of hostile) expect(findLinks(text), text.slice(0, 16)).toEqual([]);
    costsAsOrdinary(hostile);
  });

  it("returns nothing, fast, for text without an address", () => {
    expect(findLinks("")).toEqual([]);
    expect(findLinks("Pause before you answer. Ask why: who benefits?")).toEqual([]);
  });
});

describe("linkifyInline", () => {
  const text = (value: string, ...marks: ("bold" | "italic")[]): RtInline =>
    marks.length
      ? { type: "text", text: value, marks: marks.map((type) => ({ type })) }
      : { type: "text", text: value };
  const br: RtInline = { type: "hardBreak" };

  it("returns text without addresses unchanged — the same array", () => {
    const content = [text("Plain "), text("bold", "bold"), br, text("more")];
    expect(linkifyInline(content)).toBe(content);
  });

  it("splits a text node around the address", () => {
    expect(linkifyInline([text("Visit https://example.org today.")])).toEqual([
      text("Visit "),
      {
        type: "link",
        href: "https://example.org/",
        kind: "web",
        content: [text("https://example.org")],
      },
      text(" today."),
    ]);
  });

  it("keeps the marks of a bold or italic address inside the link", () => {
    expect(
      linkifyInline([
        text("Mail "),
        text("help@example.org", "bold", "italic"),
        text("!"),
      ])
    ).toEqual([
      text("Mail "),
      {
        type: "link",
        href: "mailto:help@example.org",
        kind: "email",
        content: [text("help@example.org", "bold", "italic")],
      },
      text("!"),
    ]);
  });

  it("makes one link of an address that changes formatting partway", () => {
    expect(
      linkifyInline([text("https://example.org/"), text("guide", "bold"), text(" now")])
    ).toEqual([
      {
        type: "link",
        href: "https://example.org/guide",
        kind: "web",
        content: [text("https://example.org/"), text("guide", "bold")],
      },
      text(" now"),
    ]);
  });

  it("ends an address at a line break", () => {
    expect(linkifyInline([text("https://example.org"), br, text("next")])).toEqual([
      {
        type: "link",
        href: "https://example.org/",
        kind: "web",
        content: [text("https://example.org")],
      },
      br,
      text("next"),
    ]);
  });

  it("links several addresses in one run of formatted text", () => {
    const out = linkifyInline([
      text("a@example.org or https://example.org", "italic"),
    ]);
    expect(out.map((node) => node.type)).toEqual(["link", "text", "link"]);
    expect(out[1]).toEqual(text(" or ", "italic"));
  });
});

