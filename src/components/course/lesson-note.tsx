"use client";

import { useTranslations } from "next-intl";
import { Info } from "lucide-react";

/**
 * Above a lesson the learner reached out of order, on the screen (spec
 * 5.2, 5.5):
 *   stillToDo  after the last lesson, Continue brought them back to one not
 *              done (continueHint.stillToDo) — said in the player's live
 *              region too, and in an editor's preview as well;
 *   new        a lesson not done sits before lessons done. An editor added
 *              it, showed it again or moved it there (spec 7.4), which the
 *              player can't tell apart, so the note never says which.
 * A step name written in another language than the page's carries its
 * `lang` (WCAG 3.1.2).
 */
export function LessonNote(props: { kind: "stillToDo"; name: string; lang?: string } | { kind: "new" }) {
  const tPlayer = useTranslations("coursePlayer");
  const tHint = useTranslations("continueHint");
  return (
    <p className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm">
      <Info aria-hidden className="h-4 w-4 flex-shrink-0 text-[var(--accent)]" />
      <span>
        {props.kind === "new"
          ? tPlayer("newLesson")
          : tHint.rich("stillToDo", {
              name: props.name,
              lesson: (chunks) => (props.lang ? <span lang={props.lang}>{chunks}</span> : chunks),
            })}
      </span>
    </p>
  );
}
