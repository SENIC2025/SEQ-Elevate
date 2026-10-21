import { describe, it, expect } from "vitest";
import {
  changedCountries,
  contactsFor,
  EMERGENCY_NUMBER,
  EMPTY_SAFEGUARDING,
  helpGroups,
  httpsUrl,
  parseSafeguarding,
  telHref,
  textIn,
  validateSafeguarding,
  validPhone,
  type SafeguardingContact,
  type SafeguardingSetting,
} from "./safeguarding";

/*
 * Release 3 (D93, spec 11.2; UF2): the safeguarding contacts. Up to three
 * per country (the organisation's contact and help lines), checked strictly
 * when an admin saves them and read leniently from the database; the
 * learner's own country in the box, every country on /help, the
 * organisation before help lines; 112 always, in code.
 */

const ORG: SafeguardingContact = {
  kind: "organisation",
  organisation: "Pro Arbeit",
  role: "Safeguarding lead",
  email: "schutz@example.org",
  hours: { en: "Mon–Fri 9–17", de: "Mo–Fr 9–17 Uhr" },
};
const LINE: SafeguardingContact = {
  kind: "helpline",
  organisation: "Nummer gegen Kummer",
  phone: "116 111",
  url: "https://www.nummergegenkummer.de/",
};
const OTHER_LINE: SafeguardingContact = { kind: "helpline", organisation: "Second line", phone: "+49 800 1110111" };

describe("validateSafeguarding (an admin's save)", () => {
  it("accepts an organisation contact and a help line per country, and a third entry", () => {
    expect(validateSafeguarding({ DE: [LINE, ORG], CY: [ORG] })).toEqual({ ok: true, contacts: { DE: [LINE, ORG], CY: [ORG] } });
    expect(validateSafeguarding({ OTHER: [ORG, LINE, OTHER_LINE] })).toEqual({
      ok: true,
      contacts: { OTHER: [ORG, LINE, OTHER_LINE] },
    });
  });

  it("refuses a fourth entry for a country", () => {
    expect(validateSafeguarding({ GR: [ORG, LINE, OTHER_LINE, LINE] })).toEqual({
      ok: false,
      errors: [{ country: "GR", index: null, field: null, problem: "too-many" }],
    });
  });

  it("names each field that is wrong, by country and entry", () => {
    const result = validateSafeguarding({
      BE: [
        { kind: "helpline", organisation: "", phone: "call us" },
        { kind: "friend", organisation: "X", email: "not-an-address", url: "http://example.org" },
        { kind: "organisation", organisation: "No way to reach" },
        { kind: "organisation", organisation: "x".repeat(201), phone: "112", note: { en: "y".repeat(501) } },
      ],
    });
    expect(result).toEqual({ ok: false, errors: [{ country: "BE", index: null, field: null, problem: "too-many" }] });
    const three = validateSafeguarding({
      BE: [
        { kind: "helpline", organisation: "", phone: "call us" },
        { kind: "friend", organisation: "X", email: "not-an-address", url: "http://example.org" },
        { kind: "organisation", organisation: "x".repeat(201), phone: "112", note: { en: "y".repeat(501) } },
      ],
      CY: [{ kind: "organisation", organisation: "No way to reach" }],
    });
    expect(three.ok).toBe(false);
    expect(three.ok === false && three.errors).toEqual([
      { country: "BE", index: 0, field: "organisation", problem: "required" },
      { country: "BE", index: 0, field: "phone", problem: "invalid" },
      { country: "BE", index: 1, field: "kind", problem: "invalid" },
      { country: "BE", index: 1, field: "email", problem: "invalid" },
      { country: "BE", index: 1, field: "url", problem: "invalid" },
      { country: "BE", index: 2, field: "organisation", problem: "too-long" },
      { country: "BE", index: 2, field: "note", problem: "too-long" },
      { country: "CY", index: 0, field: "reach", problem: "required" },
    ]);
  });

  it("keeps plain text on one line, and drops empty optional fields", () => {
    const result = validateSafeguarding({
      DE: [{ kind: "organisation", organisation: "  Pro\n Arbeit\t", role: "", email: " schutz@example.org ", hours: { de: "" } }],
    });
    expect(result).toEqual({ ok: true, contacts: { DE: [{ kind: "organisation", organisation: "Pro Arbeit", email: "schutz@example.org" }] } });
  });

  it("refuses anything that isn't countries with lists", () => {
    for (const bad of [null, [], "DE", { XX: [] }, { DE: ORG }, { DE: [ORG], hours: [] }]) {
      expect(validateSafeguarding(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(validateSafeguarding({ DE: [{ ...ORG, hours: { fr: "lun" } }] }).ok).toBe(false);
    expect(validateSafeguarding({ DE: [{ ...ORG, organisation: 5 }] }).ok).toBe(false);
  });
});

describe("phone, web address", () => {
  it("takes E.164 numbers and short national numbers, and calls them by digits and + only", () => {
    for (const ok of ["+49 30 1234567", "116 111", "112", "08001110111"]) expect(validPhone(ok), ok).toBe(true);
    for (const bad of ["call us", "+", "12", "+49-30-123", "tel:112", "1".repeat(16), "+ 49 30"]) expect(validPhone(bad), bad).toBe(false);
    expect(telHref("+49 30 1234567")).toBe("tel:+49301234567");
    expect(telHref("116 111")).toBe("tel:116111");
  });

  it("takes https addresses only", () => {
    expect(httpsUrl("https://www.nummergegenkummer.de")).toBe("https://www.nummergegenkummer.de/");
    for (const bad of ["http://example.org", "javascript:alert(1)", "https://localhost", "https://user:pw@example.org", "example.org"]) {
      expect(httpsUrl(bad), bad).toBeNull();
    }
  });
});

describe("parseSafeguarding (the stored setting)", () => {
  it("reads a saved setting back as it was saved", () => {
    const stored = { v: 1, contacts: { DE: [ORG, LINE] }, updatedAt: "2026-11-20T09:00:00.000Z" };
    expect(parseSafeguarding(stored)).toEqual(stored);
  });

  it("leaves out what isn't valid, keeps a country's first three, and reads anything else as empty", () => {
    expect(
      parseSafeguarding({
        v: 1,
        contacts: { DE: [ORG, { kind: "helpline", organisation: "<b>bad</b>", url: "javascript:x" }, LINE, OTHER_LINE, ORG], XX: [ORG] },
        updatedAt: "yesterday",
      })
    ).toEqual({ v: 1, contacts: { DE: [ORG, LINE, OTHER_LINE] }, updatedAt: null });
    for (const raw of [null, undefined, "x", [], { v: 2, contacts: {} }, { v: 1 }, { v: 1, contacts: [] }]) {
      expect(parseSafeguarding(raw), JSON.stringify(raw)).toEqual(EMPTY_SAFEGUARDING);
    }
  });
});

describe("contactsFor (the box) and helpGroups (/help)", () => {
  const setting: SafeguardingSetting = {
    v: 1,
    contacts: { DE: [LINE, ORG], CY: [OTHER_LINE], OTHER: [ORG] },
    updatedAt: null,
  };

  it("gives the learner's own country, the organisation's contact before help lines", () => {
    expect(contactsFor(setting, "DE")).toEqual([{ country: "DE", contacts: [ORG, LINE] }]);
    expect(contactsFor(setting, "OTHER")).toEqual([{ country: "OTHER", contacts: [ORG] }]);
  });

  it("gives every country that has contacts when the learner has no country", () => {
    expect(contactsFor(setting, null).map((g) => g.country)).toEqual(["DE", "CY", "OTHER"]);
  });

  it("gives none for a country with none, and none with nothing saved: the box shows 112 and the fallback", () => {
    expect(contactsFor(setting, "BE")).toEqual([]);
    expect(contactsFor(EMPTY_SAFEGUARDING, null)).toEqual([]);
    expect(EMERGENCY_NUMBER).toBe("112");
  });

  it("lists every country on /help, the viewer's own first", () => {
    expect(helpGroups(setting, null).map((g) => g.country)).toEqual(["DE", "CY", "BE", "GR", "OTHER"]);
    expect(helpGroups(setting, "GR").map((g) => g.country)).toEqual(["GR", "DE", "CY", "BE", "OTHER"]);
    expect(helpGroups(setting, "DE")[0].contacts).toEqual([ORG, LINE]);
    expect(helpGroups(EMPTY_SAFEGUARDING, null).every((g) => g.contacts.length === 0)).toBe(true);
  });
});

describe("textIn, changedCountries", () => {
  it("gives a text in the page's language, else English, with its language", () => {
    expect(textIn(ORG.hours, "de")).toEqual({ text: "Mo–Fr 9–17 Uhr", lang: "de" });
    expect(textIn(ORG.hours, "el")).toEqual({ text: "Mon–Fri 9–17", lang: "en" });
    expect(textIn({ el: "Δευ" }, "de")).toEqual({ text: "Δευ", lang: "el" });
    expect(textIn(undefined, "en")).toBeUndefined();
  });

  it("names the countries a save changed, and nothing of the contacts", () => {
    expect(changedCountries({ DE: [ORG] }, { DE: [ORG], CY: [LINE] })).toEqual(["CY"]);
    expect(changedCountries({ DE: [ORG, LINE] }, { DE: [LINE, ORG] })).toEqual(["DE"]);
    expect(changedCountries({ GR: [ORG] }, {})).toEqual(["GR"]);
    expect(changedCountries({ DE: [ORG] }, { DE: [ORG] })).toEqual([]);
  });
});
