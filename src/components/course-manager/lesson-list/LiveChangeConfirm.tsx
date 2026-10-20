"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/cms/types";
import { Named } from "./Named";

/** A change to a course people are taking that asks first (D66, spec 7.3). */
export type LiveChange =
  | { kind: "move" | "hide" | "show"; name: string }
  | { kind: "addLesson" }
  | { kind: "addPart" | "movePart"; name: string }
  /** `text`: removing text (else a question learners never got: only a draft). */
  | { kind: "removePart"; name: string; text: boolean };

/** Its messages under `liveChanges`: the question, what learners notice, the button. */
export function liveChangeKeys(change: LiveChange): { title: string; effect: string; confirm: string } {
  switch (change.kind) {
    case "move":
      return { title: "title.move", effect: "effect.move", confirm: "confirm.move" };
    case "hide":
      return { title: "title.hide", effect: "effect.hide", confirm: "confirm.hide" };
    case "show":
      return { title: "title.show", effect: "effect.show", confirm: "confirm.show" };
    case "addLesson":
      // One more lesson to do, as when a lesson is shown again (spec 5.13).
      return { title: "title.addLesson", effect: "effect.show", confirm: "confirm.add" };
    case "addPart":
      return { title: "title.addPart", effect: "effect.part", confirm: "confirm.add" };
    case "movePart":
      return { title: "title.movePart", effect: "effect.part", confirm: "confirm.move" };
    case "removePart":
      return { title: change.text ? "title.removeText" : "title.removeContent", effect: "effect.part", confirm: "confirm.remove" };
  }
}

/**
 * "Move “Skill concept” in a live course?" inline where the change was asked
 * for (the DeleteConfirm pattern, not a modal): its heading takes focus; it
 * says how many learners are taking the course and how many finished, then
 * what they will notice; the change's own button sends it with `confirm`,
 * and Cancel (or Escape) leaves everything as it was — the page then puts
 * focus back where the editor started. The counts are the page's, or the
 * server's when it asked first (needs-confirmation), so the editor always
 * confirms the numbers the server counted.
 */
export function LiveChangeConfirm({
  change,
  nameLang,
  learners,
  finished,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  change: LiveChange;
  /** The content language the lesson's name is in. */
  nameLang?: Locale;
  learners: number;
  finished: number;
  busy: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("liveChanges");
  const ids = React.useId();
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const keys = liveChangeKeys(change);

  React.useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div
      role="group"
      aria-labelledby={`${ids}-h`}
      aria-describedby={`${ids}-learners ${ids}-effect`}
      className="mt-2 rounded-lg border border-[var(--warning)]/50 bg-[var(--warning)]/5 p-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <h3 id={`${ids}-h`} ref={headingRef} tabIndex={-1} className="text-sm font-semibold">
        {"name" in change ? (
          <Named format={(n) => t(keys.title, { name: n })} name={change.name} lang={nameLang} />
        ) : (
          t(keys.title)
        )}
      </h3>
      <p id={`${ids}-learners`} className="mt-1 flex items-start gap-1.5 text-xs">
        <Users className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--warning)]" aria-hidden />
        {t("learners", { count: learners, finished })}
      </p>
      <p id={`${ids}-effect`} className="mt-1 text-xs text-[var(--muted-foreground)]">
        {t(keys.effect)}
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onConfirm();
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {t(keys.confirm)}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
