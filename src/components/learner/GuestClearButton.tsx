"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { useDemoState } from "@/store/demo-state";
import { guestWorkOf } from "@/store/guest-migration";

/**
 * Release 3 (spec 5.5): "Clear my work from this browser", for guests on a
 * shared computer. Asks first in place (its question takes focus; Cancel
 * or Escape returns to the button), then removes the browser's guest store
 * and what the page holds of it. Below the page content, outside <main>
 * (the recorded walk reads <main>); shown only while a guest has work here.
 */
export function GuestClearButton() {
  const t = useTranslations("guestWork");
  const tCard = useTranslations("compCard");
  const { status } = useSession();
  const { state, clearGuestWork } = useDemoState();
  const ids = React.useId();
  const [asking, setAsking] = React.useState(false);
  const [cleared, setCleared] = React.useState(false);
  const button = React.useRef<HTMLButtonElement>(null);
  const question = React.useRef<HTMLParagraphElement>(null);
  const done = React.useRef<HTMLParagraphElement>(null);

  React.useEffect(() => {
    if (asking) question.current?.focus();
  }, [asking]);
  React.useEffect(() => {
    if (cleared) done.current?.focus();
  }, [cleared]);

  const hasWork = status === "unauthenticated" && guestWorkOf(state) !== null;
  if (!hasWork && !cleared) return null;

  const cancel = () => {
    setAsking(false);
    button.current?.focus();
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6">
      {cleared ? (
        <p ref={done} tabIndex={-1} role="status" className="text-sm outline-none">
          {t("removed")}
        </p>
      ) : (
        <>
          <Button
            ref={button}
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={asking}
            onClick={() => setAsking(true)}
          >
            {t("clear")}
          </Button>
          {asking ? (
            <div
              role="group"
              aria-labelledby={`${ids}-q`}
              className="mt-2 max-w-xl rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-3"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  cancel();
                }
              }}
            >
              <p id={`${ids}-q`} ref={question} tabIndex={-1} className="text-sm outline-none">
                {t("clearConfirm")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    clearGuestWork();
                    setAsking(false);
                    setCleared(true);
                  }}
                >
                  {t("clear")}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={cancel}>
                  {tCard("sharing.cancel")}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
