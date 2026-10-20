"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { KeyRefusal } from "@/lib/learner-progress/contract";
import { useAnnounce } from "./PlayerAnnouncer";

/**
 * An answer that wasn't saved (D62.d): the server refused its key — the
 * stored answers can't be read, or are full ("row-full") — or the store
 * held it back (progressRefused). It stays on the screen, and the learner
 * is told under the item that it won't be there after a reload or on
 * another device. Changing the answer clears the refusal (the store's
 * answerChanged), and it is sent again.
 *
 * A reflection held back as too long needs no second note: its box says
 * so, and how to fix it (answer-length.tsx) — pass `reflection`.
 *
 * The refusal comes back with the save, a moment after the answer: its
 * appearing is said once through the player's live region. A lesson
 * opening with one already there says nothing; the note is read in place.
 */
export function RefusedNote({ reason, reflection = false }: { reason: KeyRefusal | undefined; reflection?: boolean }) {
  const t = useTranslations("coursePlayer");
  const announce = useAnnounce();
  const shown = reason !== undefined && !(reflection && reason === "too-long");
  // What the item opened with counts as said.
  const said = useRef(shown);
  useEffect(() => {
    if (shown === said.current) return;
    said.current = shown;
    if (shown) announce(t("notSaved"));
    // Said when it appears, with the words of that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  if (!shown) return null;
  return <p className="mt-3 text-sm font-medium text-[var(--danger)]">{t("notSaved")}</p>;
}
