"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { completeProfile } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { COUNTRIES, type Country } from "@/lib/countries";
import { NAME_MAX, type ProfileError, type ProfileField } from "@/lib/profile";
import type { ProfileConsent } from "@/lib/r3-switches";

/** What the profile step's page read for the form (welcome/page.tsx). */
export interface ProfileStepView {
  /** The first completion is done: only the Terms, a blank name and consent are asked. */
  completed: boolean;
  /** Done before, under an older Terms version. */
  termsChanged: boolean;
  /** No name stored: asked for, also after a completion. */
  nameRequired: boolean;
  /** An earlier answer. */
  country: Country | null;
  /** Holds a staff role: what learners are told about who sees their data isn't for them. */
  staff: boolean;
  /** The organisation the profile already has (set by an admin or a partner admin). */
  organisation: { id: string; name: string; byPartnerAdmin: boolean } | null;
  /** An inviter recorded a guardian's permission: the invited statement is offered (spec 5.6). */
  invited: boolean;
  /** Which organisation supports each country (the country mapping). */
  mapping: Partial<Record<Country, { id: string; name: string }>>;
  /** The minimum age a self-registered person confirms, per country (AGE_RULE). */
  minAge: Record<Country, number>;
  /** PROFILE_CONSENT. */
  consent: ProfileConsent;
  /** A consent stored already (shown ticked). */
  consentGiven: boolean;
  /** Consent is required and none is stored. */
  consentMissing: boolean;
}

type Errors = Partial<Record<ProfileField, ProfileError>>;

/** The field each error links to, in the form's order. */
const FIELD_ORDER: ProfileField[] = ["name", "country", "age", "terms", "consent"];
const fieldId = (field: ProfileField) => `profile-${field}`;
const errorId = (field: ProfileField) => `profile-${field}-error`;

/**
 * The age statement the form asks a person to tick, for the country
 * picked: the minimum age it names (AGE_RULE may set one per country), or
 * the invited statement, which names none. A tick holds only for the
 * statement it was given for, so picking a country with another minimum
 * age asks again rather than sending a statement never ticked.
 */
export function ageStatementOf(view: Pick<ProfileStepView, "invited" | "minAge">, country: Country | null): string {
  return view.invited ? "invited" : `self-${view.minAge[country ?? "OTHER"]}`;
}

/**
 * Release 3 (D78, spec 5.4): the profile step's form, in the spec's order:
 * a name (whenever none is stored), the country (first time only), the age
 * statement (first time only), the Terms, the privacy notice (a link, not
 * a box), a separate unticked consent box (only with PROFILE_CONSENT), and
 * Continue. After a new Terms version only the Terms box is shown (and a
 * name or the consent, when those are missing too).
 *
 * What is said about who sees the person's data depends on their profile,
 * never on the country alone: nothing for staff; the organisation the
 * profile already has (a partner admin's, released when the country maps
 * elsewhere: setUpByMismatch says so, then who sees what without an
 * organisation); otherwise the organisation the picked country maps to.
 *
 * Errors are listed above the form in an alert named by its heading, each
 * linked to its field, and focus goes to the list; each field is
 * aria-invalid and described by its message. The age tick counts only for
 * the statement shown when it was ticked (ageStatementOf). Done, the page
 * is loaded afresh at the hub (a full navigation: the session and the
 * learner store start again).
 */
export function ProfileStepForm({ view }: { view: ProfileStepView }) {
  const t = useTranslations("profile");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const ids = React.useId();

  const [name, setName] = React.useState("");
  const [country, setCountry] = React.useState<Country | null>(view.country);
  // The age statement ticked (ageStatementOf), or none.
  const [ageTicked, setAgeTicked] = React.useState<string | null>(null);
  const [terms, setTerms] = React.useState(false);
  const [consent, setConsent] = React.useState(view.consentGiven);
  const [errors, setErrors] = React.useState<Errors>({});
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const summaryRef = React.useRef<HTMLDivElement>(null);
  // Focus moves to the list once it is on screen with the new errors.
  const [shown, setShown] = React.useState(0);
  React.useEffect(() => {
    if (shown) summaryRef.current?.focus();
  }, [shown]);

  const askName = view.nameRequired;
  const askCountry = !view.completed;
  const askAge = !view.completed;
  const askTerms = !view.completed || view.termsChanged;
  const askConsent = view.consent !== "off" && (!view.completed || view.consentMissing);

  const organisationName = view.organisation?.name ?? tCommon("appName");
  const minAge = view.minAge[country ?? "OTHER"];
  const ageStatement = ageStatementOf(view, country);
  const age = ageTicked === ageStatement;

  const messageOf = (field: ProfileField, error: ProfileError): string => {
    switch (field) {
      case "name":
        return error === "too-long"
          ? t("name.tooLong", { max: NAME_MAX })
          : error === "invalid"
            ? t("name.invalid")
            : t("name.empty");
      case "country":
        return t("country.empty");
      case "age":
        return error === "not-invited" ? t("age.notInvited") : t("age.required");
      case "terms":
        return t("terms.required");
      case "consent":
        return t("consent.required");
    }
  };
  const listed = FIELD_ORDER.filter((f) => errors[f]);
  const invalid = (field: ProfileField) => (errors[field] ? { "aria-invalid": true as const } : {});
  const describedBy = (field: ProfileField, ...more: (string | false)[]) =>
    [...more.filter(Boolean), errors[field] ? errorId(field) : false].filter(Boolean).join(" ") || undefined;

  /** The sentence about who sees the person's data, for the country picked. */
  const whoSees = (() => {
    if (view.staff || !askCountry) return null;
    const mapped = country ? view.mapping[country] : undefined;
    if (view.organisation) {
      if (view.organisation.byPartnerAdmin && country && mapped?.id !== view.organisation.id) {
        // Released until DIESIS checks: what anyone without an organisation is told.
        return `${t("setUpByMismatch", { organisation: view.organisation.name, country })} ${t("whoSeesNoOrganisation")}`;
      }
      return t("whoSees", { organisation: view.organisation.name });
    }
    if (!country) return null;
    return mapped ? t("whoSees", { organisation: mapped.name }) : t("whoSeesNoOrganisation");
  })();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const answer = await completeProfile({
        ...(askName ? { name } : {}),
        ...(askCountry ? { country: country ?? undefined } : {}),
        ...(askAge && age ? { age: view.invited ? "invited" : "self" } : {}),
        termsAccepted: askTerms ? terms : false,
        ...(askConsent ? { consent } : {}),
      });
      if (answer.ok) {
        // A full navigation: the session and the learner store start again.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full page load, on purpose
        window.location.assign(`/${locale}`);
        return;
      }
      if ("errors" in answer) {
        setErrors(answer.errors);
        setShown((n) => n + 1);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    }
    setPending(false);
  }

  const errorLine = (field: ProfileField) =>
    errors[field] ? (
      <p id={errorId(field)} className="mt-1.5 text-sm font-medium text-[var(--danger)]">
        {messageOf(field, errors[field]!)}
      </p>
    ) : null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <Card>
        <CardContent className="p-6 sm:p-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t("title")}</h1>
          {!view.completed ? (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t("intro")}</p>
          ) : null}
          {view.termsChanged ? <p className="mt-3 text-sm">{t("termsChanged")}</p> : null}

          {listed.length ? (
            <div
              ref={summaryRef}
              tabIndex={-1}
              role="alert"
              aria-labelledby={`${ids}-errors`}
              className="mt-5 rounded-lg border border-[var(--danger)]/50 bg-[var(--danger)]/5 p-4 outline-none focus:ring-2 focus:ring-[var(--ring)]"
            >
              <h2 id={`${ids}-errors`} className="text-sm font-semibold">
                {t("errors")}
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {listed.map((field) => (
                  <li key={field}>
                    <a
                      href={`#${fieldId(field)}`}
                      className="underline text-[var(--danger)]"
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(fieldId(field))?.focus();
                      }}
                    >
                      {messageOf(field, errors[field]!)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <form noValidate onSubmit={submit} className="mt-6 space-y-6">
            {askName ? (
              <div>
                <label htmlFor={fieldId("name")} className="block text-sm font-medium">
                  {t("name.label")}
                </label>
                <p id={`${ids}-name-hint`} className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {t("name.hint")}
                </p>
                <input
                  id={fieldId("name")}
                  type="text"
                  autoComplete="given-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-describedby={describedBy("name", `${ids}-name-hint`)}
                  {...invalid("name")}
                  className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[var(--ring)] aria-[invalid=true]:border-[var(--danger)]"
                />
                {errorLine("name")}
              </div>
            ) : null}

            {askCountry ? (
              <div>
                {view.organisation && !view.staff ? (
                  <p className="mb-3 text-sm">{t("setUpBy", { organisation: view.organisation.name })}</p>
                ) : null}
                <fieldset aria-describedby={describedBy("country")}>
                  <legend className="text-sm font-medium">{t("country.legend")}</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {COUNTRIES.map((c, i) => (
                      <label
                        key={c}
                        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--accent)]/5"
                      >
                        <input
                          // The error list links the group's first choice.
                          id={i === 0 ? fieldId("country") : undefined}
                          type="radio"
                          name="country"
                          value={c}
                          checked={country === c}
                          onChange={() => setCountry(c)}
                          {...invalid("country")}
                          className="h-4 w-4"
                        />
                        {t(`country.${c}`)}
                      </label>
                    ))}
                  </div>
                  {errorLine("country")}
                </fieldset>
                <div aria-live="polite">
                  {whoSees ? <p className="mt-3 text-sm text-[var(--muted-foreground)]">{whoSees}</p> : null}
                </div>
              </div>
            ) : null}

            {askAge ? (
              <div>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    id={fieldId("age")}
                    type="checkbox"
                    checked={age}
                    onChange={(e) => setAgeTicked(e.target.checked ? ageStatement : null)}
                    aria-describedby={describedBy("age", !view.invited && errors.age === "required" && `${ids}-younger`)}
                    {...invalid("age")}
                    className="mt-0.5 h-4 w-4 flex-shrink-0"
                  />
                  <span>
                    {view.invited
                      ? t("age.invited", { organisation: organisationName })
                      : t("age.self", { minAge })}
                  </span>
                </label>
                {errorLine("age")}
                {!view.invited && errors.age === "required" ? (
                  <p id={`${ids}-younger`} className="mt-1.5 text-sm">
                    {t.rich("age.younger", { minAge, account: (chunks) => <NewTab href="/account">{chunks}</NewTab> })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {askTerms ? (
              <div>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    id={fieldId("terms")}
                    type="checkbox"
                    checked={terms}
                    onChange={(e) => setTerms(e.target.checked)}
                    aria-describedby={describedBy("terms")}
                    {...invalid("terms")}
                    className="mt-0.5 h-4 w-4 flex-shrink-0"
                  />
                  <span>{t.rich("terms.label", { terms: (chunks) => <NewTab href="/legal/terms">{chunks}</NewTab> })}</span>
                </label>
                {errorLine("terms")}
              </div>
            ) : null}

            {!view.completed ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                {t.rich("privacy", { privacy: (chunks) => <NewTab href="/legal/privacy">{chunks}</NewTab> })}
              </p>
            ) : null}

            {askConsent ? (
              <div>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    id={fieldId("consent")}
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    aria-describedby={describedBy("consent")}
                    {...invalid("consent")}
                    className="mt-0.5 h-4 w-4 flex-shrink-0"
                  />
                  <span>{t.rich("consent.label", { privacy: (chunks) => <NewTab href="/legal/privacy">{chunks}</NewTab> })}</span>
                </label>
                {errorLine("consent")}
              </div>
            ) : null}

            {failed ? (
              <p role="alert" className="text-sm font-medium text-[var(--danger)]">
                {t("failed")}
              </p>
            ) : null}

            <Button type="submit" size="lg" aria-disabled={pending || undefined}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/** A link that opens in a new tab, so what is typed on the form stays. */
function NewTab({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} target="_blank" rel="noopener" className="underline hover:text-[var(--foreground)]">
      {children}
    </Link>
  );
}
