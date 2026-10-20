"use client";

import { useCallback, useId, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslations } from "next-intl";
import { CircleAlert } from "lucide-react";
import type { PartId, PartKey, ResolvedPart, SectionId } from "@/lib/cms/sections/contract";
import { lessonContinue, type ContinueGate, type LessonAnswers, type Missing, type Need } from "./continue-gate";
import { useAnnounce } from "./PlayerAnnouncer";
import { focusTarget, stickyHeaderBottom } from "./step-focus";

/**
 * A lesson's Continue (requirement 4, spec 5.7), for the stage screens and
 * the sectioned view alike.
 *
 * Continue is always shown and enabled. While something is missing a plain
 * hint sits above it (`hint`, linked to it by `hintId`): what the one item
 * needs, or how many still need an answer. Pressed then, it doesn't move
 * on: the first item missing gets a dashed outline and, under its heading,
 * a note saying what it needs (`Note`); the player's live region says
 * "{item}: {need}", again on every press; and focus goes to the most
 * precise place — the item's heading, a scenario's follow-up question, a
 * quick check's first unanswered question, or its "Check answers" once
 * every question is answered — which the note describes. The page scrolls
 * only if that place isn't in view (step-focus.ts). The mark goes once the
 * item is answered.
 *
 * The components render the targets with the ids `ids` gives them, and
 * `describedBy(id)` on each.
 */

const NO_RETRY: ReadonlySet<PartKey> = new Set();

export interface ContinueTargets {
  heading(partId: PartId): string;
  followup(partId: PartId): string;
  question(partId: PartId, questionId: string): string;
  check(partId: PartId): string;
  note(partId: PartId): string;
}

export interface ContinueApi {
  gate: ContinueGate;
  /** What Continue waits for, said before it is pressed; null when it doesn't wait. */
  hint: string | null;
  hintId: string;
  /** The item a press marked, while it's still missing. */
  flagged: Missing | null;
  /** What a need is, in words (the note's and the announcement's). */
  needText: (need: Need) => string;
  /** Ids of every place a press may take focus to. */
  ids: ContinueTargets;
  /** The note's id for the target with `id`, when the mark is there; else undefined. */
  describedBy: (id: string) => string | undefined;
  press: () => void;
}

/** The id a press takes focus to for `missing`. */
function targetOf(ids: ContinueTargets, missing: Missing): string {
  switch (missing.need.kind) {
    case "scenarioFollowup":
      return ids.followup(missing.partId);
    case "quizLeft":
      return ids.question(missing.partId, missing.need.first);
    case "quizCheck":
      return ids.check(missing.partId);
    default:
      return ids.heading(missing.partId);
  }
}

export function useContinue({
  lessonId,
  parts,
  answers,
  retrying = NO_RETRY,
  onContinue,
}: {
  lessonId: SectionId;
  parts: readonly ResolvedPart[];
  answers: LessonAnswers;
  retrying?: ReadonlySet<PartKey>;
  onContinue: () => void;
}): ContinueApi {
  const tHint = useTranslations("continueHint");
  const tPlayer = useTranslations("coursePlayer");
  const tHeading = useTranslations("sectionPreview.partHeading");
  const announce = useAnnounce();
  const uid = useId();
  // The part a press marked, and how many presses (to focus again on each).
  const [pressed, setPressed] = useState<{ partId: PartId; n: number } | null>(null);

  const gate = lessonContinue(lessonId, parts, answers, retrying, (part) =>
    "title" in part && part.title ? part.title : tHeading(part.type)
  );
  const missing = gate.ready ? [] : gate.missing;

  const needText = useCallback(
    (need: Need) => {
      const button = tPlayer("checkAnswers");
      switch (need.kind) {
        case "choose":
          return tHint("simulation");
        case "scenarioRoot":
          return tHint("scenario");
        case "scenarioFollowup":
          return tHint("scenarioFollowup");
        case "quizLeft":
          return tHint("quizLeft", { count: need.left, button });
        case "quizCheck":
          return tHint("quizCheck", { button });
      }
    },
    [tHint, tPlayer]
  );

  const ids: ContinueTargets = {
    heading: (p) => `${uid}-${p}`,
    followup: (p) => `${uid}-${p}-followup`,
    question: (p, q) => `${uid}-${p}-q-${q}`,
    check: (p) => `${uid}-${p}-check`,
    note: (p) => `${uid}-${p}-note`,
  };

  const flagged = pressed ? (missing.find((m) => m.partId === pressed.partId) ?? null) : null;
  const flaggedTarget = flagged ? targetOf(ids, flagged) : null;

  const press = () => {
    if (gate.ready) {
      onContinue();
      return;
    }
    const first = gate.missing[0];
    // The mark and its note on the page first, so the target is read with
    // its description when it takes focus.
    flushSync(() => setPressed((p) => ({ partId: first.partId, n: (p?.n ?? 0) + 1 })));
    announce(tHint("announce", { item: first.item, need: needText(first.need) }));
    focusTarget(document.getElementById(targetOf(ids, first)), window, stickyHeaderBottom(document));
  };

  const hint =
    missing.length === 0
      ? null
      : missing.length === 1
        ? needText(missing[0].need)
        : tHint("several", { count: missing.length });

  return {
    gate,
    hint,
    hintId: `${uid}-hint`,
    flagged,
    needText,
    ids,
    describedBy: (id) => (flagged && id === flaggedTarget ? ids.note(flagged.partId) : undefined),
    press,
  };
}

/** The note a press puts under the marked item's heading: what it needs. */
export function ContinueNote({ api, partId }: { api: ContinueApi; partId: PartId }) {
  if (!api.flagged || api.flagged.partId !== partId) return null;
  return (
    <p id={api.ids.note(partId)} className="mt-2 mb-3 flex items-center gap-1.5 text-sm font-medium">
      <CircleAlert aria-hidden className="h-4 w-4 flex-shrink-0 text-[var(--warning)]" />
      {api.needText(api.flagged.need)}
    </p>
  );
}

/** The dashed outline of a marked item. */
export const FLAGGED_CLASS = "rounded-lg outline-2 outline-offset-4 outline-[var(--warning)] outline-dashed";
