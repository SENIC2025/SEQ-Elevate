"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { saveSafeguardingContacts } from "@/app/actions/safeguarding";
import { COUNTRIES, type Country } from "@/lib/countries";
import {
  CONTACT_KINDS,
  MAX_CONTACTS_PER_COUNTRY,
  NOTE_MAX,
  TEXT_MAX,
  type ContactError,
  type ContactField,
  type ContactKind,
  type ContactText,
  type ContactsByCountry,
  type SafeguardingContact,
  type SafeguardingSetting,
} from "@/lib/safeguarding";
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";

/*
 * /admin/safeguarding's form (D93, spec 11.2): five countries, up to three
 * contacts each (the partner organisation's contact and help lines), one
 * Save for all of them. ADMINs only (the page shows it to them; the server
 * refuses anyone else). A refused save lists every problem at the top, each
 * linked to its field, and marks the fields; nothing is saved until all are
 * right. English, like the other staff screens.
 */

export const COUNTRY_NAMES: Record<Country, string> = {
  DE: "Germany",
  CY: "Cyprus",
  BE: "Belgium",
  GR: "Greece",
  OTHER: "Other countries",
};
const KIND_NAMES: Record<ContactKind, string> = { organisation: "Organisation contact", helpline: "Help line" };
const LANGUAGES = [
  ["en", "English"],
  ["de", "German"],
  ["el", "Greek"],
] as const;

type TextDraft = Record<"en" | "de" | "el", string>;
interface Draft {
  /** Stable while the entry is on the screen: React's key, and its fields' ids. */
  key: number;
  kind: ContactKind;
  organisation: string;
  role: string;
  phone: string;
  email: string;
  url: string;
  hours: TextDraft;
  note: TextDraft;
}
type Drafts = Record<Country, Draft[]>;

const textDraft = (t?: ContactText): TextDraft => ({ en: t?.en ?? "", de: t?.de ?? "", el: t?.el ?? "" });
const toDraft = (key: number, c?: SafeguardingContact): Draft => ({
  key,
  kind: c?.kind ?? "organisation",
  organisation: c?.organisation ?? "",
  role: c?.role ?? "",
  phone: c?.phone ?? "",
  email: c?.email ?? "",
  url: c?.url ?? "",
  hours: textDraft(c?.hours),
  note: textDraft(c?.note),
});
/** The saved contacts as drafts, keyed by their place (the same on the server and in the browser). */
const draftsOf = (contacts: ContactsByCountry): Drafts =>
  Object.fromEntries(COUNTRIES.map((c) => [c, (contacts[c] ?? []).map((contact, i) => toDraft(i, contact))])) as Drafts;

/** What the server is sent: the fields as typed (it trims and checks them), empty ones left out. */
function payload(drafts: Drafts): Record<string, unknown[]> {
  const text = (t: TextDraft) => {
    const out = Object.fromEntries(Object.entries(t).filter(([, v]) => v.trim()));
    return Object.keys(out).length ? out : undefined;
  };
  return Object.fromEntries(
    COUNTRIES.filter((c) => drafts[c].length).map((c) => [
      c,
      drafts[c].map((d) => ({
        kind: d.kind,
        organisation: d.organisation,
        ...(d.role.trim() ? { role: d.role } : {}),
        ...(d.phone.trim() ? { phone: d.phone } : {}),
        ...(d.email.trim() ? { email: d.email } : {}),
        ...(d.url.trim() ? { url: d.url } : {}),
        ...(text(d.hours) ? { hours: text(d.hours) } : {}),
        ...(text(d.note) ? { note: text(d.note) } : {}),
      })),
    ])
  );
}

const FIELD_NAMES: Record<ContactField, string> = {
  kind: "kind",
  organisation: "organisation or service",
  role: "role",
  phone: "phone",
  email: "email",
  url: "website",
  hours: "hours",
  note: "note",
  reach: "phone, email or website",
};

/** One problem, in words. */
export function problemText(e: ContactError): string {
  const where = `${COUNTRY_NAMES[e.country]}${e.index === null ? "" : `, contact ${e.index + 1}`}`;
  switch (e.problem) {
    case "too-many":
      return `${where}: up to ${MAX_CONTACTS_PER_COUNTRY} contacts per country.`;
    case "required":
      return e.field === "reach"
        ? `${where}: give a phone number, an email address or a website.`
        : `${where}: enter the ${FIELD_NAMES[e.field ?? "organisation"]}.`;
    case "too-long":
      return `${where}: the ${FIELD_NAMES[e.field ?? "organisation"]} is too long (at most ${e.field === "note" ? NOTE_MAX : TEXT_MAX} characters).`;
    case "invalid":
      switch (e.field) {
        case "phone":
          return `${where}: write the phone number in digits, with + first for an international number (e.g. +49 30 1234567 or 116 111).`;
        case "email":
          return `${where}: the email isn't an email address.`;
        case "url":
          return `${where}: the website must start with https://.`;
        case "kind":
          return `${where}: choose organisation contact or help line.`;
        default:
          return `${where}: the ${FIELD_NAMES[e.field ?? "organisation"]} can't be used.`;
      }
  }
}

export function SafeguardingEditor({ initial }: { initial: SafeguardingSetting }) {
  const uid = React.useId();
  const [drafts, setDrafts] = React.useState<Drafts>(() => draftsOf(initial.contacts));
  const [savedAt, setSavedAt] = React.useState(initial.updatedAt);
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<ContactError[]>([]);
  const [result, setResult] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const summaryRef = React.useRef<HTMLDivElement>(null);
  // Keys for entries added here: past any a country can hold when loaded.
  const added = React.useRef(MAX_CONTACTS_PER_COUNTRY);

  const idOf = (country: Country, key: number, field: string) => `${uid}-${country}-${key}-${field}`;
  const fieldErrors = (country: Country, index: number, field: ContactField) =>
    errors.filter((e) => e.country === country && e.index === index && e.field === field);

  const update = (country: Country, key: number, patch: Partial<Draft>) =>
    setDrafts((all) => ({ ...all, [country]: all[country].map((d) => (d.key === key ? { ...d, ...patch } : d)) }));
  const add = (country: Country) => {
    const key = added.current++;
    setDrafts((all) => ({
      ...all,
      [country]: [
        ...all[country],
        { ...toDraft(key), kind: all[country].some((d) => d.kind === "organisation") ? "helpline" : "organisation" },
      ],
    }));
  };
  const remove = (country: Country, key: number) =>
    setDrafts((all) => ({ ...all, [country]: all[country].filter((d) => d.key !== key) }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setResult(null);
    let res: Awaited<ReturnType<typeof saveSafeguardingContacts>>;
    try {
      res = await saveSafeguardingContacts(payload(drafts));
    } catch {
      setPending(false);
      setResult({ kind: "error", text: "There was no answer from the server. Reload the page to see whether the contacts were saved." });
      return;
    }
    setPending(false);
    if (res.ok) {
      setErrors([]);
      setDrafts(draftsOf(res.setting.contacts));
      setSavedAt(res.setting.updatedAt);
      setResult({
        kind: "ok",
        text: res.changed.length
          ? `Saved: ${res.changed.map((c) => COUNTRY_NAMES[c]).join(", ")}. Learners see the contacts on their next page.`
          : "Nothing had changed.",
      });
      return;
    }
    if (res.error === "invalid") {
      setErrors(res.errors);
      // The list of problems takes the focus, so it is read out first.
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setErrors([]);
    setResult({
      kind: "error",
      text: res.error === "forbidden" ? "Only an admin saves the safeguarding contacts." : "Something went wrong. Reload the page.",
    });
  }

  const input = "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
  const invalid = "border-[var(--danger)]";

  /** A text field with its label, hint and errors. */
  const field = (
    country: Country,
    d: Draft,
    index: number,
    name: "organisation" | "role" | "phone" | "email" | "url",
    label: string,
    opts: { type?: string; hint?: string; required?: boolean; autoComplete?: string } = {}
  ) => {
    const id = idOf(country, d.key, name);
    const problems = [...fieldErrors(country, index, name), ...(name === "phone" ? fieldErrors(country, index, "reach") : [])];
    const described = [opts.hint ? `${id}-hint` : null, problems.length ? `${id}-error` : null].filter(Boolean).join(" ");
    return (
      <div>
        <label htmlFor={id} className="block text-xs font-medium mb-1">
          {label}
          {opts.required ? <span aria-hidden="true"> *</span> : null}
        </label>
        <input
          id={id}
          type={opts.type ?? "text"}
          value={d[name]}
          required={opts.required}
          autoComplete={opts.autoComplete ?? "off"}
          onChange={(e) => update(country, d.key, { [name]: e.target.value })}
          aria-invalid={problems.length ? true : undefined}
          aria-describedby={described || undefined}
          className={`${input} ${problems.length ? invalid : ""}`}
        />
        {opts.hint ? (
          <p id={`${id}-hint`} className="mt-1 text-xs text-[var(--muted-foreground)]">
            {opts.hint}
          </p>
        ) : null}
        {problems.length ? (
          <p id={`${id}-error`} className="mt-1 text-xs text-[var(--danger)]">
            {problems.map(problemText).join(" ")}
          </p>
        ) : null}
      </div>
    );
  };

  /** Hours or a note, in each language. */
  const texts = (country: Country, d: Draft, index: number, name: "hours" | "note", legend: string) => {
    const problems = fieldErrors(country, index, name);
    const errorId = idOf(country, d.key, `${name}-error`);
    return (
      <fieldset aria-describedby={problems.length ? errorId : undefined}>
        <legend className="text-xs font-medium mb-1">{legend}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {LANGUAGES.map(([lang, language]) => {
            const id = idOf(country, d.key, `${name}-${lang}`);
            return (
              <div key={lang}>
                <label htmlFor={id} className="block text-xs text-[var(--muted-foreground)] mb-0.5">
                  {language}
                </label>
                <input
                  id={id}
                  value={d[name][lang]}
                  onChange={(e) => update(country, d.key, { [name]: { ...d[name], [lang]: e.target.value } })}
                  aria-invalid={problems.length ? true : undefined}
                  className={`${input} ${problems.length ? invalid : ""}`}
                />
              </div>
            );
          })}
        </div>
        {problems.length ? (
          <p id={errorId} className="mt-1 text-xs text-[var(--danger)]">
            {problems.map(problemText).join(" ")}
          </p>
        ) : null}
      </fieldset>
    );
  };

  return (
    <form onSubmit={save} noValidate>
      {errors.length ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="mb-4 rounded-lg border border-[var(--danger)] px-4 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <p className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-[var(--danger)]" aria-hidden />
            Nothing was saved. Please check:
          </p>
          <ul className="mt-1 ml-5 list-disc">
            {errors.map((e, i) => {
              const d = e.index === null ? null : drafts[e.country][e.index];
              const target = d
                ? idOf(e.country, d.key, e.field === "reach" ? "phone" : e.field === "hours" || e.field === "note" ? `${e.field}-en` : e.field ?? "organisation")
                : `${uid}-${e.country}`;
              return (
                <li key={i}>
                  <a href={`#${target}`} className="underline underline-offset-2">
                    {problemText(e)}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="space-y-6">
        {COUNTRIES.map((country) => {
          const list = drafts[country];
          const countryProblems = errors.filter((e) => e.country === country && e.index === null);
          return (
            <Card key={country}>
              <CardContent className="p-4">
                <fieldset id={`${uid}-${country}`} tabIndex={-1} className="outline-none">
                  <legend className="text-base font-semibold">{COUNTRY_NAMES[country]}</legend>
                  {countryProblems.length ? (
                    <p className="mt-1 text-xs text-[var(--danger)]">{countryProblems.map(problemText).join(" ")}</p>
                  ) : null}
                  {list.length === 0 ? (
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      No contacts yet: learners from {country === "OTHER" ? "other countries" : COUNTRY_NAMES[country]} see 112 and
                      &ldquo;Talk to someone you trust at your partner organisation.&rdquo;
                    </p>
                  ) : null}
                  <ol className="mt-3 space-y-4">
                    {list.map((d, index) => (
                      <li key={d.key} className="rounded-lg border border-[var(--border)] p-3">
                        <fieldset>
                          <legend className="text-sm font-medium">
                            Contact {index + 1}
                            <span className="sr-only"> for {COUNTRY_NAMES[country]}</span>
                          </legend>
                          <div className="mt-2 grid gap-3 sm:grid-cols-2">
                            <div>
                              <label htmlFor={idOf(country, d.key, "kind")} className="block text-xs font-medium mb-1">
                                Kind
                              </label>
                              <select
                                id={idOf(country, d.key, "kind")}
                                value={d.kind}
                                onChange={(e) => update(country, d.key, { kind: e.target.value as ContactKind })}
                                className={input}
                              >
                                {CONTACT_KINDS.map((k) => (
                                  <option key={k} value={k}>
                                    {KIND_NAMES[k]}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {field(country, d, index, "organisation", "Organisation or service", { required: true })}
                            {field(country, d, index, "role", "Role", {
                              hint: "A role, such as “Safeguarding lead”, rather than a person's name.",
                            })}
                            {field(country, d, index, "phone", "Phone", { type: "tel", hint: "For example +49 30 1234567, or 116 111." })}
                            {field(country, d, index, "email", "Email", { type: "email", hint: "A team or role mailbox where you can." })}
                            {field(country, d, index, "url", "Website", { type: "url", hint: "Starts with https://" })}
                          </div>
                          <div className="mt-3 space-y-3">
                            {texts(country, d, index, "hours", "Hours (optional)")}
                            {texts(country, d, index, "note", "Note (optional)")}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={() => remove(country, d.key)}
                            aria-label={`Remove contact ${index + 1} for ${COUNTRY_NAMES[country]}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                            Remove
                          </Button>
                        </fieldset>
                      </li>
                    ))}
                  </ol>
                  {list.length < MAX_CONTACTS_PER_COUNTRY ? (
                    <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => add(country)}>
                      <Plus className="h-4 w-4" aria-hidden />
                      Add a contact for {COUNTRY_NAMES[country]}
                    </Button>
                  ) : (
                    <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                      {COUNTRY_NAMES[country]} has {MAX_CONTACTS_PER_COUNTRY} contacts, the most a country can have.
                    </p>
                  )}
                </fieldset>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Save contacts
        </Button>
        <p className="text-xs text-[var(--muted-foreground)]">
          {savedAt ? `Last saved ${new Date(savedAt).toLocaleString("en-GB", { timeZone: "Europe/Brussels" })} (Brussels).` : "Not saved yet."}
        </p>
      </div>
      <div role="status" aria-live="polite" className="mt-3">
        {result ? (
          <p className={`text-sm flex items-start gap-1.5 ${result.kind === "ok" ? "" : "text-[var(--danger)]"}`}>
            {result.kind === "ok" ? (
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5 text-[var(--accent)]" aria-hidden />
            ) : (
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden />
            )}
            {result.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}
