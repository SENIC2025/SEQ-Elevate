import { describe, it, expect, vi } from "vitest";
import en from "@/messages/en.json";
import {
  CONSENT_VERSION,
  DEFAULT_MINIMUM_AGE,
  ageRuleSetting,
  blobDeleteOn,
  cspReportOnly,
  languageReadyOn,
  partnerAccessOn,
  profileConsent,
  profileGateOn,
} from "./r3-switches";

// Release 3's settings (spec 15): each has a default that holds when the
// variable is unset, and moves only for its exact word.

describe("partnerAccessOn (D77)", () => {
  it("is off unless the variable says exactly 'on'", () => {
    for (const value of [undefined, "", "off", "true", "1", "yes", "onn"]) {
      expect(partnerAccessOn({ R3_PARTNER_ACCESS: value }), String(value)).toBe(false);
    }
    expect(partnerAccessOn({})).toBe(false);
  });

  it("is on for 'on', in any case", () => {
    expect(partnerAccessOn({ R3_PARTNER_ACCESS: "on" })).toBe(true);
    expect(partnerAccessOn({ R3_PARTNER_ACCESS: " ON " })).toBe(true);
  });
});

describe("profileGateOn", () => {
  it("is on unless the variable says exactly 'off'", () => {
    for (const value of [undefined, "", "on", "false", "0", "of"]) {
      expect(profileGateOn({ R3_PROFILE_GATE: value }), String(value)).toBe(true);
    }
    expect(profileGateOn({ R3_PROFILE_GATE: "off" })).toBe(false);
    expect(profileGateOn({ R3_PROFILE_GATE: " Off " })).toBe(false);
  });
});

describe("languageReadyOn and blobDeleteOn", () => {
  it("are on unless switched off with 'off'", () => {
    expect(languageReadyOn({})).toBe(true);
    expect(languageReadyOn({ R3_LANGUAGE_READY: "no" })).toBe(true);
    expect(languageReadyOn({ R3_LANGUAGE_READY: "OFF" })).toBe(false);
    expect(blobDeleteOn({})).toBe(true);
    expect(blobDeleteOn({ R3_BLOB_DELETE: "false" })).toBe(true);
    expect(blobDeleteOn({ R3_BLOB_DELETE: "off" })).toBe(false);
  });
});

describe("cspReportOnly", () => {
  it("enforces unless the variable says 'report-only'", () => {
    expect(cspReportOnly({})).toBe(false);
    expect(cspReportOnly({ R3_CSP: "off" })).toBe(false);
    expect(cspReportOnly({ R3_CSP: "report-only" })).toBe(true);
  });
});

describe("profileConsent", () => {
  it("is off by default", () => {
    const log = vi.fn();
    expect(profileConsent({}, log)).toBe("off");
    expect(profileConsent({ PROFILE_CONSENT: "" }, log)).toBe("off");
    expect(profileConsent({ PROFILE_CONSENT: "off" }, log)).toBe("off");
    expect(log).not.toHaveBeenCalled();
  });

  it("reads optional and required, once the consent text is final", () => {
    expect(profileConsent({ PROFILE_CONSENT: "optional" }, vi.fn(), "2026-11-30")).toBe("optional");
    expect(profileConsent({ PROFILE_CONSENT: " Required " }, vi.fn(), "2026-11-30")).toBe("required");
  });

  it("stays off while the consent text is a draft, saying so once", () => {
    const log = vi.fn();
    expect(profileConsent({ PROFILE_CONSENT: "required" }, log, "draft-2026-10-21")).toBe("off");
    expect(profileConsent({ PROFILE_CONSENT: "optional" }, log, "draft-2026-10-21")).toBe("off");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/PROFILE_CONSENT.*draft/);
    // The text in the messages is the one that counts; today's is a draft.
    expect(CONSENT_VERSION).toBe(en.profile.consent.version);
    expect(profileConsent({ PROFILE_CONSENT: "required" }, vi.fn())).toBe(
      CONSENT_VERSION.startsWith("draft-") ? "off" : "required"
    );
  });

  it("falls back to off for anything else, saying so once and without the value", () => {
    const log = vi.fn();
    expect(profileConsent({ PROFILE_CONSENT: "requird" }, log)).toBe("off");
    expect(profileConsent({ PROFILE_CONSENT: "requird" }, log)).toBe("off");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/PROFILE_CONSENT/);
    expect(log.mock.calls[0][0]).not.toMatch(/requird/);
  });
});

describe("ageRuleSetting (Q18)", () => {
  it("is 16 everywhere by default", () => {
    expect(DEFAULT_MINIMUM_AGE).toBe(16);
    expect(ageRuleSetting({})).toEqual({ kind: "fixed", age: 16 });
    expect(ageRuleSetting({ AGE_RULE: " " })).toEqual({ kind: "fixed", age: 16 });
  });

  it("takes a whole number from 13", () => {
    expect(ageRuleSetting({ AGE_RULE: "13" })).toEqual({ kind: "fixed", age: 13 });
    expect(ageRuleSetting({ AGE_RULE: "18" })).toEqual({ kind: "fixed", age: 18 });
  });

  it("takes digital-consent", () => {
    expect(ageRuleSetting({ AGE_RULE: "digital-consent" })).toEqual({ kind: "digital-consent" });
    expect(ageRuleSetting({ AGE_RULE: "Digital-Consent" })).toEqual({ kind: "digital-consent" });
  });

  it("falls back to 16 for a value it can't read or an age under 13, saying so once", () => {
    const log = vi.fn();
    for (const value of ["12", "0", "16.5", "-16", "sixteen", "100"]) {
      expect(ageRuleSetting({ AGE_RULE: value }, log), value).toEqual({ kind: "fixed", age: 16 });
      ageRuleSetting({ AGE_RULE: value }, log);
    }
    expect(log).toHaveBeenCalledTimes(6);
    expect(log.mock.calls.every(([line]) => /AGE_RULE/.test(String(line)))).toBe(true);
    expect(log.mock.calls.some(([line]) => String(line).includes("sixteen"))).toBe(false);
  });
});
