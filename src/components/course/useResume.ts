"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCourseReady } from "@/store/demo-state";
import { nextLesson } from "@/lib/cms/sections/learner-nav";
import type { SectionId } from "@/lib/cms/sections/contract";
import type { Position } from "./player-nav";

/**
 * Where a learner opens a course, and the one check that may move them
 * once their saved progress is in (spec 5.5, D65).
 *
 * Release 1 resumed on mount only, from whatever the store held then — for
 * a signed-in learner nothing yet, so they always opened at lesson 1 — and
 * by counting finished lessons, which a reorder or an own lesson breaks.
 * Release 2:
 *
 *   1. First position: for a signed-in learner, the lesson the server
 *      worked out from their enrolment (`serverResume`), so lesson 1 never
 *      flashes; else the first lesson. A preview opens where the editor
 *      asked (`initialLesson`), else at the first lesson.
 *   2. One re-check, when the course's saved progress has loaded and been
 *      merged (useCourseReady; a guest's once the browser's store is read):
 *      the first lesson not done (nextLesson). It moves the learner only if
 *      they haven't done anything yet on this page — any navigation, answer
 *      or Continue — and never in a preview. A course already completed
 *      opens on its completion screen; one whose every lesson is done but
 *      that isn't completed opens on its last lesson, never the completion
 *      screen, which would complete it.
 *   3. A load that never gets through leaves the learner where they are.
 *
 * The rules are pure (initialPosition, resumeCheck) and tested on their
 * own; useResume applies them.
 */

export type { Position };

/** The player's first position. */
export function initialPosition(
  ids: readonly SectionId[],
  o: { preview: boolean; initialLesson?: SectionId; serverResume?: SectionId | "complete" | null }
): Position {
  if (!ids.length) return "empty";
  if (o.preview) return o.initialLesson && ids.includes(o.initialLesson) ? o.initialLesson : ids[0];
  if (o.serverResume === "complete") return "complete";
  if (o.serverResume && ids.includes(o.serverResume)) return o.serverResume;
  return ids[0];
}

/** What the learner has, as the re-check reads it. */
export interface ResumeProgress {
  ids: readonly string[];
  done: ReadonlySet<string>;
  completedAt: string | null;
}

/**
 * The re-check, run at most once: `interacted()` whenever the learner does
 * something; `ready(...)` when their progress is in, which answers where
 * to move them — null to leave them where they are.
 */
export function resumeCheck(o: { preview: boolean; initialLesson?: SectionId }) {
  let spent = o.preview || !!o.initialLesson;
  let interacted = false;
  return {
    interacted() {
      interacted = true;
    },
    ready(progress: ResumeProgress, current: Position): Position | null {
      if (spent) return null;
      spent = true;
      if (interacted) return null;
      const target = nextLesson(progress.ids, progress.done, progress.completedAt);
      return target === "empty" || target === current ? null : target;
    },
  };
}

/**
 * Applies the re-check in the player. Returns `interacted`, for the player
 * to call on anything the learner does. `onMoved` is told where the learner
 * was moved (to announce it).
 */
export function useResume({
  slug,
  progress,
  current,
  setCurrent,
  preview,
  initialLesson,
  onMoved,
}: {
  slug: string;
  progress: ResumeProgress;
  current: Position;
  setCurrent: (to: Position) => void;
  preview: boolean;
  initialLesson?: SectionId;
  onMoved?: (to: Position) => void;
}): { interacted: () => void } {
  const ready = useCourseReady(slug);
  const [check] = useState(() => resumeCheck({ preview, initialLesson }));
  // The latest of what the check reads, without running it again on each.
  const latest = useRef({ progress, current, setCurrent, onMoved });
  useEffect(() => {
    latest.current = { progress, current, setCurrent, onMoved };
  });

  useEffect(() => {
    if (!ready) return;
    const now = latest.current;
    const to = check.ready(now.progress, now.current);
    if (!to) return;
    now.setCurrent(to);
    now.onMoved?.(to);
  }, [ready, check]);

  const interacted = useCallback(() => check.interacted(), [check]);
  return { interacted };
}
