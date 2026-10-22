import { describe, it, expect } from "vitest";
import {
  MAX_HREF_CHARS,
  checkLinkHref,
  emailAddressOf,
  isEmailAddress,
  type LinkCheck,
  type LinkRefusal,
} from "./link-url";

/*
 * Release 4 spec 3.2 (U1): the one address check, as one table of inputs it
 * accepts (with the address it stores) and refuses (with why). Every
 * accepted address, checked again, comes back the same.
 */

const OWN = "abc123.public.blob.vercel-storage.com";

/** A check as compared here: an accepted address cut short, so a failed comparison of a huge input stays quick to show. */
const brief = (check: LinkCheck) =>
  check.ok && check.href.length > 120 ? { ...check, href: `${check.href.slice(0, 120)}…` } : check;

/** 2,048 characters exactly, and one more. */
const base = "https://example.org/";
const LONGEST = base + "a".repeat(MAX_HREF_CHARS - base.length);
const TOO_LONG = LONGEST + "a";

const ACCEPTED: [string, string, input: string, href: string][] = [
  ["web", "https", "https://example.org/guide", "https://example.org/guide"],
  ["web", "http (insecure)", "http://example.org", "http://example.org/"],
  ["web", "the scheme and host in upper case", "HTTPS://Example.ORG/Path", "https://example.org/Path"],
  ["web", "mixed case http", "HtTp://example.org/x", "http://example.org/x"],
  ["web", "spaces at either end, trimmed", "  https://example.org/x \t\n", "https://example.org/x"],
  ["web", "a query and a fragment", "https://example.org/a/b?x=1&y=2#top", "https://example.org/a/b?x=1&y=2#top"],
  ["web", "an IP address", "https://192.0.2.1/x", "https://192.0.2.1/x"],
  ["web", "a host with a trailing dot", "https://example.org./x", "https://example.org./x"],
  ["web", "a German host (punycode out) and path (percent-encoded)", "https://bücher.example/straße", "https://xn--bcher-kva.example/stra%C3%9Fe"],
  ["web", "a Greek host and path", "https://ελληνικά.example/άρθρο", "https://xn--hxargifdar.example/%CE%AC%CF%81%CE%B8%CF%81%CE%BF"],
  ["web", "a port", "https://example.org:8443/x", "https://example.org:8443/x"],
  ["web", "2,048 characters", LONGEST, LONGEST],
  ["email", "an address", "mailto:help@example.org", "mailto:help@example.org"],
  ["email", "the scheme in upper case, the address kept as typed", "MAILTO:HELP@example.org", "mailto:HELP@example.org"],
  ["email", "a subject", "mailto:help@example.org?subject=Course%20question", "mailto:help@example.org?subject=Course%20question"],
  ["email", "an international domain, kept as typed", "mailto:info@bücher.example", "mailto:info@bücher.example"],
];

const REFUSED: [string, input: unknown, reason: LinkRefusal][] = [
  ["not a string: a number", 42, "empty"],
  ["not a string: an object", { href: "https://example.org" }, "empty"],
  ["not a string: an array", ["https://example.org"], "empty"],
  ["null", null, "empty"],
  ["empty", "", "empty"],
  ["spaces only", "   \t ", "empty"],
  ["2,049 characters", TOO_LONG, "too-long"],
  ["a million characters", "https://example.org/" + "a".repeat(1_000_000), "too-long"],
  ["a million spaces then an address", " ".repeat(1_000_000) + "https://" + "a".repeat(3_000) + ".org", "too-long"],
  ["a tab inside the scheme", "java\tscript:alert(1)", "characters"],
  ["a tab inside a web address", "https://exa\tmple.org", "characters"],
  ["a space inside", "https://example.org/a b", "characters"],
  ["a no-break space at the end", "https://example.org/\u00a0", "characters"],
  ["a right-to-left override", "https://example.org/\u202Egpj.exe", "characters"],
  ["a zero-width space", "https://exa\u200Bmple.org", "characters"],
  ["a byte-order mark first", "\uFEFFhttps://example.org", "characters"],
  ["a NUL", "https://example.org/\u0000", "characters"],
  ["a C1 control", "https://example.org/\u0085", "characters"],
  ["DEL", "https://example.org/\u007F", "characters"],
  ["an isolate", "https://example.org/\u2066x", "characters"],
  ["an unpaired surrogate", "mailto:help@example.org?subject=\uD800", "characters"],
  ["javascript:", "javascript:alert(1)", "scheme"],
  ["JaVaScRiPt:", "JaVaScRiPt:alert(1)", "scheme"],
  ["javascript: after a space", " javascript:alert(1)", "scheme"],
  ["data:", "data:text/html,<script>alert(1)</script>", "scheme"],
  ["vbscript:", "vbscript:msgbox(1)", "scheme"],
  ["file:", "file:///C:/x", "scheme"],
  ["tel:", "tel:+3212345678", "scheme"],
  ["https without slashes", "https:evil.example", "scheme"],
  ["https with one slash", "https:/evil.example", "scheme"],
  ["https with backslashes", "https:\\\\evil.example", "scheme"],
  ["a scheme-relative address", "//evil.example", "scheme"],
  ["a relative path", "/x", "scheme"],
  ["a fragment", "#x", "scheme"],
  ["a bare host (needs https://)", "www.example.org", "scheme"],
  ["a bare email address (needs mailto:)", "help@example.org", "scheme"],
  ["ftp:", "ftp://example.org/x", "scheme"],
  ["a user name and password", "https://user:pw@evil.example", "credentials"],
  ["a host behind a user name", "https://bank.example@evil.example", "credentials"],
  ["a host without a dot", "https://localhost/x", "host"],
  ["an empty label", "https://example..org/x", "host"],
  ["a host that is only a dot", "https://./x", "host"],
  ["an IPv6 address", "https://[2001:db8::1]/x", "host"],
  ["an unparsable port", "https://example.org:99999/x", "host"],
  ["no host", "https://", "host"],
  ["an Outlook safe link", "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org&data=someone%40example.org", "redirect"],
  ["an Outlook safe link, host with a trailing dot", "https://eur01.safelinks.protection.outlook.com./?url=https%3A%2F%2Fexample.org", "redirect"],
  ["an Outlook safe link, the bare wrapper host", "https://SafeLinks.Protection.Outlook.com/?url=x", "redirect"],
  ["mailto: with cc", "mailto:help@example.org?cc=someone@example.org", "email"],
  ["mailto: with bcc", "mailto:help@example.org?bcc=someone@example.org", "email"],
  ["mailto: with body", "mailto:help@example.org?body=Hello", "email"],
  ["mailto: with a subject and a cc", "mailto:help@example.org?subject=Hi&cc=someone@example.org", "email"],
  ["mailto: with a line break encoded in the subject", "mailto:help@example.org?subject=Hi%0D%0Abcc:someone@example.org", "email"],
  ["mailto: with an empty query", "mailto:help@example.org?", "email"],
  ["mailto: with no address", "mailto:", "email"],
  ["mailto: with two addresses", "mailto:a@example.org,b@example.org", "email"],
  ["mailto: with a domain without a dot", "mailto:help@localhost", "email"],
  ["mailto: with javascript", "mailto:javascript:alert(1)", "email"],
];

describe("checkLinkHref accepts web and email addresses, normalised", () => {
  it.each(ACCEPTED)("%s: %s", (kind, _, input, href) => {
    const check = checkLinkHref(input);
    expect(check).toEqual({
      ok: true,
      href,
      kind,
      insecure: href.startsWith("http://"),
      ownFile: false,
    });
  });

  it.each(ACCEPTED)("%s: %s, checked again, is the same", (_, __, input) => {
    const first = checkLinkHref(input);
    if (!first.ok) throw new Error("refused");
    expect(checkLinkHref(first.href)).toEqual(first);
  });
});

describe("checkLinkHref refuses everything else, and says why", () => {
  it.each(REFUSED)("%s", (_, input, reason) => {
    expect(brief(checkLinkHref(input))).toEqual({ ok: false, reason });
  });

  it("refuses a huge address by its length, before reading it", () => {
    const huge = "https://" + "a".repeat(5_000_000) + ".org";
    const started = performance.now();
    const check = checkLinkHref(huge);
    expect(performance.now() - started).toBeLessThan(200);
    expect(brief(check)).toEqual({ ok: false, reason: "too-long" });
  });

  it("refuses an address that is too long only once normalised", () => {
    // 700 Greek letters: each is two bytes, six characters percent-encoded.
    const typed = "https://example.org/" + "ά".repeat(700);
    expect(typed.length).toBeLessThanOrEqual(MAX_HREF_CHARS);
    expect(brief(checkLinkHref(typed))).toEqual({ ok: false, reason: "too-long" });
  });
});

describe("checkLinkHref flags our own file store (ownFile)", () => {
  const file = (host: string) => `https://${host}/handout-abc.pdf`;

  it("with the host given: exactly that host, in any case and with a trailing dot", () => {
    for (const host of [OWN, OWN.toUpperCase(), `${OWN}.`]) {
      const check = checkLinkHref(file(host), { ownFileHost: OWN });
      expect(check.ok && check.ownFile, host).toBe(true);
    }
    // The setting itself may be written in upper case or with a dot.
    const check = checkLinkHref(file(OWN), { ownFileHost: ` ${OWN.toUpperCase()}. ` });
    expect(check.ok && check.ownFile).toBe(true);
  });

  it("with the host given: another organisation's Vercel Blob store is an ordinary link", () => {
    const check = checkLinkHref(file("other999.public.blob.vercel-storage.com"), { ownFileHost: OWN });
    expect(check).toMatchObject({ ok: true, ownFile: false });
    expect(checkLinkHref("https://example.org/x.pdf", { ownFileHost: OWN })).toMatchObject({ ok: true, ownFile: false });
  });

  it("without a host: every Vercel Blob store counts as ours", () => {
    for (const opts of [undefined, {}, { ownFileHost: null }, { ownFileHost: "" }]) {
      expect(checkLinkHref(file(OWN), opts)).toMatchObject({ ok: true, ownFile: true });
      expect(checkLinkHref(file("other999.public.blob.vercel-storage.com"), opts)).toMatchObject({
        ok: true,
        ownFile: true,
      });
      expect(checkLinkHref("https://example.org/x.pdf", opts)).toMatchObject({ ok: true, ownFile: false });
      // Only the family's hosts: a look-alike isn't.
      expect(checkLinkHref("https://public.blob.vercel-storage.com.evil.example/x", opts)).toMatchObject({
        ok: true,
        ownFile: false,
      });
    }
  });

  it("never flags an email address", () => {
    expect(checkLinkHref(`mailto:files@${OWN}`)).toMatchObject({ ok: true, ownFile: false });
  });
});

describe("isEmailAddress (moved from linkify.ts) and emailAddressOf", () => {
  it("accepts a user part and a domain with a dot, nothing else", () => {
    for (const address of ["help@example.org", "first.last+tag@sub.example.org", "info@bücher.example", "ΕΔΩ@παράδειγμα.ελ"]) {
      expect(isEmailAddress(address), address).toBe(true);
    }
    for (const address of [
      "help",
      "@example.org",
      "help@",
      "help@localhost",
      "a@b@example.org",
      ".help@example.org",
      "help.@example.org",
      "he..lp@example.org",
      "help@example.o",
      "help@example.123",
      "help@-example.org",
      "he lp@example.org",
      "help@exa_mple.org",
    ]) {
      expect(isEmailAddress(address), address).toBe(false);
    }
  });

  it("gives the bare address of an email link", () => {
    expect(emailAddressOf("mailto:help@example.org")).toBe("help@example.org");
    expect(emailAddressOf("mailto:HELP@example.org?subject=Hi")).toBe("HELP@example.org");
    expect(emailAddressOf("https://example.org/")).toBeNull();
    expect(emailAddressOf("mailto:nobody")).toBeNull();
  });
});
