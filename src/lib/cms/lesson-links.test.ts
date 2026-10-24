import { describe, it, expect } from "vitest";
import { cleanLinkLine, linkPlace, titleMisleads, titleShowsNothing } from "./lesson-links";

/*
 * A further-reading link's title and where it goes, as the form, the
 * actions and the screens all read them (Release 4, D104, D107; spec 4.2,
 * 4.5): one cleaning for the form and the server; a title is compared with
 * the address as it reads, so characters that show nothing or only look
 * like others never make it show another address than the link opens; and
 * the line under a link names the place in ASCII, email domains included.
 */

const EVIL = "https://evil.example/";

/** Characters that show nothing, or look like "." (U+2024, ONE DOT LEADER). */
const UNSEEN = [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x180e, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x3164, 0xffa0, 0x115f, 0x00ad, 0x034f, 0xfe0f];

describe("titleMisleads: a title is compared as it reads", () => {
  it("refuses an address written with a character that shows nothing, wherever it sits", () => {
    for (const cp of UNSEEN) {
      const c = String.fromCodePoint(cp);
      for (const title of [`https://bank${c}.example/login`, `https://bank.${c}example/login`, `https:${c}//bank.example`, `Log in at https://bank${c}.example`]) {
        expect(titleMisleads(title, EVIL), `U+${cp.toString(16).toUpperCase()} in ${JSON.stringify(title)}`).toBe(true);
      }
    }
  });

  it("refuses an address written with look-alike compatibility characters", () => {
    for (const title of [
      "https://bank.example․login", // one dot leader: "bank.example.login"
      "https://bank․example/login",
      "https：//bank.example", // fullwidth colon
      "https:／／bank.example", // fullwidth solidus
      "Write to help＠bank.example", // fullwidth commercial at
    ]) {
      expect(titleMisleads(title, EVIL), JSON.stringify(title)).toBe(true);
    }
  });

  it("refuses a host written with www. that isn't the link's site", () => {
    for (const title of ["www.bank.example/login", "www.bank.example", "WWW.BANK.EXAMPLE", "Log in at www.bank.example.", "(www.bank.example)", "www​.bank.example"]) {
      expect(titleMisleads(title, EVIL), title).toBe(true);
    }
    expect(titleMisleads("Write to www.verein.de", "mailto:info@gmail.example")).toBe(true);
  });

  it("refuses a bare name of another site that a path follows, or that ends in a common top-level domain in lower case (D104 as narrowed on 22 October 2026)", () => {
    for (const title of ["bank.example/login", "Log in at meinebank.de", "Visit PayPal.com", "awww.paypal.com is a site here", "meinebank\u200B.de"]) {
      expect(titleMisleads(title, EVIL), title).toBe(true);
    }
    expect(titleMisleads("Kontakt: verein.de", "mailto:info@verein.de")).toBe(false);
  });

  it("accepts a name that shows no address by its look: in capitals or title case, of another top-level domain, a file's name (D104 as narrowed on 22 October 2026; learners see the link's site beside it)", () => {
    for (const title of ["Log in at bank.example", "awww.example is a site here", "bank\u200B.example", "PAYPAL.COM", "Amazon.Co.UK", "course-materials.zip", "README.md"]) {
      expect(titleMisleads(cleanLinkLine(title, 200)!, EVIL), JSON.stringify(title)).toBe(false);
    }
  });

  it("refuses what the shared rule refuses (D104)", () => {
    expect(titleMisleads("https://bank.example/login", EVIL)).toBe(true);
    expect(titleMisleads("Write to help@bank.example", EVIL)).toBe(true);
  });

  it("refuses a host read as it shows, once cleaned: a Roman numeral letter, a mark that follows no letter, a raised letter inside a name", () => {
    for (const title of ["paypal.\u217Dom", "paypa\u217C.com", "www.paypal.\u0332com/login", "\u0332paypal.com", "paypal.c\u1D52m", "paypal.\u24D2\u24DE\u24DC"]) {
      const clean = cleanLinkLine(title, 200);
      expect(clean, JSON.stringify(title)).not.toBeNull();
      expect(titleMisleads(clean!, EVIL), JSON.stringify(title)).toBe(true);
    }
  });

  it("refuses a host read as it shows, once cleaned: a Roman numeral or a raised letter that ends a name, a top-level domain and a hyphen, a name the URL parser refuses", () => {
    for (const title of [
      "rabobank.n\u217C",
      "www.example.n\u217C",
      "Log in at irs.go\u2174 to confirm",
      "paypal.c\u1D52\u1D50",
      "paypal.com-login",
      "Log in at paypal.com-secure to confirm",
      "xn--a.paypal.com",
    ]) {
      const clean = cleanLinkLine(title, 200);
      expect(clean, JSON.stringify(title)).not.toBeNull();
      expect(titleMisleads(clean!, EVIL), JSON.stringify(title)).toBe(true);
    }
  });

  it("accepts a title that names the link's own site, however it is written", () => {
    expect(titleMisleads("www.bpb.de", "https://www.bpb.de/")).toBe(false);
    expect(titleMisleads("www.bpb.de", "https://bpb.de/themen")).toBe(false);
    expect(titleMisleads("Mehr unter www.bpb.de", "https://www.bpb.de/themen")).toBe(false);
    expect(titleMisleads("https://bank​.example/login", "https://bank.example/login")).toBe(false);
    expect(titleMisleads("Kontakt: www.verein.de", "mailto:info@verein.de")).toBe(false);
    expect(titleMisleads("https://www.bank.example", "https://bank.example/")).toBe(false);
    // A public suffix named by itself, over a site under it; a title's abbreviation.
    expect(titleMisleads("Gov.gr Wallet", "https://wallet.gov.gr/")).toBe(false);
    expect(titleMisleads("Υπεύθυνη Δήλωση μέσω gov.gr", "https://dilosi.services.gov.gr/")).toBe(false);
    expect(titleMisleads("Dr.in Maria Huber", "https://www.univie.ac.at/personen/huber")).toBe(false);
    // A title and its feminine ending; the link's own site, ending in a Roman numeral letter or before a hyphen.
    for (const title of ["Dir.\u2071\u207F Mag.\u00AA Huber", "Dir.in Mag.a Huber", "Bgm.\u2071\u207F Maria Muster"]) {
      expect(titleMisleads(cleanLinkLine(title, 200)!, "https://www.schule.example.at/team"), title).toBe(false);
    }
    expect(titleMisleads("rabobank.n\u217C", "https://www.rabobank.nl/")).toBe(false);
    expect(titleMisleads("Booking.com-Konto", "https://www.booking.com/")).toBe(false);
  });

  it("accepts words, in English, German and Greek, emoji with joiners included", () => {
    for (const title of [
      "The guide",
      "Leitfaden für Lehrkräfte",
      "Οδηγός για εκπαιδευτικούς",
      "Team work 👩‍👩‍👧",
      "www",
      "awww, a word here",
      // Ordinary words with a dot: a version, abbreviations, a sentence's end.
      "Version v1.2 of the guide",
      "e.g. the guide, z.B. Abb. 2, κ.λπ.",
      "Read the guide.",
    ]) {
      expect(titleMisleads(title, EVIL), title).toBe(false);
    }
    // An email address on a www. domain is read as that address, nothing else.
    expect(titleMisleads("info@www.verein.example", "mailto:info@www.verein.example")).toBe(false);
  });
});

describe("titleShowsNothing", () => {
  it("is true for a title of spaces and characters that show nothing", () => {
    for (const title of ["", " ", "​", " ​\t ", "ㅤ", "ᅟㅤ", "ﾠ", "­", "⁠᠎", "　"]) {
      expect(titleShowsNothing(title), JSON.stringify(title)).toBe(true);
    }
  });

  it("is false for a title with anything to see", () => {
    for (const title of ["x", " a ", "👍", "​A"]) expect(titleShowsNothing(title), title).toBe(false);
  });
});

describe("cleanLinkLine: one cleaning for the form and the server (spec 4.2)", () => {
  it("makes one line, removes control and direction characters, trims, and keeps the spaces typed", () => {
    expect(cleanLinkLine("\tThe\u0007\nguide  x‮ ", 200)).toBe("The guide  x");
  });

  it("refuses, never cuts: null over the limit, and at once over twice the limit", () => {
    expect(cleanLinkLine("x".repeat(200), 200)).toBe("x".repeat(200));
    expect(cleanLinkLine("x".repeat(201), 200)).toBeNull();
    expect(cleanLinkLine(` ${"x".repeat(200)}\n`, 200)).toBe("x".repeat(200));
    expect(cleanLinkLine("\u0007".repeat(401), 200)).toBeNull();
  });
});

describe("linkPlace", () => {
  it("names an email link's place with its domain in ASCII, as a web host is", () => {
    // Cyrillic е in "vеrein".
    expect(linkPlace({ url: "mailto:info@vеrein.de", kind: "email" })).toBe("info@xn--vrein-zwe.de");
    expect(linkPlace({ url: "https://vеrein.de/kontakt", kind: "web" })).toBe("xn--vrein-zwe.de");
    expect(linkPlace({ url: "https://xn--vrein-zwe.de/kontakt", kind: "web" })).toBe("xn--vrein-zwe.de");
  });

  it("keeps an ASCII email address as written, without mailto: or its subject", () => {
    expect(linkPlace({ url: "mailto:HELP@Example.org?subject=Course", kind: "email" })).toBe("HELP@Example.org");
  });

  it("names nothing for an address it can't read", () => {
    expect(linkPlace({ url: "javascript:alert(1)", kind: null })).toBe("");
  });
});
