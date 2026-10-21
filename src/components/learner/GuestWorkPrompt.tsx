"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
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
 * hub; focus isn't moved to it. Once a choice is made, what became of the
 * work takes its place, and focus goes there (the button pressed is gone).
 * Nothing is shown when there is no such work (and never in the recorded
 * walk, which signs in with no guest store).
 */
export function GuestWorkPrompt() {
  const t = useTranslations("guestWork");
  const tProfile = useTranslations("profile");
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

  const outcome =
    guestWorkDone === "added" ? t("added") : guestWorkDone === "removed" ? t("removed") : guestWorkDone === "failed" ? tProfile("failed") : null;

  return (
    <section aria-labelledby={`${ids}-title`} className="mx-auto max-w-6xl px-4 pt-6">
      <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4">
        <h2 id={`${ids}-title`} className="text-base font-semibold">
          {t("title")}
        </h2>
        {guestWork && guestWorkDone !== "added" && guestWorkDone !== "removed" ? (
          <>
            <p className="mt-1 text-sm">
              {t("summary", {
                n: guestWork.courses.length,
                courses: guestWork.courses.join(", "),
                compCard: guestWork.compCard ? "true" : "false",
              })}
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
