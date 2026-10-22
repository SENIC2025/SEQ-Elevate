import { describe, it, expect } from "vitest";
import { checkLinkHref } from "./link-url";
import {
  LONG_LINK_TEXT,
  addressesShown,
  linkTextProblem,
  linkTextWarnings,
  showsAnotherAddress,
  toLinkInput,
  visibleLinkText,
} from "./link-text";

/*
 * Release 4 spec 3.2 (U2): what a link's words say against where it goes;
 * the Link form's warnings; and what the form makes of an address as typed.
 */

describe("linkTextProblem", () => {
  it("is empty for blank text", () => {
    for (const text of ["", "   ", "\t\n"]) expect(linkTextProblem(text, "https://example.org/")).toBe("empty");
  });

  it("accepts words that show no address", () => {
    expect(linkTextProblem("the guide", "https://example.org/guide")).toBeNull();
    expect(linkTextProblem("Bundeszentrale für politische Bildung", "https://www.bpb.de/")).toBeNull();
    expect(linkTextProblem("Write to us", "mailto:help@example.org")).toBeNull();
  });

  it("accepts text showing the same site, whatever the path", () => {
    expect(linkTextProblem("https://example.org", "https://example.org/x")).toBeNull();
    expect(linkTextProblem("see https://example.org/a for more", "https://example.org/b?c=1")).toBeNull();
    expect(linkTextProblem("HTTPS://EXAMPLE.ORG", "https://example.org/")).toBeNull();
    // http in the text, https in the link: the same site.
    expect(linkTextProblem("http://example.org", "https://example.org/")).toBeNull();
  });

  it("ignores one leading www. on either side", () => {
    expect(linkTextProblem("https://www.example.org", "https://example.org/x")).toBeNull();
    expect(linkTextProblem("https://example.org", "https://www.example.org/x")).toBeNull();
  });

  it("takes an international name and its punycode as the same site", () => {
    expect(linkTextProblem("https://bücher.example/katalog", "https://xn--bcher-kva.example/")).toBeNull();
    const href = checkLinkHref("https://ελληνικά.example/άρθρο");
    if (!href.ok) throw new Error("refused");
    expect(linkTextProblem("https://ελληνικά.example", href.href)).toBeNull();
  });

  it("refuses text showing another site", () => {
    expect(linkTextProblem("https://bank.example", "https://evil.example/")).toBe("misleading");
    expect(linkTextProblem("Log in at https://bank.example/login now", "https://evil.example/login")).toBe("misleading");
    // A subdomain is another site.
    expect(linkTextProblem("https://bank.example", "https://bank.example.evil.example/")).toBe("misleading");
    expect(linkTextProblem("https://login.bank.example", "https://bank.example/")).toBe("misleading");
  });

  it("refuses when any one of several addresses shown points elsewhere", () => {
    expect(linkTextProblem("https://example.org or https://evil.example", "https://example.org/")).toBe("misleading");
  });

  it("compares an email address shown with a web link by its domain", () => {
    expect(linkTextProblem("Kontakt: info@verein.de", "https://verein.de/kontakt")).toBeNull();
    expect(linkTextProblem("Kontakt: info@verein.de", "https://www.verein.de/kontakt")).toBeNull();
    expect(linkTextProblem("Kontakt: info@verein.de", "https://evil.example/")).toBe("misleading");
  });

  it("compares an email address shown with an email link by its mailbox", () => {
    expect(linkTextProblem("help@example.org", "mailto:help@example.org")).toBeNull();
    expect(linkTextProblem("HELP@Example.org", "mailto:help@example.org?subject=Hi")).toBeNull();
    expect(linkTextProblem("help@example.org", "mailto:someone@example.org")).toBe("misleading");
    expect(linkTextProblem("mailto:help@example.org", "mailto:help@example.org")).toBeNull();
  });

  it("compares a web address shown with an email link by its site", () => {
    expect(linkTextProblem("https://example.org", "mailto:help@example.org")).toBeNull();
    expect(linkTextProblem("https://bank.example", "mailto:help@evil.example")).toBe("misleading");
  });

  it("counts every address shown as elsewhere when the link is no web or email address", () => {
    expect(linkTextProblem("https://example.org", "javascript:alert(1)")).toBe("misleading");
    expect(linkTextProblem("the guide", "javascript:alert(1)")).toBeNull();
  });

  // D104: what the text shows is what learners read. Characters that show
  // nothing, and compatibility forms, are read as learners see them.
  const EVIL = "https://evil.example/login";
  const INVISIBLE = ["\u200B", "\u200C", "\u200D", "\u200E", "\u200F", "\u2060", "\u2062", "\u180E", "\u3164", "\uFFA0", "\u115F", "\u00AD", "\u034F"];

  it("reads an address through characters that show nothing", () => {
    for (const mark of INVISIBLE) {
      for (const text of [`https://bank${mark}.example/login`, `https:${mark}//bank.example/login`, `https://bank.${mark}example`]) {
        expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
        expect(linkTextProblem(text, "https://bank.example/login"), JSON.stringify(text)).toBeNull();
      }
    }
  });

  it("reads compatibility forms as the characters they show", () => {
    // ONE DOT LEADER, fullwidth letters and full stops, a circled letter.
    for (const text of [
      "https://bank.example\u2024login",
      "\uFF48\uFF54\uFF54\uFF50\uFF53\uFF1A\uFF0F\uFF0F\uFF42\uFF41\uFF4E\uFF4B\uFF0E\uFF45\uFF58\uFF41\uFF4D\uFF50\uFF4C\uFF45",
      "https://\u24D1ank.example",
    ]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
  });

  it("reads an address that couldn't be a link itself: a user name, an Outlook safe link, no slashes, over 2,048 characters", () => {
    expect(linkTextProblem("https://login@bank.example/", EVIL)).toBe("misleading");
    // A user name shows a host the link can't open, whatever the link.
    expect(linkTextProblem("https://login@bank.example/", "https://bank.example/")).toBe("misleading");
    expect(linkTextProblem("https://bank.example@evil.example/", EVIL)).toBe("misleading");
    const safe = "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org%2Fguide&data=05%7Csomeone%40example.org";
    expect(linkTextProblem(safe, "https://example.org/guide")).toBe("misleading");
    expect(linkTextProblem("https:bank.example/login", EVIL)).toBe("misleading");
    expect(linkTextProblem(`https://bank.example/${"a".repeat(2_100)}`, EVIL)).toBe("misleading");
    expect(linkTextProblem("xhttps://bank.example", EVIL)).toBe("misleading");
    expect(linkTextProblem("mailto:help@bank.example?cc=boss@bank.example", "mailto:help@evil.example")).toBe("misleading");
  });

  it("still accepts text that shows the link's own place, or no address", () => {
    expect(linkTextProblem("the\u200Bguide", EVIL)).toBeNull();
    expect(linkTextProblem("https://example.org/\u200B", "https://example.org/x")).toBeNull();
    expect(linkTextProblem("https://example.org/guide.", "https://example.org/guide")).toBeNull();
    expect(linkTextProblem("Use https:// addresses", EVIL)).toBeNull();
    expect(linkTextProblem("Kontakt: info@verein.de", "https://verein.de/")).toBeNull();
  });

  it("is empty for text that shows nothing", () => {
    for (const text of ["\u200B", " \u2060 ", "\u3164\u3164", "\u00AD"]) {
      expect(linkTextProblem(text, "https://example.org/"), JSON.stringify(text)).toBe("empty");
      expect(visibleLinkText(text).trim(), JSON.stringify(text)).toBe("");
    }
    expect(visibleLinkText("the\u200Bguide")).toBe("theguide");
  });

  it("reads the addresses a text shows once, for as many links as need comparing", () => {
    const shown = addressesShown("https://example.org and help@example.org");
    expect(showsAnotherAddress(shown, "https://example.org/a")).toBe(false);
    expect(showsAnotherAddress(shown, "mailto:help@example.org")).toBe(false);
    expect(showsAnotherAddress(shown, "mailto:other@example.org")).toBe(true);
    expect(showsAnotherAddress(shown, "https://evil.example/")).toBe(true);
    expect(addressesShown("the guide")).toBeNull();
    expect(showsAnotherAddress(null, "https://evil.example/")).toBe(false);
  });
});

describe("linkTextWarnings", () => {
  it("warns about words that don't say where the link goes, in English, German and Greek", () => {
    for (const text of [
      "click here",
      "Click Here",
      "here",
      "Read more…",
      "learn more",
      "this link",
      "hier",
      "Hier!",
      "klicken Sie hier",
      "Klick hier.",
      "mehr erfahren",
      "Weiterlesen",
      "Link",
      "dieser Link",
      "εδώ",
      "ΕΔΩ",
      "Εδώ;",
      "κλικ εδώ",
      "πατήστε εδώ",
      "πάτα εδώ",
      "κάντε κλικ εδώ",
      "περισσότερα",
      "Διαβάστε περισσότερα",
      "  more  ",
    ]) {
      expect(linkTextWarnings(text), text).toEqual(["vague"]);
    }
  });

  it("doesn't warn about words that do", () => {
    for (const text of ["the guide", "here is the guide", "Handbuch hier", "ο οδηγός", "more about funding", ""]) {
      expect(linkTextWarnings(text), text).toEqual([]);
    }
  });

  it("warns about text over 100 characters", () => {
    expect(linkTextWarnings("a".repeat(LONG_LINK_TEXT))).toEqual([]);
    expect(linkTextWarnings("a".repeat(LONG_LINK_TEXT + 1))).toEqual(["long"]);
  });

  it("reads long punctuation-only text quickly", () => {
    const started = performance.now();
    expect(linkTextWarnings(`${"!".repeat(10_000)}x${" !".repeat(10_000)}`)).toEqual(["long"]);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("toLinkInput", () => {
  it("gives a bare email address mailto:", () => {
    expect(toLinkInput("help@verein.de")).toBe("mailto:help@verein.de");
    expect(toLinkInput("  help@verein.de ")).toBe("mailto:help@verein.de");
  });

  it("gives a bare host https://", () => {
    expect(toLinkInput("www.bpb.de")).toBe("https://www.bpb.de");
    expect(toLinkInput("bpb.de/themen/x?y=1#z")).toBe("https://bpb.de/themen/x?y=1#z");
    expect(toLinkInput("example.org:8080/x")).toBe("https://example.org:8080/x");
    expect(toLinkInput("bücher.example")).toBe("https://bücher.example");
  });

  it("leaves addresses with a scheme, and anything else, as typed (trimmed)", () => {
    expect(toLinkInput("https://example.org/x")).toBe("https://example.org/x");
    expect(toLinkInput(" mailto:help@example.org ")).toBe("mailto:help@example.org");
    expect(toLinkInput("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(toLinkInput("localhost")).toBe("localhost");
    expect(toLinkInput("the guide")).toBe("the guide");
    expect(toLinkInput("//example.org")).toBe("//example.org");
    expect(toLinkInput("")).toBe("");
  });

  it("unwraps an Outlook safe link whose target passes the check", () => {
    const wrapped =
      "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.bpb.de%2Fthemen%3Fa%3D1&data=05%7C01%7Csomeone%40example.org&reserved=0";
    expect(toLinkInput(wrapped)).toBe("https://www.bpb.de/themen?a=1");
    // Typed without its scheme, too.
    expect(toLinkInput(wrapped.slice("https://".length))).toBe("https://www.bpb.de/themen?a=1");
  });

  it("leaves a safe link whose target fails as typed, for the check to refuse", () => {
    for (const target of ["javascript%3Aalert(1)", "file%3A%2F%2F%2FC%3A%2Fx", ""]) {
      const wrapped = `https://eur01.safelinks.protection.outlook.com/?url=${target}&data=someone%40example.org`;
      expect(toLinkInput(wrapped)).toBe(wrapped);
      expect(checkLinkHref(toLinkInput(wrapped))).toEqual({ ok: false, reason: "redirect" });
    }
    // A safe link inside a safe link is still one.
    const inner = "https://eur02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org";
    const outer = `https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent(inner)}`;
    expect(checkLinkHref(toLinkInput(outer))).toEqual({ ok: false, reason: "redirect" });
  });

  it("unwraps a Google redirect whose target passes the check", () => {
    expect(toLinkInput("https://www.google.com/url?q=https://example.org/guide&sa=D&source=docs")).toBe(
      "https://example.org/guide"
    );
    expect(toLinkInput("https://www.google.com/url?q=https%3A%2F%2Fexample.org%2Fa%3Fb%3D1&sa=D")).toBe(
      "https://example.org/a?b=1"
    );
    // A target that fails: the redirect itself stays (an ordinary link to Google).
    expect(toLinkInput("https://www.google.com/url?q=javascript:alert(1)")).toBe("https://www.google.com/url?q=javascript:alert(1)");
    // Not the redirect: Google's search stays as it is.
    expect(toLinkInput("https://www.google.com/search?q=https://example.org")).toBe(
      "https://www.google.com/search?q=https://example.org"
    );
  });
});
