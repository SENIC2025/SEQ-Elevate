"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useDemoState } from "@/store/demo-state";

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
 * once a choice is made, what became of the work takes its place, and
 * focus goes there (the button pressed is gone). "Added" is said only once
 * all of it is in the account, and that the account kept its own answers
 * only where it kept one over a different one of the guest's (D37, D69).
 * A move that didn't get through says so, and what didn't move is offered
 * again; so is what a tab still a guest saved meanwhile, and a Comp Card
 * held back from a card the account shares (D80), with what to do to add
 * it. Work gone from the browser meanwhile (added or removed in another
 * tab) is said too: nothing was added.
 * Nothing is shown when there is no such work (and never in the recorded
 * walk, which signs in with no guest store).
 */
export function GuestWorkPrompt() {
  const t = useTranslations("guestWork");
  const locale = useLocale();
  const tProfile = useTranslations("profile");
  const tCompCard = useTranslations("compCard");
  const { guestWork, guestWorkDone, claimGuestWork, discardGuestWork } = useDemoState();
  const ids = React.useId();
  const [busy, setBusy] = React.useState(false);
  const done = React.useRef<HTMLParagraphElement>(null);
  // A choice made here (not in another tab): what became of it is shown.
  const [chosen, setChosen] = React.useState(false);

  React.useEffect(() => {
    if (guestWorkDone && chosen) done.current?.focus();
  }, [guestWorkDone, chosen]);

  if (!guestWork && !(guestWorkDone && chosen)) return null;

  const outcome = busy
    ? tCompCard("saving")
    : guestWorkDone === "failed"
      ? tProfile("failed")
      : guestWorkDone
        ? t(guestWorkDone)
        : null;
  // Nothing left in this browser to choose about.
  const finished =
    guestWorkDone === "added" || guestWorkDone === "addedOwn" || guestWorkDone === "nothing" || guestWorkDone === "removed";

  return (
    <section aria-labelledby={`${ids}-title`} className="mx-auto max-w-6xl px-4 pt-6">
      <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4">
        <h2 id={`${ids}-title`} className="text-base font-semibold">
          {t("title")}
        </h2>
        {guestWork && !finished ? (
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
