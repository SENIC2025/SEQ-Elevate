/**
 * Release 3 (D78, spec 5.2): the profile step's rules. Every signed-in
 * person completes it once: a first name or nickname, the country they take
 * part from, the Terms of use (version and time stored), the age rule, and,
 * only when PROFILE_CONSENT asks for it, a separate consent. A new English
 * Terms version asks for the Terms again, nothing else.
 *
 * Two modes, chosen from the stored profile, never from the request:
 * - first completion (nothing completed yet): name (when none is stored),
 *   country, Terms, age rule and consent are read;
 * - later (new Terms, consent becoming required, a blank name): only the
 *   Terms, the consent and a name when none is stored are read. Country and
 *   age rule sent again are ignored; only an admin changes the country.
 *
 * Pure (type-only imports and the legal texts), so client components can use
 * it too. Answers per field and never throws.
 */

import { getLegal } from "@/data/legal";
import { isCountry, type Country } from "@/lib/countries";
import { ageRuleSetting, profileConsent, type ProfileConsent } from "@/lib/r3-switches";

type Env = Record<string, string | undefined>;

/** The longest name kept, in characters. */
export const NAME_MAX = 50;

/**
 * The version of the English Terms of use a person accepts: the English
 * Terms text's own (spec 12.2), "pre-counsel" until counsel's text is in.
 * Translations never change it; a new English version does, and asks
 * everyone again. UNVERSIONED_TERMS only if the text had no version.
 */
export const UNVERSIONED_TERMS = "unversioned";
export function currentTermsVersion(): string {
  return getLegal("terms", "en")?.version.trim() || UNVERSIONED_TERMS;
}

/** What a complete profile is measured against. */
export interface ProfileRules {
  termsVersion: string;
  consent: ProfileConsent;
}

/** The rules in force: the current Terms version and PROFILE_CONSENT. */
export function profileRules(env: Env = process.env): ProfileRules {
  return { termsVersion: currentTermsVersion(), consent: profileConsent(env) };
}

/** The stored answers a complete profile needs. */
export interface StoredProfileAnswers {
  country: string | null;
  termsVersion: string | null;
  ageConfirmedAt: Date | null;
  consentAt: Date | null;
}

/**
 * Has this person completed the profile step, for the rules in force? A name
 * that isn't blank, a country, the current Terms version, the age rule
 * confirmed and, only when consent is required, the consent.
 */
export function isProfileComplete(
  user: { name: string | null } | null,
  profile: StoredProfileAnswers | null,
  rules: ProfileRules
): boolean {
  if (!user || !profile) return false;
  if (!user.name || !user.name.trim()) return false;
  if (!profile.country || !isCountry(profile.country)) return false;
  if (profile.termsVersion !== rules.termsVersion) return false;
  if (!profile.ageConfirmedAt) return false;
  if (rules.consent === "required" && !profile.consentAt) return false;
  return true;
}

/** The age of digital consent per country (AGE_RULE=digital-consent). */
const DIGITAL_CONSENT_AGE: Record<Country, number> = { BE: 13, CY: 14, GR: 15, DE: 16, OTHER: 16 };

/** The minimum age the profile step asks a self-registered person to confirm, for `country`. */
export function minimumAgeFor(country: Country | null, env: Env = process.env): number {
  const rule = ageRuleSetting(env);
  if (rule.kind === "fixed") return rule.age;
  return DIGITAL_CONSENT_AGE[country ?? "OTHER"];
}

/** What the profile step's form sends. Anything else is ignored. */
export interface ProfileInput {
  name?: unknown;
  country?: unknown;
  termsAccepted?: unknown;
  age?: unknown;
  consent?: unknown;
}

/** What the stored profile says about this submission (never the request). */
export interface ProfileContext {
  /** The profile step was completed before (profileCompletedAt set). */
  completed: boolean;
  /** The stored name is blank, so a name is asked for. */
  nameRequired: boolean;
  /** The stored Terms version is the current one. */
  termsCurrent: boolean;
  /** An admin or partner admin recorded a guardian's permission (spec 5.6). */
  guardianConsentRecorded: boolean;
  /** PROFILE_CONSENT. */
  consent: ProfileConsent;
}

export type ProfileField = "name" | "country" | "terms" | "age" | "consent";
export type ProfileError =
  | "empty"
  | "too-long"
  | "invalid"
  | "required"
  | "not-invited";

export interface ProfileValues {
  /** Trimmed; only when a name was asked for. */
  name?: string;
  /** First completion only. */
  country?: Country;
  /** True when the Terms were accepted with this submission. */
  termsAccepted: boolean;
  /** First completion only. */
  age?: "self" | "invited";
  /** Only with PROFILE_CONSENT optional or required. */
  consent?: boolean;
}

export type ParsedProfile =
  | { ok: true; value: ProfileValues }
  | { ok: false; errors: Partial<Record<ProfileField, ProfileError>> };

/** Control characters and line or paragraph separators: never in a name. */
const NOT_IN_A_NAME = /[\p{Cc}\p{Zl}\p{Zp}]/u;

function parseName(raw: unknown): { name?: string; error?: ProfileError } {
  if (raw === undefined || raw === null) return { error: "empty" };
  if (typeof raw !== "string") return { error: "invalid" };
  const name = raw.trim();
  if (!name) return { error: "empty" };
  if ([...name].length > NAME_MAX) return { error: "too-long" };
  if (NOT_IN_A_NAME.test(name)) return { error: "invalid" };
  return { name };
}

/**
 * Reads a profile step submission for the person `ctx` describes. Only the
 * fields the mode reads are looked at; each refusal is named per field.
 */
export function parseProfileInput(raw: unknown, ctx: ProfileContext): ParsedProfile {
  const input: ProfileInput = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as ProfileInput) : {};
  const errors: Partial<Record<ProfileField, ProfileError>> = {};
  const value: ProfileValues = { termsAccepted: input.termsAccepted === true };

  if (ctx.nameRequired) {
    const { name, error } = parseName(input.name);
    if (error) errors.name = error;
    else value.name = name;
  }

  if (!ctx.completed) {
    if (isCountry(input.country)) value.country = input.country;
    else errors.country = "empty";

    if (input.age === "self") value.age = "self";
    else if (input.age === "invited") {
      if (ctx.guardianConsentRecorded) value.age = "invited";
      else errors.age = "not-invited";
    } else errors.age = "required";
  }

  // The Terms: always on the first completion; later only when they changed.
  if ((!ctx.completed || !ctx.termsCurrent) && !value.termsAccepted) errors.terms = "required";

  if (ctx.consent !== "off") {
    value.consent = input.consent === true;
    if (ctx.consent === "required" && !value.consent) errors.consent = "required";
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}
