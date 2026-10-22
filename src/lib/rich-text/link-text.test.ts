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
    // A name of another site in front of the link's site is that site, shown.
    expect(linkTextProblem("https://bank.example", "https://bank.example.evil.example/")).toBe("misleading");
    expect(linkTextProblem("https://bank.example.evil.example", "https://evil.example/")).toBe("misleading");
  });

  // D104 (owner decision, 22 October 2026): a site is a registrable domain,
  // by the ICANN section of the Public Suffix List: the public suffix a
  // host ends in ("org", "co.uk", "gov.gr") and one label more.
  it("takes every host of one registrable domain as one site", () => {
    for (const [text, href] of [
      ["europa.eu", "https://ec.europa.eu/info/index_en"],
      ["europa.eu", "https://commission.europa.eu/"],
      ["Wikipedia.org", "https://en.wikipedia.org/wiki/Social_enterprise"],
      ["github.com", "https://docs.github.com/en"],
      ["https://login.bank.example", "https://bank.example/"],
      ["https://bank.example/login", "https://login.bank.example/"],
      ["bbc.co.uk", "https://www.bbc.co.uk/news"],
      ["news.bbc.co.uk", "https://bbc.co.uk/"],
      ["www.minedu.gov.gr", "https://minedu.gov.gr/"],
      ["ucy.ac.cy", "https://www.ucy.ac.cy/el/"],
      ["Kontakt: info@mail.verein.de", "https://verein.de/kontakt"],
      ["help.verein.de", "mailto:info@verein.de"],
      // The text shows exactly the host the link opens.
      ["paypal.com.evil.example", "https://paypal.com.evil.example/login"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
  });

  it("refuses a host of another registrable domain, and a name of another site in front of the link's", () => {
    for (const [text, href] of [
      ["paypal.com.evil.example", "https://evil.example/"],
      ["https://paypal.com.evil.example/login", "https://evil.example/login"],
      ["www.paypal.com.evil.example", "https://evil.example/"],
      ["Write to help@paypal.com.evil.example", "https://evil.example/"],
      ["x.com", "https://evil.example/"],
      ["X.com", "https://evil.example/"],
      ["t.co", "https://evil.example/"],
      ["bank.co.uk", "https://evil.co.uk/"],
      ["bank.com.au", "https://evil.com.au/"],
      ["bank.com.gr", "https://evil.com.gr/"],
      ["bank.com.cy", "https://evil.com.cy/"],
      // A public suffix is no one's site.
      ["gov.gr", "https://minedu.gov.gr/"],
      ["co.uk", "https://bbc.co.uk/"],
      // Under a top-level domain whose rules aren't all listed (Italy,
      // Japan, Norway, Poland, the United States), a host is its own site.
      ["milano.it", "https://comune.milano.it/"],
      ["news.bank.co.jp", "https://bank.co.jp/"],
      ["bank.co.jp", "https://evil.co.jp/"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBe("misleading");
    }
    expect(linkTextProblem("comune.milano.it", "https://www.comune.milano.it/")).toBeNull();
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

  // D104 (owner decision, 22 October 2026): a bare host shown in the text,
  // with or without "www." and a path, is an address of that site, compared
  // with the link exactly as a full address is.
  it("reads a bare host as an address of its site", () => {
    for (const text of [
      "www.bank.example",
      "WWW.BANK.EXAMPLE",
      "www.bank.example/login",
      "bank.example/login",
      "bank.example",
      "Log in at bank.example.",
      "Log in at www.bank.example today",
      "(bank.example)",
      "„bank.example“",
      "bank.example:8443/login",
      "Bank.Example/Login",
      "Visit PayPal.com",
      "paypal.com/signin?return=1",
      "login.bank.example",
      "τράπεζα.ελ",
      "ΤΡΑΠΕΖΑ.ΕΛ/σύνδεση",
      "Website:bank.example",
      "wait...bank.example",
      "192.168.0.1/login",
      "bank.example/login, then evil.example",
      // Read as learners see it: characters that show nothing, compatibility forms.
      "bank\u200B.example/login",
      "www.\u2060bank.example",
      "bank\uFF0Eexample/login",
      "bank\u3002example/login",
      "bank\uFF61example",
      "\uFF57\uFF57\uFF57.bank.example",
    ]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
    // Against an email link, a bare host of another site points elsewhere too.
    expect(linkTextProblem("www.bank.example", "mailto:help@evil.example")).toBe("misleading");
    expect(linkTextProblem("Kontakt: verein.de", "mailto:info@evil.example")).toBe("misleading");
    // And against a link that is no web or email address.
    expect(linkTextProblem("bank.example", "javascript:alert(1)")).toBe("misleading");
  });

  it("accepts a bare host of the link's own site", () => {
    expect(linkTextProblem("www.example.org", "https://example.org/x")).toBeNull();
    expect(linkTextProblem("example.org/guide", "https://www.example.org/guide")).toBeNull();
    expect(linkTextProblem("Mehr unter www.bpb.de", "https://www.bpb.de/themen")).toBeNull();
    expect(linkTextProblem("Booking.com", "https://www.booking.com/")).toBeNull();
    expect(linkTextProblem("bücher.example/katalog", "https://xn--bcher-kva.example/")).toBeNull();
    expect(linkTextProblem("Kontakt: verein.de", "mailto:info@verein.de")).toBeNull();
    expect(linkTextProblem("Kontakt: info@verein.de oder verein.de", "https://verein.de/kontakt")).toBeNull();
    // Look-alike letters in its top-level domain read as what they show.
    expect(linkTextProblem("paypal.соm", "https://paypal.com/")).toBeNull();
    expect(linkTextProblem("PAYPAL.СОМ", "https://www.paypal.com/")).toBeNull();
    // A name in an address's path, or after a host's path, is part of that address.
    expect(linkTextProblem("https://example.org/bank.example", "https://example.org/")).toBeNull();
    expect(linkTextProblem("example.org/files/bank.example", "https://example.org/")).toBeNull();
    expect(linkTextProblem("example.org/?next=bank.example", "https://example.org/")).toBeNull();
    // An email address is read as that address, its domain not again as a host.
    expect(linkTextProblem("help@bank.example", "mailto:help@bank.example")).toBeNull();
  });

  it("doesn't read an ordinary word with a dot as a host", () => {
    for (const text of [
      // Versions, numbers and dates.
      "v1.2",
      "Version v1.2 of the guide",
      "Web 2.0",
      "3.5 hours",
      "22.10.2026",
      "1.000 Euro",
      // Abbreviations, in English, German and Greek.
      "e.g. the guide",
      "i.e.",
      "etc.",
      "U.S.",
      "Ph.D.",
      "a.m.",
      "Fig. 2",
      "z.B.",
      "z. B.",
      "d.h.",
      "u.a.",
      "π.χ.",
      "κ.λπ.",
      // Sentence ends, and an ellipsis.
      "Read the guide.",
      "Read the guide. Then practise.",
      "the end.",
      "wait...then",
      // Names and files that end in no top-level domain.
      "Node.js",
      "report.pdf",
      "the slides (guide.pptx)",
      // A name inside a path, or a word.
      "docs/report.de",
      "my_site.de",
      "www",
    ]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBeNull();
    }
  });

  it("reads a top-level domain written with look-alike letters as the one it shows", () => {
    for (const text of [
      "paypal.соm", // Cyrillic с and о
      "PAYPAL.СОМ", // Cyrillic С, О and М
      "paypal.cοm", // Greek ο
      "paypal.ϲom", // Greek lunate sigma
      "Paypal.Сом",
      "Log in at paypal.соm today.",
      "www.paypal.соm",
      "bank.ехаmрlе", // Cyrillic е, х, а, р
    ]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
    // A top-level domain of another script is read as it is: "ευ" is the
    // Greek one of the European Union's, not "eu".
    expect(linkTextProblem("europa.ευ", "https://europa.eu/")).toBe("misleading");
    expect(linkTextProblem("τράπεζα.ελ", "https://xn--hxakle2ceu.xn--qxam/")).toBeNull();
    // Words of Cyrillic or Greek that end in no top-level domain stay words.
    for (const text of ["т.е.", "и т.д.", "см. выше", "π.χ.", "κ.λπ.", "Α.Ε.", "Ι.Κ.Ε.", "σελ.10", "г.Москва"]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBeNull();
    }
  });

  it("reads a host wrapped in _ or ~ for emphasis", () => {
    for (const text of ["_paypal.com_", "Log in at _www.paypal.com_", "~paypal.com~", "__paypal.com__", "*_paypal.com_*", "(_paypal.com_)"]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
    // Inside a path or a word, a name still belongs to it.
    for (const text of ["docs/report.de", "my_site.de", "a~bank.example", "files_v2_bank.example"]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBeNull();
    }
  });

  it("doesn't read an abbreviation as a host, and still reads a host in capitals", () => {
    const UNI = "https://uni.example/msc";
    for (const text of [
      "M.Sc.",
      "B.Sc.",
      "M.Sc. programme",
      "M.Sc. Sustainable Entrepreneurship – programme page",
      "B.Com.",
      "M.Com.",
      "B.Tech.",
      "M.Tech.",
      "M.St.",
      "B.Sc/M.Sc",
      "Dipl.Ing.",
      "Dr.med.",
      "Dr.med.vet.",
      "Mag.art.",
      "Univ.Prof.",
      "Hon.Prof.",
      "o.Univ.Prof.",
      "ao.Univ.Prof.",
      "Ass.Prof.",
      "Prof.Dr.",
      "Dott.ssa",
      "Müller GmbH & Co.KG",
      "Samsung Co.Ltd.",
      "z.B.",
      "u.a.",
      "d.h.",
      "ggf.",
      "bzw.",
      "i.d.R.",
      "Dr.-Ing.",
      "Dipl.-Ing.",
      "π.χ.",
      "δηλ.",
    ]) {
      expect(linkTextProblem(text, UNI), JSON.stringify(text)).toBeNull();
    }
    for (const text of ["x.com", "X.com", "t.co", "Paypal.com", "PAYPAL.COM", "PayPal.COM", "www.Bank.example", "Booking.com", "Bank.Example/Login"]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
  });

  it("reads a file's name that ends in a top-level domain as a host (it fails safe)", () => {
    for (const text of ["course-materials.zip", "intro.mov", "README.md", "setup.py"]) {
      expect(linkTextProblem(text, "https://example.org/files/x"), text).toBe("misleading");
    }
    for (const text of ["report.pdf", "slides.pptx", "data.csv"]) {
      expect(linkTextProblem(text, "https://example.org/files/x"), text).toBeNull();
    }
  });

  it("tells when every address a text shows is a name read by the top-level domain it ends in", () => {
    for (const text of ["course-materials.zip", "intro.mov", "paypal.com", "paypal.соm", "_paypal.com_", "see paypal.com and bank.example"]) {
      expect(addressesShown(text)?.namesOnly, text).toBe(true);
    }
    for (const text of ["https://bank.example", "www.bank.example", "bank.example/login", "bank.example:8443", "help@bank.example", "paypal.com or https://bank.example"]) {
      expect(addressesShown(text)?.namesOnly, text).toBe(false);
    }
  });

  // §3.2: one leading "www." is removed before a host's site is told, so a
  // public suffix's own site (gov.uk, gov.gr) and its www. host are one.
  it("takes a host and its www. host as one site, a public suffix's own site too", () => {
    for (const [text, href] of [
      ["GOV.UK", "https://www.gov.uk/guidance/x"],
      ["gov.gr", "https://www.gov.gr/"],
      ["gov.ie", "https://www.gov.ie/"],
      ["gov.cy", "https://www.gov.cy/"],
      ["gv.at", "https://www.gv.at/"],
      ["https://gov.uk/guidance/x", "https://www.gov.uk/guidance/x"],
      ["gov.uk/guidance/x", "https://www.gov.uk/guidance/x"],
      ["www.gov.uk", "https://gov.uk/x"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
    for (const [text, href] of [
      ["gov.uk", "https://evil.gov.uk/"],
      ["www.gov.uk", "https://evil.gov.uk/"],
      ["https://www.gov.gr", "https://minedu.gov.gr/"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBe("misleading");
    }
  });

  it("reads a host after two slashes, after a slash at a word's start, and after a colon that starts no port", () => {
    for (const text of [
      "//paypal.com",
      "//www.paypal.com",
      "ftp://paypal.com",
      "https꞉//paypal.com", // a modifier letter colon
      "https∶//paypal.com", // a ratio sign
      "https//paypal.com",
      "hxxps://paypal.com",
      "Login: /paypal.com",
      "evil.example:paypal.com",
    ]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
    expect(linkTextProblem("//paypal.com", "https://www.paypal.com/")).toBeNull();
    // Inside a path, a name still belongs to it.
    for (const text of ["docs/report.de", "files/v2/report.de"]) expect(linkTextProblem(text, EVIL), text).toBeNull();
  });

  it("ends a host where a raised or lowered character, a modifier letter or a mark of its own follows it", () => {
    for (const text of [
      "paypal.com¹",
      "paypal.com²",
      "PayPal.com™",
      "paypal.comʼs login", // a modifier letter apostrophe
      "paypal.comˈs",
      "paypal.com̲", // a combining low line, unseen under a link's underline
      "paypal.co̲m",
      "paypal.com₂",
    ]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
    expect(linkTextProblem("senic.org¹", "https://senic.org/")).toBeNull();
    expect(linkTextProblem("PayPal.com™", "https://www.paypal.com/")).toBeNull();
    // A footnote's mark, or a word with one, shows no address.
    for (const text of ["¹", "the guide²", "Acme™"]) expect(linkTextProblem(text, EVIL), text).toBeNull();
  });

  it("reads a host through a hair space, which shows nothing", () => {
    for (const text of ["paypal .com", "paypal.c om", "https://bank .example"]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
    expect(linkTextProblem(" ", EVIL)).toBe("empty");
    // A narrow or a thin space shows: "z. B." stays an abbreviation.
    for (const text of ["z. B.", "z. B.", "d. h."]) expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBeNull();
  });

  it("reads Co. before a public suffix as part of a host, and a title only at a name's start", () => {
    for (const text of ["Amazon.Co.UK", "Barclays.Co.UK", "Paypal.Co.Uk", "mail.Co.UK", "Co.UK", "paypal.Co.UK.evil.example"]) {
      expect(linkTextProblem(text, EVIL), text).toBe("misleading");
    }
    for (const [text, href] of [
      ["Müller GmbH & Co.KG", "https://mueller.example/"],
      ["Samsung Co.Ltd.", "https://samsung.example/"],
      ["Ao.Univ.Prof.", "https://uni.example/"],
      ["a.o.Univ.Prof.", "https://uni.example/"],
    ]) {
      expect(linkTextProblem(text, href), text).toBeNull();
    }
  });

  it("reads a name of another site in front of the link's, a hyphen after its top-level domain", () => {
    for (const text of ["paypal.com-login.evil.example", "paypal.com-secure.login.evil.example", "https://paypal.com-login.evil.example/login"]) {
      expect(linkTextProblem(text, EVIL), text).toBe("misleading");
    }
    expect(linkTextProblem("paypal.com-login.evil.example", "https://paypal.com-login.evil.example/")).toBeNull();
  });

  it("reads look-alike letters in every label of a name written in Latin letters, or in look-alikes only", () => {
    for (const [text, href] of [
      ["pаypal.com", "https://xn--pypal-4ve.com/"], // Cyrillic а
      ["https://pаypal.com/login", "https://xn--pypal-4ve.com/login"],
      ["аррӏе.com", "https://xn--80ak6aa92e.com/"], // аррӏе
      ["аррӏе.сом", EVIL], // аррӏе.сом, Cyrillic only
      ["paypal.соm.evil.example", EVIL],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBe("misleading");
    }
    const own = (address: string) => {
      const check = checkLinkHref(address);
      if (!check.ok) throw new Error("refused");
      return check.href;
    };
    for (const [text, href] of [
      ["bücher.de", "https://xn--bcher-kva.de/"],
      ["сбербанк.рф", own("https://сбербанк.рф/")],
      ["кот.укр", own("https://кот.укр/")],
      ["pаypal.com", "https://paypal.com/"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
  });

  // The owner's rule awaited (link-rules check, item 8): until then, an email
  // address's first part is read as a host over a web link when it starts
  // with "www." or ends in a country's or a generic top-level domain (com,
  // net, org, edu, gov, mil, int, info, biz); a surname such as "schmidt" or
  // "kim", which are top-level domains too, isn't one.
  it("reads an email address's first part as a host over a web link when it starts with www. or ends in a country's or a generic top-level domain", () => {
    for (const text of ["paypal.com@evil.example", "www.paypal.com@evil.example", "Write to sparkasse.de@evil.example"]) {
      expect(linkTextProblem(text, EVIL), text).toBe("misleading");
    }
    for (const [text, href] of [
      ["anna.schmidt@uni.example", "https://uni.example/"],
      ["anna.kim@uni.example", "https://uni.example/people"],
      ["paypal.com@evil.example", "mailto:paypal.com@evil.example"],
      ["Kontakt: info@verein.de", "https://verein.de/kontakt"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
  });

  it("doesn't read Greek words as look-alike top-level domains", () => {
    for (const text of ["…στην Αθήνα.Το", "προσπάθεια.να", "ΑΘΗΝΑ.ΤΟ", "Αθήνα.ΝΑ", "ΚΑΙ.ΤΟ", "και.να"]) {
      expect(linkTextProblem(text, EVIL), text).toBeNull();
    }
    for (const text of ["paypal.соm", "PAYPAL.СОМ", "paypal.cοm"]) {
      expect(linkTextProblem(text, EVIL), text).toBe("misleading");
    }
  });

  it("doesn't read a title or a company form after short words as a host", () => {
    for (const text of ["apl.Prof. Dr. Weber", "Jun.Prof.", "em.Prof.", "Asst.Prof.", "Adj.Prof.", "Pty.Ltd.", "Acme Pte.Ltd."]) {
      expect(linkTextProblem(text, "https://uni.example/"), text).toBeNull();
    }
    for (const text of ["paypal.prof", "Barclays.Ltd", "barclays.ltd", "www.Jun.Prof"]) {
      expect(linkTextProblem(text, EVIL), text).toBe("misleading");
    }
    // A sentence's end with no space before a word that is a top-level
    // domain reads as a host (§12, fails safe).
    expect(linkTextProblem("…in Brussels.It", "https://uni.example/")).toBe("misleading");
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
