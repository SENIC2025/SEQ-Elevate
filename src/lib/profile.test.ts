import { describe, it, expect, vi } from "vitest";
import {
  NAME_MAX,
  UNVERSIONED_TERMS,
  currentTermsVersion,
  isProfileComplete,
  minimumAgeFor,
  parseProfileInput,
  profileRules,
  type ProfileContext,
} from "./profile";

// Consent can be asked for only once the consent text is final (a draft's
// version starts "draft-", r3-switches.ts): these tests read the rules as
// they are then.
vi.mock("@/messages/en.json", async (importOriginal) => {
  const { default: en } = await importOriginal<{ default: typeof import("@/messages/en.json") }>();
  return { default: { ...en, profile: { ...en.profile, consent: { ...en.profile.consent, version: "2026-11-30" } } } };
});

/*
 * The profile step's rules (D78, spec 5.2): two modes chosen from the stored
 * profile; per-field answers; complete only with the current Terms version.
 */

const FIRST: ProfileContext = {
  completed: false,
  nameRequired: true,
  termsCurrent: false,
  guardianConsentRecorded: false,
  consent: "off",
};
const LATER: ProfileContext = { ...FIRST, completed: true, nameRequired: false, termsCurrent: false };
const GOOD = { name: "  Lea  ", country: "DE", termsAccepted: true, age: "self" };

describe("parseProfileInput, first completion", () => {
  it("reads every field", () => {
    expect(parseProfileInput(GOOD, FIRST)).toEqual({
      ok: true,
      value: { name: "Lea", country: "DE", termsAccepted: true, age: "self" },
    });
  });

  it("names every missing answer at once", () => {
    expect(parseProfileInput({}, FIRST)).toEqual({
      ok: false,
      errors: { name: "empty", country: "empty", age: "required", terms: "required" },
    });
    expect(parseProfileInput(null, FIRST)).toEqual(parseProfileInput({}, FIRST));
    expect(parseProfileInput("text", FIRST)).toEqual(parseProfileInput({}, FIRST));
    expect(parseProfileInput([GOOD], FIRST)).toEqual(parseProfileInput({}, FIRST));
  });

  it("takes a name of 1 to 50 characters in any script, trimmed", () => {
    for (const name of ["A", "Λένα", "Ünal", "李", "x".repeat(NAME_MAX), "🙂".repeat(NAME_MAX), "Mary-Jane O'Neil"]) {
      const r = parseProfileInput({ ...GOOD, name }, FIRST);
      expect(r.ok && r.value.name, name).toBe(name);
    }
    expect(NAME_MAX).toBe(50);
  });

  it("refuses a blank, too long, non-text or control-character name", () => {
    const error = (name: unknown) => {
      const r = parseProfileInput({ ...GOOD, name }, FIRST);
      return r.ok ? null : r.errors.name;
    };
    expect(error("")).toBe("empty");
    expect(error("   ")).toBe("empty");
    expect(error(undefined)).toBe("empty");
    expect(error("x".repeat(NAME_MAX + 1))).toBe("too-long");
    expect(error(42)).toBe("invalid");
    expect(error({ first: "Lea" })).toBe("invalid");
    expect(error("Le\u0000a")).toBe("invalid");
    expect(error("Lea\nBen")).toBe("invalid");
    expect(error("Lea Ben")).toBe("invalid");
  });

  it("doesn't read a name when one is stored", () => {
    const r = parseProfileInput({ ...GOOD, name: "Renamed" }, { ...FIRST, nameRequired: false });
    expect(r).toEqual({ ok: true, value: { country: "DE", termsAccepted: true, age: "self" } });
  });

  it("takes only the five countries", () => {
    for (const country of ["DE", "CY", "BE", "GR", "OTHER"]) {
      expect(parseProfileInput({ ...GOOD, country }, FIRST).ok, country).toBe(true);
    }
    for (const country of ["de", "EL", "GB", "", null, 1]) {
      const r = parseProfileInput({ ...GOOD, country }, FIRST);
      expect(r.ok ? null : r.errors.country, String(country)).toBe("empty");
    }
  });

  it("needs the Terms ticked: true, nothing else", () => {
    for (const termsAccepted of [false, "true", 1, "on", undefined]) {
      const r = parseProfileInput({ ...GOOD, termsAccepted }, FIRST);
      expect(r.ok ? null : r.errors.terms, String(termsAccepted)).toBe("required");
    }
  });

  it("refuses 'invited' without a guardian-consent record, and accepts it with one", () => {
    const refused = parseProfileInput({ ...GOOD, age: "invited" }, FIRST);
    expect(refused).toEqual({ ok: false, errors: { age: "not-invited" } });
    const invited = parseProfileInput({ ...GOOD, age: "invited" }, { ...FIRST, guardianConsentRecorded: true });
    expect(invited.ok && invited.value.age).toBe("invited");
  });

  it("needs the age statement", () => {
    for (const age of [undefined, "", "yes", true, "SELF"]) {
      const r = parseProfileInput({ ...GOOD, age }, FIRST);
      expect(r.ok ? null : r.errors.age, String(age)).toBe("required");
    }
  });

  it("reads consent only as PROFILE_CONSENT says", () => {
    const off = parseProfileInput({ ...GOOD, consent: true }, FIRST);
    expect(off.ok && "consent" in off.value).toBe(false);
    const optional = parseProfileInput(GOOD, { ...FIRST, consent: "optional" });
    expect(optional.ok && optional.value.consent).toBe(false);
    const given = parseProfileInput({ ...GOOD, consent: true }, { ...FIRST, consent: "optional" });
    expect(given.ok && given.value.consent).toBe(true);
    const required = parseProfileInput(GOOD, { ...FIRST, consent: "required" });
    expect(required).toEqual({ ok: false, errors: { consent: "required" } });
  });
});

describe("parseProfileInput, later", () => {
  it("reads only the Terms (and consent): country and age sent again are ignored", () => {
    const r = parseProfileInput({ name: "New", country: "CY", age: "invited", termsAccepted: true }, LATER);
    expect(r).toEqual({ ok: true, value: { termsAccepted: true } });
  });

  it("asks for the Terms again only when they changed", () => {
    expect(parseProfileInput({}, LATER)).toEqual({ ok: false, errors: { terms: "required" } });
    expect(parseProfileInput({}, { ...LATER, termsCurrent: true })).toEqual({
      ok: true,
      value: { termsAccepted: false },
    });
  });

  it("reads a name when the stored one is blank, so a blank name can always be fixed", () => {
    const ctx = { ...LATER, termsCurrent: true, nameRequired: true };
    expect(parseProfileInput({ name: "Lea" }, ctx)).toEqual({ ok: true, value: { name: "Lea", termsAccepted: false } });
    expect(parseProfileInput({}, ctx)).toEqual({ ok: false, errors: { name: "empty" } });
  });

  it("asks for consent once it is required", () => {
    expect(parseProfileInput({}, { ...LATER, termsCurrent: true, consent: "required" })).toEqual({
      ok: false,
      errors: { consent: "required" },
    });
  });
});

describe("isProfileComplete", () => {
  const rules = { termsVersion: "2026-11-20", consent: "off" as const };
  const profile = {
    country: "DE",
    termsVersion: "2026-11-20",
    ageConfirmedAt: new Date("2026-11-20T09:00:00Z"),
    consentAt: null,
  };
  const user = { name: "Lea" };

  it("is complete with a name, a country, the current Terms and the age rule", () => {
    expect(isProfileComplete(user, profile, rules)).toBe(true);
  });

  it("is incomplete without any one of them", () => {
    expect(isProfileComplete(null, profile, rules)).toBe(false);
    expect(isProfileComplete(user, null, rules)).toBe(false);
    expect(isProfileComplete({ name: null }, profile, rules)).toBe(false);
    expect(isProfileComplete({ name: "  " }, profile, rules)).toBe(false);
    expect(isProfileComplete(user, { ...profile, country: null }, rules)).toBe(false);
    expect(isProfileComplete(user, { ...profile, country: "GB" }, rules)).toBe(false);
    expect(isProfileComplete(user, { ...profile, ageConfirmedAt: null }, rules)).toBe(false);
    expect(isProfileComplete(user, { ...profile, termsVersion: null }, rules)).toBe(false);
  });

  it("is incomplete once the Terms version changes", () => {
    expect(isProfileComplete(user, profile, { ...rules, termsVersion: "2027-01-10" })).toBe(false);
  });

  it("needs consent only when it is required", () => {
    expect(isProfileComplete(user, profile, { ...rules, consent: "optional" })).toBe(true);
    expect(isProfileComplete(user, profile, { ...rules, consent: "required" })).toBe(false);
    expect(isProfileComplete(user, { ...profile, consentAt: new Date() }, { ...rules, consent: "required" })).toBe(true);
  });
});

describe("profileRules and the Terms version", () => {
  it("measures against the current English Terms version and PROFILE_CONSENT", () => {
    expect(currentTermsVersion()).toBe(UNVERSIONED_TERMS);
    expect(profileRules({})).toEqual({ termsVersion: currentTermsVersion(), consent: "off" });
    expect(profileRules({ PROFILE_CONSENT: "required" }).consent).toBe("required");
  });
});

describe("minimumAgeFor", () => {
  it("is 16 for every country when AGE_RULE is unset (Q18)", () => {
    for (const c of ["DE", "CY", "BE", "GR", "OTHER", null] as const) expect(minimumAgeFor(c, {})).toBe(16);
  });

  it("is the number AGE_RULE gives", () => {
    expect(minimumAgeFor("BE", { AGE_RULE: "14" })).toBe(14);
    expect(minimumAgeFor("DE", { AGE_RULE: "18" })).toBe(18);
  });

  it("is each country's age of digital consent with AGE_RULE=digital-consent", () => {
    const env = { AGE_RULE: "digital-consent" };
    expect(minimumAgeFor("BE", env)).toBe(13);
    expect(minimumAgeFor("CY", env)).toBe(14);
    expect(minimumAgeFor("GR", env)).toBe(15);
    expect(minimumAgeFor("DE", env)).toBe(16);
    expect(minimumAgeFor("OTHER", env)).toBe(16);
    expect(minimumAgeFor(null, env)).toBe(16);
  });
});
