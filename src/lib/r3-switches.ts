/**
 * Release 3's settings and kill switches (spec 15): server environment
 * variables, read on every call like Release 2's (cms/sections/switches.ts),
 * so a changed value takes effect on the next request of a redeploy.
 * Server-side only: the browser has no such variables.
 *
 *   R3_PARTNER_ACCESS=on       organisation-scoped staff (partner admins,
 *                              facilitators) see their organisation's
 *                              learners and people. Anything else: they see
 *                              none (scope "none"). ADMIN is unaffected (D77).
 *   R3_PROFILE_GATE=off        no redirect to the profile step, and staff
 *                              scope no longer needs a complete profile.
 *                              Learner membership still waits for it.
 *   PROFILE_CONSENT            off (default) | optional | required: the
 *                              separate unticked consent box (D78, Q16);
 *                              off, whatever it says, while the consent
 *                              text is a draft (its version starts
 *                              "draft-"): no one consents to a draft.
 *   AGE_RULE                   unset: 16 everywhere (Q18); a whole number
 *                              from 13: that age everywhere; digital-consent:
 *                              each country's age of digital consent.
 *   R3_LANGUAGE_READY=off      every language counts as ready for learners
 *                              (Release 2's field-by-field fallback, D90).
 *   R3_BLOB_DELETE=off         the admin run keeps queued course files (D92).
 *   R3_CSP=report-only         the content security policy only reports (D95).
 *
 * Each switch moves only for its exact word (any case, spaces ignored); an
 * unreadable PROFILE_CONSENT or AGE_RULE falls back to the default and says
 * so once in the log, without the value. STATS_FROM is read by
 * stats-from.ts and the demo sign-in settings by demo-gate.ts.
 */

import en from "@/messages/en.json";

type Env = Record<string, string | undefined>;

const word = (value: string | undefined) => value?.trim().toLowerCase() ?? "";

/** Values already reported as unreadable: each is logged once per server. */
const reported = new Set<string>();
function reportOnce(variable: string, value: string, fallback: string, log: (line: string) => void) {
  const key = `${variable}=${value}`;
  if (reported.has(key)) return;
  reported.add(key);
  // The value itself stays out of the log: only that it couldn't be read.
  log(`[settings] ${variable} can't be read; using the default, ${fallback}.`);
}

/** R3_PARTNER_ACCESS=on: organisation-scoped staff see their organisation (D77). Off unless "on". */
export function partnerAccessOn(env: Env = process.env): boolean {
  return word(env.R3_PARTNER_ACCESS) === "on";
}

/** The profile step is required (redirect, and complete profile for staff scope) unless R3_PROFILE_GATE=off. */
export function profileGateOn(env: Env = process.env): boolean {
  return word(env.R3_PROFILE_GATE) !== "off";
}

export type ProfileConsent = "off" | "optional" | "required";

/**
 * The version of the consent text (profile.consent.version, the same in
 * every language): what a consent records. It starts "draft-" until
 * counsel's wording is in.
 */
export const CONSENT_VERSION: string = en.profile.consent.version;

/**
 * PROFILE_CONSENT: whether the profile step shows the consent box, and
 * whether it must be ticked. Off while the consent text (`version`) is a
 * draft, with one line in the log.
 */
export function profileConsent(
  env: Env = process.env,
  log: (line: string) => void = console.warn,
  version: string = CONSENT_VERSION
): ProfileConsent {
  const value = word(env.PROFILE_CONSENT);
  if (value === "" || value === "off") return "off";
  if (value === "optional" || value === "required") {
    if (!version.startsWith("draft-")) return value;
    if (!reported.has("PROFILE_CONSENT:draft")) {
      reported.add("PROFILE_CONSENT:draft");
      log("[settings] PROFILE_CONSENT is set, but the consent text is still a draft; the consent box stays off.");
    }
    return "off";
  }
  reportOnce("PROFILE_CONSENT", value, "off", log);
  return "off";
}

/** The age rule the profile step asks for (Q18). */
export type AgeRuleSetting = { kind: "fixed"; age: number } | { kind: "digital-consent" };

export const DEFAULT_MINIMUM_AGE = 16;

/** AGE_RULE: unset → 16 everywhere; a whole number from 13 → that; "digital-consent" → per country. */
export function ageRuleSetting(env: Env = process.env, log: (line: string) => void = console.warn): AgeRuleSetting {
  const value = word(env.AGE_RULE);
  if (value === "") return { kind: "fixed", age: DEFAULT_MINIMUM_AGE };
  if (value === "digital-consent") return { kind: "digital-consent" };
  if (/^\d{1,2}$/.test(value) && Number(value) >= 13) return { kind: "fixed", age: Number(value) };
  reportOnce("AGE_RULE", value, String(DEFAULT_MINIMUM_AGE), log);
  return { kind: "fixed", age: DEFAULT_MINIMUM_AGE };
}

/** Learners get only the languages signed off for a course, unless R3_LANGUAGE_READY=off (D90). */
export function languageReadyOn(env: Env = process.env): boolean {
  return word(env.R3_LANGUAGE_READY) !== "off";
}

/** The admin run deletes queued course files, unless R3_BLOB_DELETE=off (D92). */
export function blobDeleteOn(env: Env = process.env): boolean {
  return word(env.R3_BLOB_DELETE) !== "off";
}

/** The content security policy only reports, with R3_CSP=report-only (D95; read at build time). */
export function cspReportOnly(env: Env = process.env): boolean {
  return word(env.R3_CSP) === "report-only";
}
