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

