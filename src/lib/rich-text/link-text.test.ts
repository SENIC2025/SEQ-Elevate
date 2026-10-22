import { describe, it, expect } from "vitest";
import { checkLinkHref } from "./link-url";
import {
  LONG_LINK_TEXT,
  type LinkTextProblem,
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
      // An address of a public suffix's own host is that host.
      ["https://www.gov.gr", "https://minedu.gov.gr/"],
      ["gov.uk/guidance", "https://evil.gov.uk/"],
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

  // A public suffix of more than one label, named by itself ("gov.gr",
  // "GOV.UK": the name of a state's digital services), is no one host: it
  // shows every site under it. An address of its own host is that host.
  it("takes a public suffix named by itself as every site under it", () => {
    for (const [text, href] of [
      ["Gov.gr Wallet", "https://wallet.gov.gr/"],
      ["Υπεύθυνη Δήλωση μέσω gov.gr", "https://dilosi.services.gov.gr/"],
      ["Εξουσιοδότηση στο gov.gr", "https://dilosi.services.gov.gr/"],
      ["myKEPlive (gov.gr)", "https://mykeplive.gov.gr/"],
      ["gov.cy", "https://cyprus.gov.cy/"],
      ["GOV.UK guidance (PDF)", "https://assets.publishing.service.gov.uk/media/abc/guidance.pdf"],
      ["Find a course on GOV.UK", "https://nationalcareers.service.gov.uk/find-a-course"],
      ["GOV.UK One Login", "https://signin.account.gov.uk/"],
      ["Apprenticeships – GOV.UK", "https://www.apprenticeships.gov.uk/"],
      ["gov.gr", "mailto:info@minedu.gov.gr"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
    for (const [text, href] of [
      ["gov.gr", "https://evil.example/"],
      ["gov.gr", "https://gov.gr.evil.example/"],
      ["Co.UK", "https://evil.example/"],
      ["https://www.gov.gr", "https://minedu.gov.gr/"],
      ["www.gov.uk", "https://evil.gov.uk/"],
      ["gov.gr and paypal.com", "https://minedu.gov.gr/"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBe("misleading");
    }
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
  /** `n` different CJK ideographs: a label of them is international, and of more than 63 longer than DNS allows. */
  const ideographsOf = (n: number) => Array.from({ length: n }, (_, i) => String.fromCodePoint(0x4e00 + i)).join("");
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
    // A title and its feminine ending, as Austrian usage writes them, raised or not.
    const SCHOOL = "https://www.schule.example.at/team";
    for (const text of [
      "Dir.in Mag.a Huber",
      "Bgm.in Maria Muster",
      "Doz.in Muster",
      "StR.in",
      "Dir.ⁱⁿ Mag.ª Huber",
      "Bgm.ⁱⁿ Maria Muster",
      "Vzbgm.ⁱⁿ Muster",
      "OStR.ⁱⁿ Mag.ª Huber",
      "DDr.ⁱⁿ Muster",
      "HR.ⁱⁿ Dr.ⁱⁿ Muster",
      "BEd.ⁱⁿ Muster",
      "GR.ⁱⁿ",
      "LAbg.ⁱⁿ",
      "Abg.ⁱⁿ z. NR Muster",
    ]) {
      expect(linkTextProblem(text, SCHOOL), JSON.stringify(text)).toBeNull();
    }
    expect(linkTextProblem("E-Mail an Dir.ⁱⁿ Huber", "mailto:direktion@schule.example.at")).toBeNull();
    for (const text of ["Amazon.in", "paypal.in", "dir.in", "Dir.example.com/login", "HR.com", "GR.de", "Prim.com", "Doz.at/login"]) {
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
      ["gov.uk/guidance", "https://evil.gov.uk/"],
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

  it("reads a raised, lowered or circled letter inside a name as the letter it shows", () => {
    for (const text of [
      "paypal.cᵒm",
      "www.paypal.cᵒm",
      "paypal.cᵒm/login",
      "paypal.ᶜᵒᵐ",
      "paypal.ⓒⓞⓜ",
      "ⓟⓐⓨⓟⓐⓛ.ⓒⓞⓜ",
      // Where a name may go on after it, it is read both ways.
      "paypal.com¹.evil.example",
    ]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
    expect(linkTextProblem("paypal.cᵒm", "https://www.paypal.com/")).toBeNull();
    expect(linkTextProblem("www.senic.org¹", "https://senic.org/")).toBeNull();
    // Inside a name, a raised digit or a sign of letters is read as nothing too.
    for (const text of ["PayPal™.com", "paypal¹.com", "™paypal.com"]) expect(linkTextProblem(text, EVIL), text).toBe("misleading");
    for (const [text, href] of [
      ["paypal¹.com", "https://www.paypal.com/"],
      ["¹paypal.com", "https://www.paypal.com/"],
      ["Moodle™.org", "https://moodle.org/"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
    for (const text of ["CO₂-Bilanz", "H₂O", "10 m²", "№ 5", "Mag.ª Huber"]) expect(linkTextProblem(text, EVIL), text).toBeNull();
  });

  it("reads a Roman numeral letter as the letter it shows", () => {
    for (const text of [
      "paypal.ⅽom",
      "https://paypal.ⅽom",
      "paypal.ⅽom/login",
      "Sign in at paypal.ⅽom to confirm",
      "paypaⅼ.com",
      "https://paypaⅼ.com/signin",
      "sparkasse.ⅾe",
      "paypal.ⅽom.evil.example",
      "https://paypal.ⅽom@evil.example",
      "support@paypal.ⅽom",
    ]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
    expect(linkTextProblem("support@paypal.ⅽom", "mailto:support@evil.example")).toBe("misleading");
    expect(linkTextProblem("paypal.ⅽom", "https://www.paypal.com/")).toBeNull();
    // As a name's last letter too (ⅼ U+217C, ⅰ U+2170, ⅴ U+2174, Ⅼ U+216C), and a raised letter so.
    for (const text of [
      "example.nⅼ",
      "example.nⅼ/login",
      "www.example.nⅼ",
      "example.nⅼ:443",
      "example.aⅰ",
      "example.goⅴ",
      "EXAMPLE.NⅬ",
      "rabobank.nⅼ",
      "rabobank.nⅼ/login",
      "www.rabobank.nⅼ/login",
      "www.mbank.pⅼ",
      "rabobank.nⅼ:443",
      "(digid.nⅼ)",
      "Log in at irs.goⅴ to confirm",
      "RABOBANK.NⅬ",
      "paypal.cᵒᵐ",
      "sparkasse.dᵉ",
    ]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
    expect(linkTextProblem("info@example.nⅼ", "mailto:info@evil.example")).toBe("misleading");
    expect(linkTextProblem("rabobank.nⅼ", "https://www.rabobank.nl/")).toBeNull();
    expect(linkTextProblem("senic.org¹", "https://senic.org/")).toBeNull();
    for (const text of ["Ludwig Ⅻ.", "Kapitel Ⅲ.2", "Teil Ⅱ", "Louis.ⅩⅣ", "Mag.ª Huber"]) expect(linkTextProblem(text, EVIL), text).toBeNull();
  });

  it("drops a mark that follows no letter or digit, at a name's start or a label's", () => {
    for (const text of [
      "paypal.̲com",
      "www.paypal.̲com/login",
      "paypal.̣com",
      "paypal.́com",
      "paypal.̇com",
      "sparkasse.̲de/login",
      "paypal.̲com.evil.example",
      "̲paypal.com",
      "www.̲paypal.com",
      "̲paypal.com/login",
      "www.̲paypal.com/login",
      "Log in at ̲paypal.com",
      "support@paypal.̲com",
    ]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
    expect(linkTextProblem("paypal.̲com", "https://www.paypal.com/")).toBeNull();
    for (const text of ["naïve.", "café.", "e.g.", "Don´t", "̲"]) expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBeNull();
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

  it("a label that starts with a top-level domain and a hyphen shows that name", () => {
    for (const text of ["paypal.com-login", "PayPal.com-Login", "Log in at paypal.com-secure to confirm", "amazon.de-bestellung", "www.paypal.com-login/"]) {
      expect(linkTextProblem(text, EVIL), text).toBe("misleading");
    }
    expect(linkTextProblem("Booking.com-Konto", "https://www.booking.com/")).toBeNull();
    expect(linkTextProblem("ams.at-Jobbörse", "https://jobs.ams.at/")).toBeNull();
    for (const text of ["bzw.Online-Kurs", "1.IT-Sicherheit", "e.V.-Mitglied"]) expect(linkTextProblem(text, "https://uni.example/"), text).toBeNull();
  });

  // The URL parsers of the server (Node) and the browsers differ at the
  // edges: the same text gets the same answer in the editor and on the server.
  it("reads a name the URL parser refuses as written, when it ends in a top-level domain", () => {
    for (const text of ["xn--a.paypal.com", "Log in at xn--a.paypal.com", "https://xn--a.paypal.com/login", "Write to help@xn--a.paypal.com"]) {
      expect(linkTextProblem(text, EVIL), text).toBe("misleading");
    }
    expect(linkTextProblem("xn--a.paypal.com", "https://www.paypal.com/")).toBeNull();
    expect(linkTextProblem("xn--abc-.paypal.com", "https://www.paypal.com/")).toBeNull();
  });

  it("reads a character Unicode 16 doesn't assign (a newer browser may know it) as a space and as nothing", () => {
    // U+1AD0, a combining mark of Unicode 17; U+16FF4, a number letter of
    // Unicode 17; U+0378, unassigned.
    for (const text of ["paypal.᫐com", "paypal.co\u{16FF4}m", "paypal\u{16FF4}.com", "paypal.com\u{16FF4}", "pay͸pal.com", "https://paypal.co\u{16FF4}m/login"]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
    expect(linkTextProblem("paypal.com\u{16FF4}", "https://www.paypal.com/")).toBeNull();
    expect(linkTextProblem("Studie\u{16FF4}", EVIL)).toBeNull();
    expect(linkTextProblem("\u{16FF4}", EVIL)).toBeNull();
  });

  it("reads look-alike letters in every label of a name written in Latin letters, or in look-alikes only", () => {
    for (const [text, href] of [
      ["pаypal.com", "https://xn--pypal-4ve.com/"], // Cyrillic а
      ["https://pаypal.com/login", "https://xn--pypal-4ve.com/login"],
      ["аррӏе.com", "https://xn--80ak6aa92e.com/"], // аррӏе
      ["аррӏе.сом", EVIL], // аррӏе.сом, Cyrillic only
      ["paypal.соm.evil.example", EVIL],
      // Cyrillic г and п, which show as r and n.
      ...["micгosoft.com", "liпkedin.com", "dгopbox.com", "орепаі.com"].map((text) => [text, new URL(`https://${text}/`).href]),
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
    // A word in lower case after a title is an abbreviation's, whatever the
    // public suffixes hold ("dr.in" is one): the Austrian "Dr.in".
    for (const text of [
      "Dr.in Maria Huber",
      "Mag.a Dr.in Huber",
      "Univ.-Prof.in Dr.in Eva Berger",
      "Prof.in Dr.in Huber",
      "Dr.in med. Huber",
      "Vortrag von Dr.in Huber (PDF)",
    ]) {
      expect(linkTextProblem(text, "https://uni.example/x"), text).toBeNull();
    }
    for (const text of ["paypal.prof", "Barclays.Ltd", "barclays.ltd", "www.Jun.Prof"]) {
      expect(linkTextProblem(text, EVIL), text).toBe("misleading");
    }
    // A sentence's end with no space before a word that is a top-level
    // domain reads as a host (§12, fails safe).
    expect(linkTextProblem("…in Brussels.It", "https://uni.example/")).toBe("misleading");
  });

  // A label longer than DNS allows (RFC 1035; beyondDns in link-host.ts)
  // is no host's: such a name is read as the URL parser reads it, without
  // parsing its long label whole (which costs its length times the
  // characters it holds), the label standing for itself.
  it("reads a name with a label longer than DNS allows as the URL parser reads it", () => {
    const ideographs = ideographsOf(100);
    const greek = (n: number) => Array.from({ length: n }, (_, i) => "αβγδεζηθικλμνξοπρστυφχψω"[i % 24]).join("");
    const arabic = (n: number) => Array.from({ length: n }, (_, i) => String.fromCodePoint(0x628 + (i % 35))).join("");
    const rows: [string, string, LinkTextProblem | null][] = [
      [`${ideographs}.com`, EVIL, "misleading"],
      [`https://${ideographs}.com`, EVIL, "misleading"],
      [`https://user@${ideographs}.com`, EVIL, "misleading"],
      [`https://${ideographs}%41.com`, EVIL, "misleading"],
      [`www.${ideographs}.com`, EVIL, "misleading"],
      [`Kontakt: ${ideographs}.de/impressum`, EVIL, "misleading"],
      [`info@${ideographs}.com`, EVIL, "misleading"],
      [`${ideographs}@evil.example`, "mailto:info@evil.example", "misleading"],
      [`paypal.com@${ideographs}.evil.example`, EVIL, "misleading"],
      [`paypal.com.${ideographs}.evil.example`, EVIL, "misleading"],
      [`${ideographs}.evil.example`, EVIL, null],
      [`${ideographs}.bücher.example`, "https://bücher.example/", null],
      // Names the URL parser refuses, read as written: a punycode label of
      // other characters, an Arabic-Indic digit inside a Greek label, both
      // kinds of digits in an Arabic one.
      [`xn--${ideographs}.com`, EVIL, "misleading"],
      [`${greek(50)}\u0663${greek(50)}.com`, EVIL, "misleading"],
      [`${arabic(50)}\u0663${arabic(10)}1${arabic(40)}.evil.example`, EVIL, null],
    ];
    for (const [text, href, problem] of rows) expect(linkTextProblem(text, href), text.slice(0, 120)).toBe(problem);
  });

  it("reads a label longer than DNS allows in pieces, accepted or refused as the URL parser reads it whole", () => {
    // Seeded: labels of 64 to 160 letters of one script, with characters
    // that change how the parser checks a label (digits of either kind,
    // letters written right to left, a hyphen, "xn--") at its start, inside
    // or at its end. Each is shown as an address after a word, which only
    // the reading of "https:" addresses reads (no quick link).
    let seed = 20261022;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)];
    const between = (from: number, to: number) => String.fromCodePoint(from + Math.floor(random() * (to - from + 1)));
    const scripts = [
      () => between(0x4e00, 0x9fff),
      () => between(0xac00, 0xd7a3),
      () => between(0x5d0, 0x5ea),
      () => between(0x628, 0x63a),
      () => between(0xe01, 0xe2e),
      () => between(0x915, 0x939) + (random() < 0.3 ? "\u094D" : ""),
      () => between(0x3b1, 0x3c9),
      () => between(0x10d0, 0x10f0),
    ];
    const kinds = ["1", "-", "\u0663", "\u06F3", "\u05D0", "\u0628", "ß", "xn--", "a"];
    for (let i = 0; i < 300; i++) {
      const letter = pick(scripts);
      let label = Array.from({ length: 64 + Math.floor(random() * 96) }, letter).join("");
      for (let k = Math.floor(random() * 3); k > 0; k--) {
        const kind = pick(kinds);
        const at = pick([0, label.length, Math.floor(random() * label.length)]);
        label = label.slice(0, at) + kind + label.slice(at);
      }
      // As learners see it (in normal form), as the parser gives it, the
      // long label standing for itself; or, refused, as written.
      const host = `${label}.com`.normalize("NFKC");
      let parsed = true;
      try {
        new URL(`https://${host}`);
      } catch {
        parsed = false;
      }
      const expected = parsed ? `xn--${host.toLowerCase()}` : host.toLowerCase();
      expect(addressesShown(`Login:https://${host}`)?.web.map((place) => place.host), JSON.stringify(host)).toEqual([expected]);
    }
  });

  it("reads an address whose host is longer than DNS allows with ideographic full stops for its dots", () => {
    expect(linkTextProblem(`https://${ideographsOf(1_000)}\u3002com`, EVIL)).toBe("misleading");
    expect(linkTextProblem(`https://${ideographsOf(100)}\u3002evil\u3002example`, EVIL)).toBeNull();
  });

  // A text of up to 10,000 characters (a block's most) is read on every save
  // and every server render: what it costs grows with its length, never
  // with its square. Compared as eight texts of 1,250 characters against
  // one of 10,000, the same characters in all: about equal when the cost
  // grows with the length, eight times more when with its square.
  it.each([
    ["a title before thousands of labels", (n: number) => `Dr.${"de.".repeat(Math.floor((n - 5) / 3))}de`],
    ["a company form before thousands of labels", (n: number) => `${"Co.".repeat(Math.floor((n - 2) / 3))}UK`],
    ["an address of thousands of commas", (n: number) => `https://a${",".repeat(n - 10)}b`],
    ["an email address of thousands of commas", (n: number) => `mailto:a@b${",".repeat(n - 11)}c`],
    ["an address of thousands of dots", (n: number) => `https://a${".".repeat(n - 10)}b`],
    ["a name of thousands of hyphens", (n: number) => `a${"-".repeat(n - 2)}a`],
    ["thousands of characters Unicode 16 doesn't assign", (n: number) => "a.\u{16FF4}".repeat(Math.floor(n / 4))],
    ["thousands of names the URL parser refuses", (n: number) => "xn--a.com ".repeat(Math.floor(n / 10))],
  ])("reads %s in time proportional to its length", (_, make) => {
    const time = (texts: string[]) => {
      let best = Infinity;
      for (let k = 0; k < 3; k++) {
        const started = performance.now();
        for (const text of texts) linkTextProblem(text, EVIL);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    const short = Array.from({ length: 8 }, () => make(1_250));
    const long = [make(10_000)];
    time(short);
    expect(time(long) / time(short)).toBeLessThan(3);
  }, 30_000);

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
