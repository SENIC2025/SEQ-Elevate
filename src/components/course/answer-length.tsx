"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { RESPONSE_LIMITS } from "@/lib/learner-progress/contract";
import { cn } from "@/lib/utils";
import { useAnnounce } from "./PlayerAnnouncer";

/**
 * How long a written answer may be (spec 5.8, owner default 7): 5,000
 * characters per question, counted as the server counts them (JavaScript
 * string length, parse.ts). A longer answer is refused rather than cut —
 * the store holds it back (fitPatch) and the server would refuse it as
 * "too-long" (D62.d) — and the learner is told: from NEAR_LIMIT, how many
 * characters are left; past the limit, that it is too long to save. The
 * boxes have no maxLength, which would cut pasted text without a word.
 */

export const ANSWER_LIMIT = RESPONSE_LIMITS.reflectionChars;
export const NEAR_LIMIT = 4_500;

export type AnswerLength = { kind: "left"; left: number } | { kind: "tooLong"; max: number } | null;

/** What to tell the learner about `text`: nothing while it's short. */
export function answerLengthState(text: string | undefined): AnswerLength {
  const n = text?.length ?? 0;
  if (n > ANSWER_LIMIT) return { kind: "tooLong", max: ANSWER_LIMIT };
  if (n >= NEAR_LIMIT) return { kind: "left", left: ANSWER_LIMIT - n };
  return null;
}

/**
 * The note under the box, which describes it (aria-describedby), shown
 * only near or past the limit. Crossing into either is said once through
 * the player's live region — not every character typed.
 */
export function AnswerLengthNote({ id, state }: { id: string; state: AnswerLength }) {
  const t = useTranslations("coursePlayer");
  const announce = useAnnounce();
  const text =
    state?.kind === "tooLong"
      ? t("answerTooLong", { max: state.max })
      : state?.kind === "left"
        ? t("charsLeft", { count: state.left })
        : null;
  const kind = state?.kind ?? null;
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (kind === said.current) return;
    said.current = kind;
    if (kind && text) announce(text);
    // Said when the kind changes, with the words of that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  if (!text) return null;
  return (
    <p
      id={id}
      className={cn(
        "mt-1 text-sm",
        state?.kind === "tooLong" ? "font-medium text-[var(--danger)]" : "text-[var(--muted-foreground)]"
      )}
    >
      {text}
    </p>
  );
}
