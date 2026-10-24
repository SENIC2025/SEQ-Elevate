import { describe, it, expect } from "vitest";
import { linkSite, linkWords, textIsSite } from "./link-site";
import { checkLinkHref, MAX_HREF_CHARS } from "./link-url";
import { cpuRatio } from "./cpu-time.test-helpers";

/*
 * The site label (the owner's decision of 22 October 2026: learners see the
 * site each named link opens, in a small box after the link's words; D104,
 * D105): what the box says (linkSite), when the link's words already are
 * its address, so the box is left out (textIsSite), and the words as drawn
 * before it (linkWords).
 */

/** Addresses of every kind the address check has a rule for, accepted and refused. */
const ADDRESSES: readonly string[] = [
  "https://example.org/guide",
  "http://example.org",
  "HTTPS://Example.ORG/Path",
  "  https://example.org/x \t\n",
  "https://example.org/a/b?x=1&y=2#top",
  "https://192.0.2.1/x",
  "https://example.org./x",
  "https://bücher.example/straße",
  "https://ελληνικά.example/άρθρο",
  "https://example.org:8443/x",
  "https://www.bbc.co.uk/news",
  "https://a.b.c.d.minedu.gov.gr/x",
  "https://www.comune.roma.it/",
  "https://login.paypal.com.evil.example/",
  "https://xn--pypal-4ve.com/",
  `https://${"a".repeat(63)}.example/`,
  "https://example.org/" + "a".repeat(MAX_HREF_CHARS - "https://example.org/".length),
  "https://other999.public.blob.vercel-storage.com/handout.pdf",
  "mailto:help@example.org",
  "mailto:info@bücher.example",
  "javascript:alert(1)",
  "https://user:pw@example.org/",
  "https://bank.example@evil.example/",
  "https:evil.example",
  "//evil.example",
  "https://intranet/x",
  "https://example.org/my file.pdf",
  "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org",
  "",
];

describe("linkSite: the site a web link opens, as learners see it", () => {
  it("is the registrable domain, without www.", () => {
    expect(linkSite("https://example.org/guide")).toBe("example.org");
    expect(linkSite("https://www.example.org/guide")).toBe("example.org");
    expect(linkSite("https://en.wikipedia.org/wiki/Mercury_(planet)")).toBe("wikipedia.org");
    expect(linkSite("https://www.bbc.co.uk/news")).toBe("bbc.co.uk");
    expect(linkSite("https://login.bank.example/")).toBe("bank.example");
    expect(linkSite("https://us02web.zoom.us/j/123")).toBe("us02web.zoom.us");
    expect(linkSite("http://example.org/old")).toBe("example.org");
    // Another site's name in front of the link's: the box names the link's.
    expect(linkSite("https://login.paypal.com.evil.example/")).toBe("evil.example");
    expect(linkSite("https://paypal.com-login.evil.example/")).toBe("evil.example");
  });

  it("shows a public suffix's own site, and a site under it, as the Public Suffix List draws them", () => {
    expect(linkSite("https://minedu.gov.gr/")).toBe("minedu.gov.gr");
    expect(linkSite("https://www.minedu.gov.gr/x")).toBe("minedu.gov.gr");
    expect(linkSite("https://www.gov.gr/")).toBe("gov.gr");
    expect(linkSite("https://wallet.gov.gr/")).toBe("wallet.gov.gr");
    expect(linkSite("https://www.gov.uk/guidance")).toBe("gov.uk");
  });

  it("removes one www. only, and never down to a top-level domain", () => {
    expect(linkSite("https://www.www.example.org/")).toBe("example.org");
    expect(linkSite("https://www.com/")).toBe("www.com");
    expect(linkSite("https://www2.example.org/")).toBe("example.org");
  });

  it("shows the host itself where no registrable domain can be told: an IP address, a top-level domain whose rules aren't all known", () => {
    expect(linkSite("https://192.0.2.1/x")).toBe("192.0.2.1");
    expect(linkSite("https://www.comune.roma.it/")).toBe("comune.roma.it");
    expect(linkSite("https://www.city.example.jp/")).toBe("city.example.jp");
  });

  it("is ASCII: an international name in punycode", () => {
    expect(linkSite("https://bücher.example/straße")).toBe("xn--bcher-kva.example");
    expect(linkSite("https://xn--bcher-kva.example/stra%C3%9Fe")).toBe("xn--bcher-kva.example");
    expect(linkSite("https://www.ελληνικά.example/άρθρο")).toBe("xn--hxargifdar.example");
    expect(linkSite("https://shop.xn--mller-kva.de/")).toBe("xn--mller-kva.de");
    // A look-alike: Cyrillic "а" in a Latin name.
    expect(linkSite("https://pаypal.com/")).toBe("xn--pypal-4ve.com");
  });

  it("is written as the URL parser writes the host: lower case, no trailing dot, no port", () => {
    expect(linkSite("HTTPS://Example.ORG/Path")).toBe("example.org");
    expect(linkSite("https://example.org./x")).toBe("example.org");
    expect(linkSite("https://example.org:8443/x")).toBe("example.org");
  });

  it("shows our own file store's site like any other (an own file stays a link on render, D103)", () => {
    expect(linkSite("https://abc123.public.blob.vercel-storage.com/handout.pdf")).toBe("vercel-storage.com");
  });

  it("is the site of an email link's domain, told the same way: its registrable domain, without www., in punycode", () => {
    expect(linkSite("mailto:help@example.org")).toBe("example.org");
    expect(linkSite("mailto:help@example.org?subject=Hi")).toBe("example.org");
    expect(linkSite("MAILTO:Help@Example.ORG")).toBe("example.org");
    expect(linkSite("mailto:info@evil.example")).toBe("evil.example");
    expect(linkSite("mailto:press@www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(linkSite("mailto:info@minedu.gov.gr")).toBe("minedu.gov.gr");
    expect(linkSite("mailto:info@gov.gr")).toBe("gov.gr");
    // Another site's name in front of the address's: the box names the address's.
    expect(linkSite("mailto:support@paypal.com.evil.example")).toBe("evil.example");
    expect(linkSite("mailto:info@bücher.example")).toBe("xn--bcher-kva.example");
    expect(linkSite("mailto:Info@Bücher.Example")).toBe("xn--bcher-kva.example");
    // A look-alike: Cyrillic "а" in a Latin name.
    expect(linkSite("mailto:service@pаypal.com")).toBe("xn--pypal-4ve.com");
  });

  it("is none for anything the address check refuses", () => {
    expect(linkSite(`mailto:help@${"a".repeat(64)}.example`)).toBeNull();
    expect(linkSite("mailto:help@localhost")).toBeNull();
    expect(linkSite("javascript:alert(1)")).toBeNull();
    expect(linkSite("https://user:pw@example.org/")).toBeNull();
    expect(linkSite("https://intranet/x")).toBeNull();
    expect(linkSite("https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org")).toBeNull();
    expect(linkSite("")).toBeNull();
  });

  it("names where the browser goes: for every web address the check accepts, the label ends the host the URL parser gives, at a dot", () => {
    let web = 0;
    for (const input of ADDRESSES) {
      const check = checkLinkHref(input);
      if (!check.ok) {
        expect(linkSite(input), input.slice(0, 60)).toBeNull();
        continue;
      }
      if (check.kind === "email") {
        // The domain after the address's "@", in punycode: the box ends it, at a dot.
        const domain = new URL(`https://${check.href.slice(check.href.indexOf("@") + 1).split("?")[0]}`).hostname;
        const site = linkSite(check.href);
        expect(site, check.href).toMatch(/^[a-z0-9.-]+$/);
        expect(domain === site || domain.endsWith(`.${site}`), `${domain} / ${site}`).toBe(true);
        continue;
      }
      web++;
      const host = new URL(check.href).hostname.replace(/\.$/, "");
      const site = linkSite(check.href);
      expect(site, check.href.slice(0, 60)).not.toBeNull();
      expect(site, check.href.slice(0, 60)).toMatch(/^[a-z0-9.-]+$/);
      expect(host === site || host.endsWith(`.${site}`), `${host} / ${site}`).toBe(true);
      // The address as given and as normalised show the same site.
      expect(linkSite(input)).toBe(site);
    }
    expect(web).toBe(18);
  });

  // Measured as work done, not time passed (cpu-time.test-helpers.ts): each
  // longest address of its kind against eight of an eighth of its length,
  // the same characters, by CPU time (cpuRatio: the least of 9 rounds each,
  // run in turn), 100 reads a round. About as long, or less, when the cost
  // grows with the length; eight times as long when with its square.
  it("takes time in proportion to the address: the longest address in well under a millisecond of CPU time", () => {
    // A web address of 2,000 characters; the longest email addresses: a local part of 1,950 characters; a domain of 253 distinct letters, the longest the check takes.
    const label = (from: number, n = 63) => Array.from({ length: n }, (_, i) => String.fromCodePoint(from + i)).join("");
    const kinds: [string, string][] = [
      [`https://${"a".repeat(63)}.example/${"b".repeat(1_900)}`, `https://${"a".repeat(8)}.example/${"b".repeat(237)}`],
      [`mailto:${"a".repeat(1_950)}@example.org`, `mailto:${"a".repeat(244)}@example.org`],
      [`mailto:help@${label(0x4e00)}.${label(0x4f00)}.${label(0x5000)}.${label(0x5100).slice(0, 53)}.example`, `mailto:help@${label(0x4e00, 32)}.example`],
    ];
    const read = (hrefs: string[]) => () => {
      for (let i = 0; i < 100; i++) for (const href of hrefs) linkSite(href);
    };
    for (const [longest, short] of kinds) {
      expect(linkSite(longest), longest.slice(0, 40)).not.toBeNull();
      expect(linkSite(short), short.slice(0, 40)).not.toBeNull();
      const { long, ratio } = cpuRatio(read([longest]), read(Array.from({ length: 8 }, () => short)));
      expect(ratio, `${longest.slice(0, 40)}: ${ratio.toFixed(2)} times`).toBeLessThan(3);
      expect(long / 100, `${longest.slice(0, 40)}: ms of CPU time a read`).toBeLessThan(1);
    }
  }, 30_000);
});

/*
 * The box is the same in the learner's browser as on the server (verdict
 * §7: Node and Chrome answer alike for every character Node assigns).
 * Chrome's URL parser writes "^" and "|" in a path as "%5E" and "%7C"; the
 * URL standard, and Node, keep them as typed. ChromeURL parses as Chrome
 * does, so the check, the site and the box are asked here as the learner's
 * browser asks them.
 */
describe("an address with ^ or | in its path, read as Chrome reads it", () => {
  const chromePath = (path: string) => path.replace(/\^/g, "%5E").replace(/\|/g, "%7C");
  class ChromeURL extends URL {
    get pathname() {
      return chromePath(super.pathname);
    }
    get href() {
      const href = super.href;
      const before = `${this.protocol}//${this.host}`;
      const path = super.pathname;
      return `${before}${chromePath(path)}${href.slice(before.length + path.length)}`;
    }
    toString() {
      return this.href;
    }
  }
  /** `ask` as Chrome answers it. */
  const inChrome = <T,>(ask: () => T): T => {
    const NodeURL = globalThis.URL;
    globalThis.URL = ChromeURL;
    try {
      return ask();
    } finally {
      globalThis.URL = NodeURL;
    }
  };

  const ADDRESSES_WITH_SIGNS = [
    "https://example.org/^",
    "https://example.org/a|b",
    "https://example.org/x^y?q=^|#^|",
    "https://example.org/%5E%7c",
    `https://example.org/${"|".repeat(1_000)}`,
    // 2,041 characters as Node writes it; 2,081 as Chrome does.
    `https://evil.example/${"a".repeat(2_000)}${"^".repeat(20)}`,
    `https://evil.example/${"a".repeat(2_026)}^`,
  ];

  it("ChromeURL writes a path as Chrome does", () => {
    expect(new ChromeURL("https://example.org/a^b|c?q=^|#^|").href).toBe("https://example.org/a%5Eb%7Cc?q=^|#^|");
    expect(new ChromeURL("https://example.org/a^b").pathname).toBe("/a%5Eb");
  });

  it("has its site in the box in Chrome too, 2,041 characters long as the URL standard writes it", () => {
    const address = `https://evil.example/${"a".repeat(2_000)}${"^".repeat(20)}`;
    expect(checkLinkHref(address)).toMatchObject({ ok: true });
    expect(inChrome(() => checkLinkHref(address))).toMatchObject({ ok: true });
    expect(inChrome(() => linkSite(address))).toBe("evil.example");
    expect(inChrome(() => textIsSite("PayPal – sign in", address))).toBe(false);
  });

  it("is accepted alike, with the same address, site and box, and Chrome's own form of it too", () => {
    for (const address of ADDRESSES_WITH_SIGNS) {
      const check = checkLinkHref(address);
      expect(check.ok, address.slice(0, 40)).toBe(true);
      if (!check.ok) continue;
      expect(inChrome(() => checkLinkHref(address)), address.slice(0, 40)).toEqual(check);
      expect(inChrome(() => checkLinkHref(check.href)), address.slice(0, 40)).toEqual(check);
      expect(inChrome(() => linkSite(check.href)), address.slice(0, 40)).toBe(linkSite(check.href));
      for (const words of ["PayPal – sign in", address, check.href, check.href.slice("https://".length)]) {
        expect(inChrome(() => textIsSite(words, check.href)), words.slice(0, 40)).toBe(textIsSite(words, check.href));
      }
      // The address as Chrome writes it, read again where it is short enough to be read.
      const chrome = new ChromeURL(address).href;
      if (chrome.length <= MAX_HREF_CHARS) {
        expect(checkLinkHref(chrome), chrome.slice(0, 40)).toEqual(check);
        expect(linkSite(chrome)).toBe(linkSite(check.href));
      }
    }
    expect(linkSite(`https://evil.example/${"a".repeat(2_000)}${"^".repeat(20)}`)).toBe("evil.example");
    expect(textIsSite("example.org/^", "https://example.org/^")).toBe(true);
  });

  it("is refused alike over 2,048 characters as the URL standard writes it", () => {
    // 2,043 characters as typed; "é" is written "%C3%A9".
    for (const address of [`https://evil.example/${"a".repeat(2_020)}éé`, `https://evil.example/${"a".repeat(2_015)}éé${"^".repeat(5)}`]) {
      expect(checkLinkHref(address), address.slice(-10)).toEqual({ ok: false, reason: "too-long" });
      expect(inChrome(() => checkLinkHref(address)), address.slice(-10)).toEqual({ ok: false, reason: "too-long" });
    }
  });
});

describe("textIsSite: the link's words are its address, so the box is left out", () => {
  const GUIDE = "https://example.org/guide";

  it("is true for the whole address, in any usual spelling", () => {
    for (const text of [
      "https://example.org/guide",
      "HTTPS://EXAMPLE.ORG/guide",
      "example.org/guide",
      "Example.Org/guide",
      "www.example.org/guide",
      "https://www.example.org/guide",
      "example.org/guide/",
      "  example.org/guide ",
    ]) {
      expect(textIsSite(text, GUIDE), text).toBe(true);
    }
    for (const [text, href] of [
      ["example.org", "https://example.org/"],
      ["example.org/", "https://example.org"],
      ["www.example.org", "https://example.org/"],
      ["example.org", "https://www.example.org/"],
      ["gov.gr", "https://www.gov.gr/"],
      ["http://example.org/old", "http://example.org/old"],
      ["example.org/a?x=1#top", "https://example.org/a?x=1#top"],
      ["example.org/a%20b", "https://example.org/a%20b"],
      ["example.org:8443/x", "https://example.org:8443/x"],
      ["xn--bcher-kva.example/stra%C3%9Fe", "https://bücher.example/straße"],
      ["192.0.2.1/x", "https://192.0.2.1/x"],
    ]) {
      expect(textIsSite(text, href), `${text} over ${href}`).toBe(true);
    }
  });

  it("is false for words that only begin with the site, or name it with more around it", () => {
    for (const [text, href] of [
      ["evil.example PAYPAL.COM Login", "https://evil.example/"],
      ["evil.example/paypal.com", "https://evil.example/"],
      ["evil.example/paypal.ⅽom", "https://evil.example/"],
      ["example.org", GUIDE],
      ["example.org/guide and more", GUIDE],
      ["Read example.org/guide", GUIDE],
      ["example.org/guide.", GUIDE],
      ["example.org/Guide", GUIDE],
      ["example.org/guide/x", GUIDE],
      ["https://bank.example", "https://evil.example/"],
      ["the guide", GUIDE],
    ]) {
      expect(textIsSite(text, href), `${text} over ${href}`).toBe(false);
    }
  });

  it("is false for another scheme, port, user name or address", () => {
    for (const [text, href] of [
      ["http://example.org/guide", GUIDE],
      ["https://example.org/old", "http://example.org/old"],
      ["example.org:443/guide", GUIDE],
      ["example.org/x", "https://example.org:8443/x"],
      ["user@example.org/guide", GUIDE],
      ["//example.org/guide", GUIDE],
      ["ftp://example.org/guide", GUIDE],
      ["sub.example.org/guide", GUIDE],
      ["www.www.example.org/guide", GUIDE],
      ["example.org./guide", GUIDE],
    ]) {
      expect(textIsSite(text, href), `${text} over ${href}`).toBe(false);
    }
  });

  it("is false for words with anything but ASCII: an international name shows its punycode in the box", () => {
    expect(textIsSite("bücher.example/straße", "https://bücher.example/straße")).toBe(false);
    expect(textIsSite("bücher.de", "https://xn--bcher-kva.de/")).toBe(false);
    // A look-alike over its own address: the box shows what it is.
    expect(textIsSite("pаypal.com", "https://pаypal.com/")).toBe(false);
    // Invisible characters, inside or between.
    expect(textIsSite("exam​ple.org/guide", GUIDE)).toBe(false);
    expect(textIsSite("example.org/guide‎", GUIDE)).toBe(false);
    expect(textIsSite("⁦example.org/guide⁩", GUIDE)).toBe(false);
    // Fullwidth and other compatibility forms of the address.
    expect(textIsSite("ｅxample.org/guide", GUIDE)).toBe(false);
    expect(textIsSite("example。org/guide", GUIDE)).toBe(false);
    // Right-to-left words.
    expect(textIsSite("אתר example.org/guide", GUIDE)).toBe(false);
  });

  it("is true for an email link whose words, as a whole, are its address, and false for any other words", () => {
    const HELP = "mailto:help@example.org";
    for (const [text, href] of [
      ["help@example.org", HELP],
      [" HELP@Example.ORG ", HELP],
      ["mailto:help@example.org", HELP],
      ["MAILTO:help@example.org", HELP],
      ["help@example.org", "mailto:help@example.org?subject=Course"],
      ["Help@Example.org", "mailto:help@EXAMPLE.org"],
    ]) {
      expect(textIsSite(text, href), `${text} over ${href}`).toBe(true);
    }
    for (const [text, href] of [
      ["our team", HELP],
      ["GOV.UK", "mailto:info@evil.example"],
      ["help@example.org today", HELP],
      ["Write to help@example.org", HELP],
      ["help@example.org.", HELP],
      ["other@example.org", HELP],
      ["help@example.org", "mailto:help@sub.example.org"],
      ["example.org", HELP],
      ["mailto:help@example.org?subject=Course", "mailto:help@example.org?subject=Course"],
      // Anything but printable ASCII keeps the box: it shows the domain in punycode.
      ["info@bücher.example", "mailto:info@bücher.example"],
      ["help@exam​ple.org", HELP],
      ["help@ｅxample.org", HELP],
    ]) {
      expect(textIsSite(text, href), `${text} over ${href}`).toBe(false);
    }
  });

  it("is false for any address the check refuses (it shows no box)", () => {
    expect(textIsSite("javascript:alert(1)", "javascript:alert(1)")).toBe(false);
    expect(textIsSite("help@localhost", "mailto:help@localhost")).toBe(false);
    expect(textIsSite("", GUIDE)).toBe(false);
    expect(textIsSite("   ", GUIDE)).toBe(false);
  });

  it("takes time in proportion to the words: 10,000 characters in well under 10 ms", () => {
    const long = `example.org/${"a".repeat(10_000)}`;
    const href = `https://example.org/${"a".repeat(2_000)}`;
    for (const text of [long, "x".repeat(10_000), `${"例".repeat(5_000)}.com`, ` ${"a ".repeat(5_000)}`]) {
      textIsSite(text, href);
      const started = performance.now();
      for (let i = 0; i < 10; i++) expect(textIsSite(text, href)).toBe(false);
      expect((performance.now() - started) / 10, text.slice(0, 20)).toBeLessThan(10);
    }
  });
});

describe("linkWords: a named link's words as drawn before its box, no blank pushing the box away", () => {
  it("draws each run of blank characters as one space: whitespace, the braille blank, the Hangul fillers, the interlinear annotation marks", () => {
    for (const blank of [" ", "\u00A0", "\u2003", "\u3000", "\u202F", "\u2800", "\u3164", "\uFFA0", "\u115F", "\u1160", "\uFFF9", "\uFFFB"]) {
      const name = `U+${blank.codePointAt(0)!.toString(16).toUpperCase()}`;
      expect(linkWords([`Sign in to PayPal${blank.repeat(1_500)}`]), name).toEqual(["Sign in to PayPal "]);
      expect(linkWords([`Sign in${blank.repeat(3)}to PayPal`]), name).toEqual(["Sign in to PayPal"]);
      expect(linkWords([`${blank.repeat(1_500)}Sign in`]), name).toEqual([" Sign in"]);
    }
    expect(linkWords(["Sign in to PayPal \u2003\u2800\u3164\u00A0 ."])).toEqual(["Sign in to PayPal ."]);
  });

  it("counts what shows nothing among the blanks as part of their run", () => {
    expect(linkWords([`Sign in to PayPal${" \u200B".repeat(800)}`])).toEqual(["Sign in to PayPal "]);
    expect(linkWords([`Sign in to PayPal${"\u2003\u2060\uFE0F\u00AD".repeat(500)}x`])).toEqual(["Sign in to PayPal x"]);
  });

  it("draws one run across the link's parts (bold, italic) as one space", () => {
    expect(linkWords(["Sign in to PayPal", ...Array.from({ length: 300 }, () => "\u2003"), "."])).toEqual([
      "Sign in to PayPal",
      " ",
      ...Array.from({ length: 299 }, () => ""),
      ".",
    ]);
    expect(linkWords(["the ", "\u200B", " guide"])).toEqual(["the ", "", "guide"]);
    expect(linkWords(["the", " ", "guide"])).toEqual(["the", " ", "guide"]);
  });

  it("keeps one space, one no-break space and one narrow no-break space as typed, and every other character", () => {
    for (const words of [
      "the guide",
      "10\u00A0km on foot",
      "Rapport d\u2019activit\u00E9\u202F: 2025",
      "\u{1F469}\u200D\u{1F4BB} the coder's guide \u2764\uFE0F",
      "\u05D4\u05DE\u05D3\u05E8\u05D9\u05DA",
      "a\u200Bb",
      "",
    ]) {
      expect(linkWords([words]), JSON.stringify(words)).toEqual([words]);
    }
  });

  it("takes time in proportion to the words: 10,000 characters in well under 10 ms", () => {
    for (const words of [" ".repeat(10_000), " \u200B".repeat(5_000), "a ".repeat(5_000), "\u2003\u00AD".repeat(5_000)]) {
      const parts = [words.slice(0, 5_000), words.slice(5_000)];
      linkWords(parts);
      const started = performance.now();
      for (let i = 0; i < 10; i++) linkWords(parts);
      expect((performance.now() - started) / 10, JSON.stringify(words.slice(0, 4))).toBeLessThan(10);
    }
  });
});
