/**
 * Release 3 (D93, spec 11.2): who a learner can contact for help, per
 * country. The contacts are an admin setting in the database
 * (Project.safeguarding), edited on /admin/safeguarding without a deploy:
 * up to three per country, the partner organisation's contact and help
 * lines, "Other" with its own. 112 lives here, in code, never in the
 * setting, so nothing can remove it.
 *
 * The setting is untrusted JSON, read leniently (parseSafeguarding: what
 * isn't valid is left out, never shown) and written strictly
 * (validateSafeguarding: every field checked, a reason per field). Every
 * text is plain text, capped (200 characters; notes 500); a phone is digits
 * (E.164 with "+", or a short national number such as 116 111), an email an
 * address, a web address https only.
 *
 * contactsFor(country) is what the box beside a learner's pages lists: the
 * contacts of the learner's own country; everyone's when there is no country
 * (a guest, a profile not yet complete). helpGroups(country) is /help's:
 * every country, the learner's own first. Within a country the
 * organisation's contact comes before help lines.
 *
 * Pure (type-only imports and the country list), so client components can
 * use it too.
 */

import { COUNTRIES, isCountry, type Country } from "@/lib/countries";

/** The emergency number, in code: it always shows. */
export const EMERGENCY_NUMBER = "112";
export const MAX_CONTACTS_PER_COUNTRY = 3;
export const TEXT_MAX = 200;
export const NOTE_MAX = 500;

export const CONTACT_KINDS = ["organisation", "helpline"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/** Text that may differ by the page's language; English is shown where a language has none. */
export type ContactText = Partial<Record<"en" | "de" | "el", string>>;
const TEXT_LANGUAGES = ["en", "de", "el"] as const;

export interface SafeguardingContact {
  kind: ContactKind;
  /** The organisation or service, e.g. "Pro Arbeit" or "Nummer gegen Kummer". */
  organisation: string;
  /** A role, never a named person where a role will do (S3), e.g. "Safeguarding lead". */
  role?: string;
  phone?: string;
  email?: string;
  url?: string;
  hours?: ContactText;
  note?: ContactText;
}

export type ContactsByCountry = Partial<Record<Country, SafeguardingContact[]>>;

/** Project.safeguarding as stored. */
export interface SafeguardingSetting {
  v: 1;
  contacts: ContactsByCountry;
  /** When an admin last saved it (ISO), or null. */
  updatedAt: string | null;
}

export const EMPTY_SAFEGUARDING: SafeguardingSetting = { v: 1, contacts: {}, updatedAt: null };

export type ContactField = "kind" | "organisation" | "role" | "phone" | "email" | "url" | "hours" | "note" | "reach";
export type ContactProblem = "required" | "too-long" | "invalid" | "too-many";

/** One reason a save is refused: the country, the entry (0-based; null for the country itself) and the field. */
export interface ContactError {
  country: Country;
  index: number | null;
  field: ContactField | null;
  problem: ContactProblem;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** One line of plain text: control characters and runs of spaces become one space. */
function line(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim() : "";
}

const PHONE = /^\+?[0-9](?:[0-9 ]{0,22}[0-9])?$/;
const EMAIL = /^[^\s@<>()"',;:\\[\]]+@[^\s@<>()"',;:\\[\]]+\.[^\s@<>()"',;:\\[\]]+$/;

/** A phone number as entered: "+" first if at all, digits and spaces, 3 to 15 digits. */
export function validPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "").length;
  return PHONE.test(phone) && digits >= 3 && digits <= 15;
}

/** The tel: address of a phone number: digits and "+" only. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, "")}`;
}

export const validEmail = (email: string) => email.length <= TEXT_MAX && EMAIL.test(email);

/** An https address, normalised, or null. */
export function httpsUrl(url: string): string | null {
  if (!/^https:\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.includes(".") && !parsed.username && !parsed.password
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

type FieldCheck<T> = { value?: T; problem?: ContactProblem };

function checkText(raw: unknown, max: number): FieldCheck<string> {
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw !== "string") return { problem: "invalid" };
  const value = line(raw);
  if (!value) return {};
  return value.length > max ? { problem: "too-long" } : { value };
}

function checkLocalized(raw: unknown, max: number): FieldCheck<ContactText> {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) return { problem: "invalid" };
  const value: ContactText = {};
  for (const [lang, text] of Object.entries(raw)) {
    if (!(TEXT_LANGUAGES as readonly string[]).includes(lang)) return { problem: "invalid" };
    const checked = checkText(text, max);
    if (checked.problem) return { problem: checked.problem };
    if (checked.value) value[lang as keyof ContactText] = checked.value;
  }
  return Object.keys(value).length ? { value } : {};
}

/** One contact, checked field by field. */
function checkContact(raw: unknown): { contact?: SafeguardingContact; problems: [ContactField, ContactProblem][] } {
  if (!isRecord(raw)) return { problems: [["organisation", "invalid"]] };
  const problems: [ContactField, ContactProblem][] = [];
  const kind = raw.kind;
  if (!(CONTACT_KINDS as readonly unknown[]).includes(kind)) problems.push(["kind", "invalid"]);
  const organisation = checkText(raw.organisation, TEXT_MAX);
  if (organisation.problem) problems.push(["organisation", organisation.problem]);
  else if (!organisation.value) problems.push(["organisation", "required"]);
  const role = checkText(raw.role, TEXT_MAX);
  if (role.problem) problems.push(["role", role.problem]);
  const phone = checkText(raw.phone, TEXT_MAX);
  if (phone.problem) problems.push(["phone", phone.problem]);
  else if (phone.value && !validPhone(phone.value)) problems.push(["phone", "invalid"]);
  const email = checkText(raw.email, TEXT_MAX);
  if (email.problem) problems.push(["email", email.problem]);
  else if (email.value && !validEmail(email.value)) problems.push(["email", "invalid"]);
  const url = checkText(raw.url, TEXT_MAX);
  const href = url.value ? httpsUrl(url.value) : null;
  if (url.problem) problems.push(["url", url.problem]);
  else if (url.value && !href) problems.push(["url", "invalid"]);
  const hours = checkLocalized(raw.hours, TEXT_MAX);
  if (hours.problem) problems.push(["hours", hours.problem]);
  const note = checkLocalized(raw.note, NOTE_MAX);
  if (note.problem) problems.push(["note", note.problem]);
  // A contact no one can reach is no contact.
  if (!phone.value && !email.value && !url.value && !phone.problem && !email.problem && !url.problem) {
    problems.push(["reach", "required"]);
  }
  if (problems.length) return { problems };
  return {
    problems,
    contact: {
      kind: kind as ContactKind,
      organisation: organisation.value!,
      ...(role.value ? { role: role.value } : {}),
      ...(phone.value ? { phone: phone.value } : {}),
      ...(email.value ? { email: email.value } : {}),
      ...(href ? { url: href } : {}),
      ...(hours.value ? { hours: hours.value } : {}),
      ...(note.value ? { note: note.value } : {}),
    },
  };
}

/**
 * The contacts an admin sends, checked strictly: a list of up to three per
 * country, each valid. Countries left out have none. Refused with every
 * reason, by country, entry and field.
 */
export function validateSafeguarding(
  input: unknown
): { ok: true; contacts: ContactsByCountry } | { ok: false; errors: ContactError[] } {
  if (!isRecord(input)) return { ok: false, errors: [] };
  const errors: ContactError[] = [];
  const contacts: ContactsByCountry = {};
  for (const [country, list] of Object.entries(input)) {
    if (!isCountry(country) || !Array.isArray(list)) return { ok: false, errors: [] };
    if (list.length > MAX_CONTACTS_PER_COUNTRY) {
      errors.push({ country, index: null, field: null, problem: "too-many" });
      continue;
    }
    const checked = list.map((raw, index) => {
      const { contact, problems } = checkContact(raw);
      for (const [field, problem] of problems) errors.push({ country, index, field, problem });
      return contact;
    });
    const valid = checked.filter((c): c is SafeguardingContact => c !== undefined);
    if (valid.length) contacts[country] = valid;
  }
  return errors.length ? { ok: false, errors } : { ok: true, contacts };
}

/**
 * The stored setting, read leniently: an entry that isn't valid is left
 * out, a country keeps its first three, anything unreadable is empty.
 * Never throws.
 */
export function parseSafeguarding(raw: unknown): SafeguardingSetting {
  if (!isRecord(raw) || raw.v !== 1 || !isRecord(raw.contacts)) return EMPTY_SAFEGUARDING;
  const contacts: ContactsByCountry = {};
  for (const country of COUNTRIES) {
    const list = raw.contacts[country];
    if (!Array.isArray(list)) continue;
    const valid = list
      .map((entry) => checkContact(entry).contact)
      .filter((c): c is SafeguardingContact => c !== undefined)
      .slice(0, MAX_CONTACTS_PER_COUNTRY);
    if (valid.length) contacts[country] = valid;
  }
  const updatedAt = typeof raw.updatedAt === "string" && !Number.isNaN(Date.parse(raw.updatedAt)) ? raw.updatedAt : null;
  return { v: 1, contacts, updatedAt };
}

/** A country's contacts: the organisation's before help lines, otherwise as the admin ordered them. */
function ordered(list: readonly SafeguardingContact[] | undefined): SafeguardingContact[] {
  const rank = (c: SafeguardingContact) => (c.kind === "organisation" ? 0 : 1);
  return [...(list ?? [])].sort((a, b) => rank(a) - rank(b));
}

export interface CountryContacts {
  country: Country;
  contacts: SafeguardingContact[];
}

/**
 * What the box beside a learner's pages lists: the learner's own country's
 * contacts, or, with no country, every country that has some. Empty when
 * there are none: the box still shows 112 and the fallback line.
 */
export function contactsFor(setting: SafeguardingSetting, country: Country | null): CountryContacts[] {
  const countries = country ? [country] : COUNTRIES;
  return countries
    .map((c) => ({ country: c, contacts: ordered(setting.contacts[c]) }))
    .filter((g) => g.contacts.length > 0);
}

/** What /help lists: every country, the viewer's own first, each with its contacts (maybe none yet). */
export function helpGroups(setting: SafeguardingSetting, first: Country | null): CountryContacts[] {
  const order = first ? [first, ...COUNTRIES.filter((c) => c !== first)] : [...COUNTRIES];
  return order.map((c) => ({ country: c, contacts: ordered(setting.contacts[c]) }));
}

/** A contact's text in the page's language, else English, else any; with the language it is in. */
export function textIn(text: ContactText | undefined, locale: string): { text: string; lang: string } | undefined {
  if (!text) return undefined;
  for (const lang of [locale, "en", ...TEXT_LANGUAGES]) {
    const value = text[lang as keyof ContactText];
    if (value) return { text: value, lang };
  }
  return undefined;
}

/** What saving the contacts answers (actions/safeguarding.ts). */
export type SaveSafeguardingResult =
  | { ok: true; setting: SafeguardingSetting; changed: Country[] }
  | { ok: false; error: "forbidden" | "bad-input" }
  | { ok: false; error: "invalid"; errors: ContactError[] };

/** The countries whose contacts differ between two settings (for the audit row: never the contacts). */
export function changedCountries(before: ContactsByCountry, after: ContactsByCountry): Country[] {
  return COUNTRIES.filter((c) => JSON.stringify(before[c] ?? []) !== JSON.stringify(after[c] ?? []));
}
