"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { setCountryMapping } from "@/app/actions/admin";
import { COUNTRIES, type Country } from "@/lib/countries";
import { AlertTriangle, CheckCircle2, Globe2, Loader2 } from "lucide-react";

/*
 * The country mapping (D73, Q24, spec 6.3): which partner organisation
 * supports learners from each country. A learner who picks a country in
 * the profile step joins the organisation it is mapped to; a country with
 * none gives no organisation, and only DIESIS and SENIC see those learners
 * until it is mapped. ADMINs only (the page shows it to them; the server
 * refuses anyone else).
 *
 * Mapping a country can also place the learners who already picked it and
 * have no organisation yet (assignUnplaced): ticked by default the first
 * time a country is mapped. Learners whose organisation the profile step
 * released for DIESIS to check are never placed this way.
 */

const COUNTRY_NAMES: Record<Country, string> = {
  DE: "Germany",
  CY: "Cyprus",
  BE: "Belgium",
  GR: "Greece",
  OTHER: "Other countries",
};

type Mapping = { country: Country; organisationId: string };

/** What a refused change means, in plain words. */
function errorText(error?: string): string {
  switch (error) {
    case "forbidden":
      return "Only an admin maps countries.";
    case "unknown-org":
      return "That organisation no longer exists. Reload the page.";
    case "bad-country":
      return "Choose a country.";
    case "no-answer":
      return "There was no answer from the server. Reload the page to see whether it was done.";
    default:
      return "Something went wrong.";
  }
}

export function CountryMappingPanel({
  mappings,
  organisations,
}: {
  mappings: Mapping[];
  organisations: { id: string; name: string }[];
}) {
  const router = useRouter();
  const ids = React.useId();
  // The mapping the last save returned, shown until the page's own is
  // rendered again (see actions/admin.ts).
  const [fresh, setFresh] = React.useState<{ from: Mapping[]; list: Mapping[] } | null>(null);
  const shown = fresh && fresh.from === mappings ? fresh.list : mappings;
  const mappedTo = (c: Country) => shown.find((m) => m.country === c)?.organisationId ?? "";
  // Each country's draft: the organisation picked, and the tick.
  const [drafts, setDrafts] = React.useState<Partial<Record<Country, { organisationId: string; place: boolean }>>>({});
  const draftFor = (c: Country) => drafts[c] ?? { organisationId: mappedTo(c), place: mappedTo(c) === "" };
  const setDraft = (c: Country, patch: Partial<{ organisationId: string; place: boolean }>) =>
    setDrafts((d) => ({ ...d, [c]: { ...draftFor(c), ...patch } }));
  const [pending, setPending] = React.useState<Country | null>(null);
  const [result, setResult] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function save(c: Country) {
    const d = draftFor(c);
    if (!d.organisationId) return;
    setPending(c);
    setResult(null);
    let res: Awaited<ReturnType<typeof setCountryMapping>>;
    try {
      res = await setCountryMapping(c, d.organisationId, { assignUnplaced: d.place });
    } catch {
      setResult({ kind: "error", text: errorText("no-answer") });
      setPending(null);
      return;
    }
    if (!res.ok) {
      setResult({ kind: "error", text: errorText(res.error) });
      setPending(null);
      return;
    }
    if (res.mappings) setFresh({ from: mappings, list: res.mappings });
    setDrafts((all) => {
      const next = { ...all };
      delete next[c];
      return next;
    });
    const org = organisations.find((o) => o.id === d.organisationId)?.name ?? "the organisation";
    setResult({
      kind: "ok",
      text:
        `${COUNTRY_NAMES[c]}: learners join ${org}.` +
        (d.place ? ` ${res.placed === 1 ? "1 learner" : `${res.placed} learners`} with no organisation joined it now.` : ""),
    });
    setPending(null);
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-1.5">
          <Globe2 className="h-4 w-4 text-[var(--accent)]" aria-hidden />
          Country mapping
        </h2>
        <p className="mb-3 text-xs text-[var(--muted-foreground)]">
          Which organisation supports learners from each country. A learner
          joins it when they pick the country at sign-up; until a country is
          mapped, only DIESIS and SENIC see its learners.
        </p>
        <div role="status" aria-live="polite">
          {result ? (
            <p
              className={`mb-3 text-sm flex items-start gap-1.5 ${
                result.kind === "ok" ? "text-[var(--foreground)]" : "text-[var(--danger)]"
              }`}
            >
              {result.kind === "ok" ? (
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5 text-[var(--accent)]" aria-hidden />
              ) : (
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden />
              )}
              {result.text}
            </p>
          ) : null}
        </div>
        <ul className="space-y-2">
          {COUNTRIES.map((c) => {
            const d = draftFor(c);
            const current = mappedTo(c);
            const changed = d.organisationId !== current;
            return (
              <li
                key={c}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                <label htmlFor={`${ids}-${c}`} className="w-32 font-medium">
                  {COUNTRY_NAMES[c]}
                </label>
                <select
                  id={`${ids}-${c}`}
                  value={d.organisationId}
                  onChange={(e) => setDraft(c, { organisationId: e.target.value })}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
                >
                  {current ? null : <option value="">— not mapped —</option>}
                  {organisations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <label className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                  <input
                    type="checkbox"
                    checked={d.place}
                    onChange={(e) => setDraft(c, { place: e.target.checked })}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  Also place its learners who have no organisation yet
                  <span className="sr-only"> ({COUNTRY_NAMES[c]})</span>
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => save(c)}
                  disabled={!d.organisationId || (!changed && !d.place) || pending === c}
                  aria-label={`Save the organisation for ${COUNTRY_NAMES[c]}`}
                >
                  {pending === c ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Save
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
