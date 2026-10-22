import { describe, it, expect } from "vitest";
import { linkSite, textIsSite } from "./link-site";
import { checkLinkHref, MAX_HREF_CHARS } from "./link-url";

/*
 * The site label (the owner's decision of 22 October 2026: learners see the
 * site each named link opens, in a small box after the link's words; D104,
 * D105): what the box says (linkSite), and when the link's words already
 * are its address, so the box is left out (textIsSite).
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

  it("is none for an email link, and for anything the address check refuses", () => {
    expect(linkSite("mailto:help@example.org")).toBeNull();
    expect(linkSite("mailto:help@example.org?subject=Hi")).toBeNull();
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
      if (!check.ok || check.kind !== "web") {
        expect(linkSite(input), input.slice(0, 60)).toBeNull();
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

  it("takes time in proportion to the address: the longest address in well under a millisecond", () => {
    const longest = `https://${"a".repeat(63)}.example/${"b".repeat(1_900)}`;
    linkSite(longest);
    const started = performance.now();
    for (let i = 0; i < 100; i++) linkSite(longest);
    expect((performance.now() - started) / 100).toBeLessThan(1);
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

  it("is false for an email link and for any address the check refuses (they show no box)", () => {
    expect(textIsSite("help@example.org", "mailto:help@example.org")).toBe(false);
    expect(textIsSite("mailto:help@example.org", "mailto:help@example.org")).toBe(false);
    expect(textIsSite("javascript:alert(1)", "javascript:alert(1)")).toBe(false);
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
