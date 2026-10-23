import { describe, it, expect } from "vitest";
import { cpuRatio } from "./cpu-time.test-helpers";
import { checkLinkHref } from "./link-url";
import {
  COMMON_TOP_LEVEL_DOMAINS,
  LONG_LINK_TEXT,
  addressesShown,
  linkTextProblem,
  linkTextWarnings,
  showsAnotherAddress,
  toLinkInput,
  visibleLinkText,
} from "./link-text";
import { TOP_LEVEL_DOMAINS } from "./top-level-domains";

/*
 * Release 4 spec 3.2 (U2): what a link's words say against where it goes
 * (D104 as the owner narrowed it on 22 October 2026: learners see each
 * named link's site in a box after its words, link-site.ts, and the words
 * are refused only when they show, by their look, an address of another
 * site); the Link form's warnings; and what the form makes of an address
 * as typed. The honest writing and the refused phishing probes of the
 * link-rules checks are in link-text.corpus.test.ts.
 */

const EVIL = "https://evil-shop.de/login";

describe("linkTextProblem: what counts as showing an address", () => {
  it("is empty for blank text, or text of characters that show nothing", () => {
    for (const text of ["", "   ", "\t\n", "\u200B", " \u2060 ", "\u3164\u3164", "\u00AD", "\u200A", "\u0301"]) {
      expect(linkTextProblem(text, "https://example.org/"), JSON.stringify(text)).toBe("empty");
    }
  });

  it("accepts words that show no address", () => {
    for (const [text, href] of [
      ["the guide", "https://example.org/guide"],
      ["Bundeszentrale für politische Bildung", "https://www.bpb.de/"],
      ["Write to us", "mailto:help@example.org"],
      ["Use https:// addresses", EVIL],
      ["the\u200Bguide", EVIL],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
  });

  it("refuses a name after a scheme, or after two slashes at a word's start", () => {
    for (const text of [
      "https://meinebank.de",
      "Log in at https://meinebank.de/login now",
      "HTTPS://MEINEBANK.DE",
      "http://bank.example",
      "https:bank.example/login",
      "ftp://paypal.com",
      "hxxps://paypal.com",
      "xhttps://bank.example",
      "Website:bank.example",
      "evil-shop.de:paypal.com",
      "//paypal.com",
      "//www.paypal.com",
      "(//bank.example)",
      `https://bank.example/${"a".repeat(2_100)}`,
    ]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text.slice(0, 60))).toBe("misleading");
    }
  });

  it("refuses a www. name of three labels or more, in any letter case", () => {
    for (const text of ["www.bank.example", "WWW.BANK.EXAMPLE", "www.Bank.example", "Log in at www.bank.example today", "_www.paypal.com_"]) {
      expect(linkTextProblem(text, EVIL), text).toBe("misleading");
    }
  });

  it("refuses a name a path, a query, a fragment or a port follows", () => {
    for (const text of [
      "bank.example/login",
      "Bank.Example/Login",
      "bank.example?next=1",
      "bank.example#login",
      "bank.example:8443/login",
      "bank.example\\login",
      "192.168.0.1/login",
      "Dir.example.com/login",
      "ΤΡΑΠΕΖΑ.ΕΛ/σύνδεση",
      "bank.example/login, then evil.example",
    ]) {
      expect(linkTextProblem(text, EVIL), text).toBe("misleading");
    }
  });

  it("refuses a name of Latin letters ending in a common top-level domain in lower case", () => {
    for (const text of [
      "meinebank.de",
      "Visit PayPal.com",
      "Log in at meinebank.de.",
      "(meinebank.de)",
      "„meinebank.de“",
      "wait...meinebank.de",
      "login.meinebank.de",
      "x.com",
      "X.com",
      "HR.com",
      "GR.de",
      "bank.co.uk",
      "sparkasse.at",
      "_paypal.com_",
      "~paypal.com~",
      "*_paypal.com_*",
      "Login: /paypal.com",
      "https\uA789//paypal.com",
      "bücher.de",
    ]) {
      expect(linkTextProblem(text, EVIL), text).toBe("misleading");
    }
    // Over its own site, the same names show where the link goes.
    for (const [text, href] of [
      ["Booking.com", "https://www.booking.com/"],
      ["Mehr unter bpb.de", "https://www.bpb.de/themen"],
      ["bücher.de", "https://xn--bcher-kva.de/"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
  });

  it("reads a bare name only by a short list of common top-level domains, as hosts are written", () => {
    expect(COMMON_TOP_LEVEL_DOMAINS.size).toBe(46);
    for (const top of COMMON_TOP_LEVEL_DOMAINS) {
      expect(TOP_LEVEL_DOMAINS.has(top), top).toBe(true);
      expect(top).toMatch(/^[a-z]{2,4}$/);
    }
    for (const top of ["com", "org", "net", "edu", "gov", "eu", "de", "at", "gr", "cy", "uk", "io", "app"]) expect(COMMON_TOP_LEVEL_DOMAINS.has(top), top).toBe(true);
    // "script.pl" is a Perl script.
    expect(COMMON_TOP_LEVEL_DOMAINS.has("pl")).toBe(false);
  });

  it("refuses an email address of another site, or of another mailbox over an email link", () => {
    expect(linkTextProblem("Kontakt: info@verein.de", EVIL)).toBe("misleading");
    expect(linkTextProblem("Write to help@bank.example", EVIL)).toBe("misleading");
    expect(linkTextProblem("help@example.org", "mailto:someone@example.org")).toBe("misleading");
    expect(linkTextProblem("mailto:help@bank.example?cc=boss@bank.example", "mailto:help@evil.example")).toBe("misleading");
    for (const [text, href] of [
      ["Kontakt: info@verein.de", "https://verein.de/kontakt"],
      ["Kontakt: info@verein.de", "https://www.verein.de/kontakt"],
      ["Kontakt: info@mail.verein.de", "https://verein.de/kontakt"],
      ["anna.schmidt@uni.example", "https://uni.example/people"],
      ["help@example.org", "mailto:help@example.org"],
      ["HELP@Example.org", "mailto:help@example.org?subject=Hi"],
      ["mailto:help@example.org", "mailto:help@example.org"],
      ["kontakt@bücher.de", "mailto:kontakt@xn--bcher-kva.de"],
      // A first part longer than a short look back is read whole.
      ["weiterbildung.oesterreich.kontakt@ams.at", "mailto:weiterbildung.oesterreich.kontakt@ams.at"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
  });

  it("refuses a user name before a host after a scheme, whatever the link", () => {
    for (const [text, href] of [
      ["https://paypal.com@evil-shop.de", EVIL],
      ["https://paypal.com@evil-shop.de", "https://evil-shop.de/"],
      ["https://bank.example@evil.example/", "https://evil.example/"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBe("misleading");
    }
  });

  it("refuses a label that mixes Latin letters with Greek or Cyrillic ones, whatever the link", () => {
    for (const [text, href] of [
      ["paypal.соm", EVIL], // Cyrillic с and о
      ["paypal.cοm", EVIL], // Greek ο
      ["paypal.ϲom", EVIL], // Greek lunate sigma
      ["Log in at paypal.соm today.", EVIL],
      ["www.paypal.соm", EVIL],
      ["bank.ехаmрlе", EVIL],
      ["pаypal.com", "https://xn--pypal-4ve.com/"], // over its own punycode
      ["pаypal.com", "https://paypal.com/"],
      ["https://pаypal.com/login", "https://xn--pypal-4ve.com/login"],
      ["paypal.соm.evil-shop.de", EVIL],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBe("misleading");
    }
    // A name of one script reads as written.
    const own = (address: string) => {
      const check = checkLinkHref(address);
      if (!check.ok) throw new Error("refused");
      return check.href;
    };
    for (const [text, href] of [
      ["сбербанк.рф", own("https://сбербанк.рф/")],
      ["τράπεζα.ελ", own("https://τράπεζα.ελ/")],
      ["https://ελληνικά.example", own("https://ελληνικά.example/άρθρο")],
      ["https://bücher.example/katalog", "https://xn--bcher-kva.example/"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
  });

  it("counts every address shown as elsewhere when the link is no web or email address", () => {
    expect(linkTextProblem("https://example.org", "javascript:alert(1)")).toBe("misleading");
    expect(linkTextProblem("meinebank.de", "javascript:alert(1)")).toBe("misleading");
    expect(linkTextProblem("the guide", "javascript:alert(1)")).toBeNull();
  });
});

describe("linkTextProblem: text read as learners see it", () => {
  const INVISIBLE = ["\u200B", "\u200C", "\u200D", "\u200E", "\u200F", "\u2060", "\u2062", "\u180E", "\u3164", "\uFFA0", "\u115F", "\u00AD", "\u034F"];

  it("reads an address through characters that show nothing", () => {
    for (const mark of INVISIBLE) {
      for (const text of [`https://bank${mark}.example/login`, `https:${mark}//bank.example/login`, `https://bank.${mark}example`, `meinebank${mark}.de`]) {
        expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
      }
      expect(linkTextProblem(`https://bank${mark}.example/login`, "https://bank.example/login")).toBeNull();
    }
    expect(visibleLinkText("the\u200Bguide")).toBe("theguide");
  });

  it("drops a combining mark normal form leaves over", () => {
    for (const text of ["www.paypal.\u0332com/login", "paypal.co\u0332m", "\u0332paypal.com", "paypal.\u0323com", "support@paypal.\u0332com"]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
    expect(linkTextProblem("paypal.co\u0332m", "https://www.paypal.com/")).toBeNull();
    for (const text of ["naïve.", "café.", "e.g.", "Don´t"]) expect(linkTextProblem(text, EVIL), text).toBeNull();
  });

  it("reads the full stops the URL parser reads as dots as dots", () => {
    for (const text of ["meinebank\u3002de", "meinebank\uFF0Ede", "meinebank\uFF61de", "bank\u3002example/login", "https://paypal\uFF61com\uFF61evil-shop\uFF61de"]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
    expect(linkTextProblem("bpb\u3002de", "https://www.bpb.de/")).toBeNull();
  });

  it("reads compatibility forms once more as the characters they show", () => {
    for (const text of [
      "https://bank.example\u2024login", // a one dot leader
      "\uFF48\uFF54\uFF54\uFF50\uFF53\uFF1A\uFF0F\uFF0F\uFF42\uFF41\uFF4E\uFF4B\uFF0E\uFF45\uFF58\uFF41\uFF4D\uFF50\uFF4C\uFF45", // fullwidth
      "\uFF57\uFF57\uFF57.bank.example",
      "https://\u24D1ank.example", // a circled letter
      "paypal.\u217Dom", // Roman numerals
      "paypa\u217C.com",
      "https://paypal.\u217Dom@evil-shop.de",
      "support@paypal.\u217Dom",
      "rabobank.n\u217C",
      "www.mbank.p\u217C",
      "paypal.c\u1D52m", // raised letters
      "sparkasse.d\u1D49",
      "paypal.\u24D2\u24DE\u24DC",
    ]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBe("misleading");
    }
    expect(linkTextProblem("paypal.\u217Dom", "https://www.paypal.com/")).toBeNull();
    expect(linkTextProblem("rabobank.n\u217C", "https://www.rabobank.nl/")).toBeNull();
    for (const text of ["Ludwig \u216B.", "Kapitel \u2162.2", "Teil \u2161", "Louis.\u2169\u2163", "Mag.ª Huber", "Dir.\u2071\u207F Mag.ª Huber", "CO\u2082-Bilanz", "H\u2082O", "10 m²", "№ 5", "Studie¹", "the guide²", "Acme™"]) {
      expect(linkTextProblem(text, EVIL), text).toBeNull();
    }
  });

  it("reads a sign compatibility normalisation makes a word of as nothing (™, ℠, ℡)", () => {
    for (const [text, href] of [
      ["Moodle™.org", "https://moodle.org/"],
      ["PayPal.com™", "https://www.paypal.com/"],
      ["Acme™.com", "https://acme.com/"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
    for (const text of ["Moodle™.org", "PayPal™.com", "PayPal.com™", "PayPal℠.com"]) expect(linkTextProblem(text, EVIL), text).toBe("misleading");
  });
});

describe("linkTextProblem: not refused, the site box shows where the link goes", () => {
  it("accepts names in capitals, of other top-level domains, file names, titles and abbreviations", () => {
    const UNI = "https://uni.example/msc";
    for (const [text, href] of [
      ["ASP.NET Core", "https://learn.microsoft.com/aspnet/core"],
      ["VB.NET", "https://learn.microsoft.com/dotnet/visual-basic/"],
      ["Modul 3.IT", UNI],
      ["1.IT-Sicherheit", UNI],
      ["course-materials.zip", "https://example.org/files/x"],
      ["intro.mov", "https://example.org/files/x"],
      ["README.md", "https://github.com/example/project"],
      ["setup.py", "https://github.com/example/project"],
      ["report.pdf", "https://example.org/files/x"],
      ["Node.js", "https://nodejs.org/"],
      ["the slides (guide.pptx)", "https://example.org/files/x"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
    for (const text of [
      "M.Sc.",
      "M.Sc. Sustainable Entrepreneurship – programme page",
      "B.Com.",
      "Dipl.Ing.",
      "Dr.med.vet.",
      "Univ.Prof.",
      "o.Univ.Prof.",
      "Ass.Prof.",
      "Dott.ssa",
      "Müller GmbH & Co.KG",
      "Samsung Co.Ltd.",
      "Dr.-Ing.",
      "Jun.Prof.",
      "Pty.Ltd.",
      "Dr.in Maria Huber",
      "Mag.a Dr.in Huber",
      "Dir.in Mag.a Huber",
      "Bgm.\u2071\u207F Maria Muster",
      "OStR.\u2071\u207F Mag.ª Huber",
      "HR.\u2071\u207F Dr.\u2071\u207F Muster",
      "ΑΘΗΝΑ.ΤΟ",
      "Αθήνα.Το",
      "προσπάθεια.να",
    ]) {
      expect(linkTextProblem(text, UNI), text).toBeNull();
    }
  });

  it("doesn't read an ordinary word with a dot as a host", () => {
    for (const text of [
      "v1.2",
      "Version v1.2 of the guide",
      "Web 2.0",
      "3.5 hours",
      "22.10.2026",
      "1.000 Euro",
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
      "bzw.Online-Kurs",
      "e.V.-Mitglied",
      "π.χ.",
      "κ.λπ.",
      "т.е.",
      "и т.д.",
      "г.Москва",
      "Read the guide.",
      "Read the guide. Then practise.",
      "wait...then",
      "www",
    ]) {
      expect(linkTextProblem(text, EVIL), JSON.stringify(text)).toBeNull();
    }
  });

  it("leaves a name inside a path to its address", () => {
    for (const text of ["docs/report.de", "files/v2/report.de"]) expect(linkTextProblem(text, EVIL), text).toBeNull();
    for (const [text, href] of [
      ["https://example.org/meinebank.de", "https://example.org/"],
      ["example.org/files/meinebank.de", "https://example.org/"],
      ["https://example.org/guide.", "https://example.org/guide"],
      ["https://example.org/\u200B", "https://example.org/x"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
  });

  it("ends a name where its last label is a top-level domain and a hyphen", () => {
    for (const [text, href] of [
      ["www.ams.at-Seite", "https://www.ams.at/"],
      ["ams.at-Jobbörse", "https://jobs.ams.at/"],
      ["Booking.com-Konto", "https://www.booking.com/"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
    for (const text of ["www.ams.at-Seite", "paypal.com-login", "Log in at paypal.com-secure to confirm", "amazon.de-bestellung", "www.paypal.com-login/"]) {
      expect(linkTextProblem(text, EVIL), text).toBe("misleading");
    }
  });
});

describe("linkTextProblem: compared by site", () => {
  // D104 (owner decision, 22 October 2026): a site is a registrable domain,
  // by the ICANN section of the Public Suffix List: the public suffix a host
  // ends in ("org", "co.uk", "gov.gr") and one label more.
  it("accepts every host of the link's registrable domain, with or without www., and an international name as its punycode", () => {
    for (const [text, href] of [
      ["https://example.org", "https://example.org/x"],
      ["see https://example.org/a for more", "https://example.org/b?c=1"],
      ["https://www.example.org", "https://example.org/x"],
      ["https://example.org", "https://www.example.org/x"],
      ["www.example.org", "https://example.org/x"],
      ["example.org/guide", "https://www.example.org/guide"],
      ["europa.eu", "https://ec.europa.eu/info/index_en"],
      ["Wikipedia.org", "https://en.wikipedia.org/wiki/Social_enterprise"],
      ["github.com", "https://docs.github.com/en"],
      ["https://login.bank.example", "https://bank.example/"],
      ["bbc.co.uk", "https://www.bbc.co.uk/news"],
      ["news.bbc.co.uk", "https://bbc.co.uk/"],
      ["www.minedu.gov.gr", "https://minedu.gov.gr/"],
      ["ucy.ac.cy", "https://www.ucy.ac.cy/el/"],
      ["help.verein.de", "mailto:info@verein.de"],
      ["https://example.org", "mailto:help@example.org"],
      ["comune.milano.it", "https://www.comune.milano.it/"],
      // A host under the one shown is its site, under a top-level domain whose rules aren't all listed too.
      ["zoom.us", "https://us02web.zoom.us/j/123"],
      ["milano.it", "https://comune.milano.it/"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
  });

  it("refuses a host of another registrable domain", () => {
    for (const [text, href] of [
      ["https://bank.example", "https://evil.example/"],
      ["https://bank.example", "https://bank.example.evil.example/"],
      ["bank.co.uk", "https://evil.co.uk/"],
      ["bank.com.au", "https://evil.com.au/"],
      ["bank.com.gr", "https://evil.com.gr/"],
      ["bank.com.cy", "https://evil.com.cy/"],
      ["https://bank.co.jp", "https://evil.co.jp/"],
      ["https://example.org or https://evil.example", "https://example.org/"],
      ["https://bank.example", "mailto:help@evil.example"],
      ["www.bank.example", "mailto:help@evil.example"],
      ["Kontakt: verein.de", "mailto:info@evil.example"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBe("misleading");
    }
  });

  it("reads a common top-level domain in front of a host's site as a site shown, in an email address's domain too", () => {
    for (const [text, href] of [
      ["paypal.com.evil-shop.de", EVIL],
      ["https://paypal.com.evil.example/login", EVIL],
      ["www.paypal.com.evil.example", EVIL],
      ["https://meinebank.de.evil-shop.de", EVIL],
      ["Write to help@paypal.com.evil-shop.de", EVIL],
      ["help@paypal.com.evil-shop.de", "mailto:help@paypal.com.evil-shop.de"],
      // The link's own host, shown, still shows paypal.com in front.
      ["paypal.com.evil-shop.de", "https://paypal.com.evil-shop.de/login"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBe("misleading");
    }
  });

  // A public suffix of more than one label, named by itself ("gov.gr",
  // "GOV.UK": the name of a state's digital services), is no one host: it
  // shows every site under it. An address of its own host is that host.
  it("takes a public suffix named by itself as every site under it, and with a scheme, www. or a path as its own host", () => {
    for (const [text, href] of [
      ["Gov.gr Wallet", "https://wallet.gov.gr/"],
      ["Υπεύθυνη Δήλωση μέσω gov.gr", "https://dilosi.services.gov.gr/"],
      ["myKEPlive (gov.gr)", "https://mykeplive.gov.gr/"],
      ["gov.cy", "https://cyprus.gov.cy/"],
      ["Find a course on GOV.UK", "https://nationalcareers.service.gov.uk/find-a-course"],
      ["gov.gr", "mailto:info@minedu.gov.gr"],
      ["gov.gr", "https://www.gov.gr/"],
      ["gv.at", "https://www.gv.at/"],
      ["GOV.UK", "https://www.gov.uk/guidance/x"],
      ["https://gov.uk/guidance/x", "https://www.gov.uk/guidance/x"],
      ["gov.uk/guidance/x", "https://www.gov.uk/guidance/x"],
      ["www.gov.uk", "https://gov.uk/x"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBeNull();
    }
    for (const [text, href] of [
      ["gov.gr", EVIL],
      ["gov.gr", "https://gov.gr.evil.example/"],
      ["https://www.gov.gr", "https://minedu.gov.gr/"],
      ["www.gov.uk", "https://evil.gov.uk/"],
      ["gov.uk/guidance", "https://evil.gov.uk/"],
      ["gov.gr and paypal.com", "https://minedu.gov.gr/"],
    ]) {
      expect(linkTextProblem(text, href), `${text} over ${href}`).toBe("misleading");
    }
  });
});

describe("addressesShown and showsAnotherAddress", () => {
  it("reads the addresses a text shows once, for as many links as need comparing", () => {
    const shown = addressesShown("https://example.org and help@example.org");
    expect(shown).toEqual({ web: [{ host: "example.org", named: false }], email: ["help@example.org"], elsewhere: false });
    expect(showsAnotherAddress(shown, "https://example.org/a")).toBe(false);
    expect(showsAnotherAddress(shown, "mailto:help@example.org")).toBe(false);
    expect(showsAnotherAddress(shown, "mailto:other@example.org")).toBe(true);
    expect(showsAnotherAddress(shown, "https://evil.example/")).toBe(true);
    expect(addressesShown("the guide")).toBeNull();
    expect(showsAnotherAddress(null, "https://evil.example/")).toBe(false);
  });

  it("writes hosts as the URL parser does: lower case, one leading www. removed, international labels in punycode", () => {
    expect(addressesShown("Visit WWW.Bücher.DE/katalog")?.web).toEqual([{ host: "xn--bcher-kva.de", named: false }]);
    expect(addressesShown("bpb.de")?.web).toEqual([{ host: "bpb.de", named: true }]);
    expect(addressesShown("paypal.com.evil-shop.de")?.web).toEqual([
      { host: "paypal.com.evil-shop.de", named: true },
      { host: "paypal.com", named: false },
    ]);
    expect(addressesShown("https://paypal.com@evil-shop.de")?.elsewhere).toBe(true);
  });
});

describe("linkTextProblem: a label longer than DNS allows", () => {
  // More than 63 characters (RFC 1035), every one counted: no host's. It
  // stands for itself, never written in punycode, so it costs its length.
  const latin = (n: number) => Array.from({ length: n }, (_, i) => "àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ"[i % 31]).join("");
  const greek = (n: number) => Array.from({ length: n }, (_, i) => "αβγδεζηθικλμνξοπρστυφχψω"[i % 24]).join("");

  it("reads a name with one as another site than any link's", () => {
    for (const text of [
      `${latin(64)}.de`,
      `https://${greek(100)}.com`,
      `www.${latin(1_000)}.com`,
      `info@${latin(64)}.com`,
      `paypal.com.${latin(500)}.evil-shop.de`,
      `https://${latin(30)}\u0301${latin(34)}.com`,
    ]) {
      expect(linkTextProblem(text, EVIL), text.slice(0, 40)).toBe("misleading");
    }
    for (const text of [`https://${latin(64)}.evil-shop.de`, `${greek(1_000)}.evil-shop.de`]) expect(linkTextProblem(text, EVIL), text.slice(0, 40)).toBeNull();
    expect(addressesShown(`https://${latin(64)}.com`)?.web).toEqual([{ host: `xn--${latin(64)}.com`, named: false }]);
    // 63 is a label DNS can hold: in punycode, as the URL parser writes it.
    expect(addressesShown(`https://${latin(63)}.com`)?.web[0].host).toBe(new URL(`https://${latin(63)}.com`).hostname);
  });

  // A text of up to 10,000 characters (a block's most) is read on every save
  // and every server render: what it costs grows with its length, never
  // with its square, and stays within 10 ms. Compared as eight texts of
  // 1,250 characters against one of 10,000, the same characters in all, by
  // CPU time (cpuRatio: the least of 9 rounds each, run in turn): about
  // equal when the cost grows with the length, eight times more when with
  // its square.
  it.each([
    ["a title before thousands of common labels", (n: number) => `Dr.${"de.".repeat(Math.floor((n - 5) / 3))}de`],
    ["an address of thousands of common labels", (n: number) => `https://${"com.".repeat(Math.floor((n - 20) / 4))}evil-shop.de`],
    ["a company form before thousands of labels", (n: number) => `${"Co.".repeat(Math.floor((n - 2) / 3))}UK`],
    ["an address of thousands of commas", (n: number) => `https://a${",".repeat(n - 10)}b`],
    ["an address of thousands of dots", (n: number) => `https://a${".".repeat(n - 10)}b`],
    ["a name of thousands of hyphens", (n: number) => `a${"-".repeat(n - 2)}a`],
    ["thousands of names", (n: number) => "xn--a.com ".repeat(Math.floor(n / 10))],
    ["thousands of email addresses", (n: number) => "a@b.com ".repeat(Math.floor(n / 8))],
    ["thousands of email addresses' first parts", (n: number) => `${"a.com@".repeat(Math.floor((n - 6) / 6))}b.com`],
    ["one long Latin label", (n: number) => `https://${latin(n - 12)}.com`],
    ["one long Greek label", (n: number) => `${greek(n - 16)}.evil-shop.de`],
    ["thousands of compatibility forms", (n: number) => "paypal.\u217Dom ".repeat(Math.floor(n / 11))],
  ])("reads %s in time proportional to its length", (_, make) => {
    const read = (texts: string[]) => () => {
      for (const text of texts) linkTextProblem(text, EVIL);
    };
    const { long, ratio } = cpuRatio(read([make(10_000)]), read(Array.from({ length: 8 }, () => make(1_250))));
    expect(ratio, `${long.toFixed(2)} ms, ${ratio.toFixed(1)} times`).toBeLessThan(3);
    expect(long, "the long text, in ms of CPU time").toBeLessThan(10);
  }, 30_000);
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

  it("leaves an address whose host DNS can't hold as typed, without parsing it", () => {
    for (const host of ["☃".repeat(64), `bank.${"à".repeat(64)}`, "a.".repeat(127)]) {
      expect(toLinkInput(`https://${host}.example/x`)).toBe(`https://${host}.example/x`);
      expect(checkLinkHref(toLinkInput(`https://${host}.example/x`))).toEqual({ ok: false, reason: "host" });
    }
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
