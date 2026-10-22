"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CompCardField } from "@/lib/comp-card-visibility";
import type { GuestText } from "@/lib/guest-claim";
import { useDemoState, type GuestWorkDone } from "@/store/demo-state";

/**
 * Release 3 (D79, spec 5.5): work saved on this browser before the person
 * signed in. On a shared computer it may be someone else's, so it moves
 * into the account only when they say it is theirs: "Add it to my account"
 * or "Remove it from this browser", of equal weight. Without a choice
 * nothing moves and nothing is removed; it is offered again on the next
 * load.
 *
 * A labelled region with a heading at the top of the learner pages and the
 * hub; focus isn't moved to it. While the work is being added it says so;
 * once a choice is made, what became of the work is said, and focus goes
 * there. The server answers each part (src/lib/guest-claim.ts): when all
 * of it is in the account, "Added" (or "already", when none of it needed
 * adding); otherwise one sentence per part — the course, the Comp Card, the
 * badges — each in the account or not and why (D37, D69, D80), and that
 * what wasn't added stays on this browser. More saved on this browser while
 * it was being added is said too, and offered again with whatever stays.
 * A refusal says that nothing was added, and why: a text too long to add,
 * another account signed in on this browser, no answer back. Work gone
 * from the browser meanwhile (added or removed in another tab) is said too.
 * The offer says to add it before anything else is started in the account:
 * a course the account has progress in, or a Comp Card of its own, keeps
 * the account's, and the browser's can't be added then (D69, D80).
 * A text too long to add — a Comp Card answer over 2,000 characters, a
 * reflection answer over 5,000 — can't be added as it is (D80, D62.d:
 * refused, never cut), and while there is one nothing is: each is offered
 * here to be shortened, in a labelled box with its length, and what is
 * typed is written to this browser's guest store at once
 * (shortenGuestText); the next "Add" sends it. Work too big to add offers
 * every answer it holds to be shortened the same way.
 * Nothing is shown when there is no such work (and never in the recorded
 * walk, which signs in with no guest store).
 *
 * On a guest's page on which someone signed in in another tab (IL-2b), the
 * page stays the guest's until it is reloaded or left (another page loads
 * in full, as the account's), and this says so instead, with a way to
 * reload: a status, so the focus stays where the learner is (they may be
 * mid-answer). A guest's page whose work was added to an account, removed
 * or changed in another tab saves no more, and says that instead, the same
 * way.
 */
export function GuestWorkPrompt() {
  const t = useTranslations("guestWork");
  const locale = useLocale();
  const tProfile = useTranslations("profile");
  const tCompCard = useTranslations("compCard");
  const { guestWork, guestWorkDone, claimGuestWork, discardGuestWork, shortenGuestText, signedInElsewhere, guestStoreChanged } =
    useDemoState();
  const ids = React.useId();
  const [busy, setBusy] = React.useState(false);
  const done = React.useRef<HTMLParagraphElement>(null);
  // A choice made here (not in another tab): what became of it is shown.
  const [chosen, setChosen] = React.useState(false);
  // Texts shortened here since the last choice, by where they are: still
  // shown once short enough, until "Add" sends them.
  const [edited, setEdited] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (guestWorkDone && chosen) done.current?.focus();
  }, [guestWorkDone, chosen]);

  if (guestStoreChanged || signedInElsewhere) {
    return (
      <section className="mx-auto max-w-6xl px-4 pt-6">
        <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4">
          <p role="status" className="text-sm">
            {t(guestStoreChanged ? "changedElsewhere" : "signedInElsewhere")}
          </p>
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => window.location.reload()}>
            {t("reload")}
          </Button>
        </div>
      </section>
    );
  }

  if (!guestWork && !(guestWorkDone && chosen)) return null;

  const fieldName = (field: CompCardField) => tCompCard(FIELD_LABEL[field]);
  const outcome = busy ? (
    tCompCard("saving")
  ) : guestWorkDone?.kind === "failed" ? (
    tProfile("failed")
  ) : guestWorkDone ? (
    <Outcome done={guestWorkDone} pageLocale={locale} />
  ) : null;
  // The texts to shorten, as the guest store holds them (or as shortened
  // here meanwhile): those too long to add, or, for work too big to add,
  // every answer it holds.
  const tooBig = guestWorkDone?.kind === "tooLarge";
  const shortening = ((tooBig ? guestWork?.texts : guestWork?.tooLong) ?? []).map((t) => ({
    ...t,
    key: keyOf(t.ref),
    value: edited[keyOf(t.ref)] ?? t.text,
  }));
  const labelOf = (text: (typeof shortening)[number]) =>
    text.ref.part === "compCard" ? fieldName(text.ref.field) : t("reflectionLabel", { n: text.n ?? 1 });

  return (
    <section aria-labelledby={`${ids}-title`} className="mx-auto max-w-6xl px-4 pt-6">
      <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4">
        <h2 id={`${ids}-title`} className="text-base font-semibold">
          {t("title")}
        </h2>
        {guestWork ? (
          <>
            <p className="mt-1 text-sm">
              <CoursesIn
                summary={t("summary", {
                  n: guestWork.courses.length,
                  courses: COURSES,
                  compCard: guestWork.compCard ? "true" : "false",
                  badges: guestWork.badges,
                })}
                courses={guestWork.courses}
                pageLocale={locale}
              />
            </p>
            <p className="mt-1 text-sm">{t("addFirst")}</p>
            {shortening.length ? (
              <div className="mt-3 space-y-3">
                <p id={`${ids}-shorten`} className="text-sm">
                  {tooBig ? t("shortenLarge") : t("shortenIntro", { count: shortening.length })}
                </p>
                {shortening.map((text, i) => (
                  <ShortenField
                    key={text.key}
                    id={`${ids}-text-${i}`}
                    introId={`${ids}-shorten`}
                    label={labelOf(text)}
                    value={text.value}
                    max={text.max}
                    readOnly={busy}
                    onChange={(value) => {
                      setEdited((now) => ({ ...now, [text.key]: value }));
                      shortenGuestText(text.ref, value);
                    }}
                  />
                ))}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-disabled={busy || undefined}
                onClick={async () => {
                  if (busy) return;
                  setChosen(true);
                  setBusy(true);
                  await claimGuestWork();
                  // What was shortened here moved, or is offered again as
                  // the guest store now holds it.
                  setEdited({});
                  setBusy(false);
                }}
              >
                {t("add")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (busy) return;
                  setChosen(true);
                  setEdited({});
                  discardGuestWork();
                }}
              >
                {t("remove")}
              </Button>
            </div>
          </>
        ) : null}
        <p ref={done} tabIndex={-1} role="status" className="mt-2 text-sm font-medium outline-none empty:hidden">
          {outcome}
        </p>
      </div>
    </section>
  );
}

/** Where a text of the guest work is, as one string. */
const keyOf = (ref: GuestText) => (ref.part === "compCard" ? `compCard/${ref.field}` : `${ref.key}#${ref.prompt}`);

/** Each part's outcome, by its message (guestWork.*). */
const COURSE_SAID = {
  moved: "courseAdded",
  already: "courseAlready",
  kept: "courseKept",
  unavailable: "courseUnavailable",
} as const;
const CARD_SAID = { moved: "cardAdded", already: "cardAlready", kept: "cardKept", shared: "cardKeptShared" } as const;

/**
 * What became of the work, in sentences. All of it in the account: "Added"
 * (or "already", when none of it needed adding). Otherwise one sentence
 * per part, and that what wasn't added stays. More saved meanwhile is said
 * after either. The course is named as it was recorded, marked with its
 * language when that isn't the page's (WCAG 3.1.2).
 */
function Outcome({ done, pageLocale }: { done: Exclude<GuestWorkDone, { kind: "failed" }>; pageLocale: string }) {
  const t = useTranslations("guestWork");
  if (done.kind === "tooLong") return <>{t("tooLong", { count: done.count })}</>;
  if (done.kind !== "claimed") return <>{t(done.kind)}</>;
  const inAccount = (outcome: string | undefined) => outcome === undefined || outcome === "moved" || outcome === "already";
  const badgesIn = done.badgesMoved + done.badgesAlready;
  const sentences: React.ReactNode[] = [];
  if (inAccount(done.course?.outcome) && inAccount(done.compCard) && done.badgesRefused === 0) {
    const added = done.course?.outcome === "moved" || done.compCard === "moved" || done.badgesMoved > 0;
    sentences.push(t(added ? "added" : "already"));
  } else {
    if (done.course) {
      sentences.push(
        <CoursesIn
          key="course"
          summary={t(COURSE_SAID[done.course.outcome], { course: COURSES })}
          courses={[done.course]}
          pageLocale={pageLocale}
        />
      );
    }
    if (done.compCard) sentences.push(t(CARD_SAID[done.compCard]));
    if (badgesIn) sentences.push(t("badgesIn", { count: badgesIn }));
    if (done.badgesRefused) sentences.push(t("badgesRefused", { count: done.badgesRefused }));
    sentences.push(t("keptStays"));
  }
  if (done.more) sentences.push(t("changedMeanwhile"));
  return (
    <>
      {sentences.map((sentence, i) => (
        <React.Fragment key={i}>
          {i > 0 ? " " : null}
          {sentence}
        </React.Fragment>
      ))}
    </>
  );
}

/** The Comp Card's own words for each text (compCard.*). */
const FIELD_LABEL: Record<CompCardField, "fieldWentWell" | "fieldDifficult" | "fieldImprove" | "fieldBehaviour"> = {
  wentWell: "fieldWentWell",
  difficult: "fieldDifficult",
  improve: "fieldImprove",
  behaviour: "fieldBehaviour",
};

/**
 * A text of the guest work to be shortened: a labelled box, and its length
 * under it — how many characters too many for its limit (`max`), or that
 * it is short enough to add — read with the box. That it became short
 * enough is said once (a polite live region), not every character typed.
 */
function ShortenField({
  id,
  introId,
  label,
  value,
  max,
  readOnly,
  onChange,
}: {
  id: string;
  introId: string;
  label: string;
  value: string;
  max: number;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("guestWork");
  const over = value.length - max;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <Textarea
        id={id}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        aria-describedby={`${id}-length ${introId}`}
        aria-invalid={over > 0 || undefined}
      />
      <p
        id={`${id}-length`}
        className={over > 0 ? "mt-1 text-sm font-medium text-[var(--danger)]" : "mt-1 text-sm text-[var(--muted-foreground)]"}
      >
        {over > 0 ? t("lengthOver", { count: value.length, over, max }) : t("lengthOk", { count: value.length, max })}
      </p>
      {/* Polite, and not a status: the offer's one status is what became of the work. */}
      <span aria-live="polite" className="sr-only">
        {over > 0 ? "" : t("shortEnough")}
      </span>
    </div>
  );
}

/** Stands in for the course titles while the summary is formatted. */
const COURSES = "\u2063courses\u2063";

/**
 * The summary with the course titles in it, each marked with the language
 * it was recorded in when that isn't the page's (WCAG 3.1.2). A title with
 * no recorded language (a store from before Release 3) is unmarked.
 */
function CoursesIn({
  summary,
  courses,
  pageLocale,
}: {
  summary: string;
  courses: { title: string; locale: string | null }[];
  pageLocale: string;
}) {
  const [before, after] = summary.split(COURSES);
  if (after === undefined) return <>{summary}</>;
  return (
    <>
      {before}
      {courses.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 ? ", " : null}
          {c.locale && c.locale !== pageLocale ? <span lang={c.locale}>{c.title}</span> : c.title}
        </React.Fragment>
      ))}
      {after}
    </>
  );
}
