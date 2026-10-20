/**
 * Where the player's Continue and Back go (Q4, spec 5.2): in order, and back
 * always. Built on the plan's rules (learner-nav.ts), which a client
 * component imports instead of learner-path.ts — that one reads the
 * step-name messages of every language.
 *
 * Pure, no React.
 */

import { nextAfter } from "@/lib/cms/sections/learner-nav";
import type { SectionId } from "@/lib/cms/sections/contract";

export type Position = SectionId | "complete" | "empty";

/**
 * After Continue on `current`, which is done now: the next lesson; after
 * the last one, the first lesson still not done (`stillToDo`, said to the
 * learner), else the completion screen. A course already completed ends on
 * its completion screen: a lesson added since doesn't take its learners
 * back (D50).
 */
export function afterContinue(
  ids: readonly SectionId[],
  done: ReadonlySet<string>,
  current: SectionId,
  completed: boolean
): { to: Position; stillToDo?: SectionId } {
  const withCurrent = new Set(done);
  withCurrent.add(current);
  const next = nextAfter(ids, withCurrent, current);
  const i = ids.indexOf(current);
  if (completed && i === ids.length - 1) return { to: "complete" };
  return next;
}

/** Back from `current`: the previous lesson; from the completion screen, the last one. Null at the first. */
export function backFrom(ids: readonly SectionId[], current: Position): SectionId | null {
  if (current === "empty") return null;
  if (current === "complete") return ids[ids.length - 1] ?? null;
  const i = ids.indexOf(current);
  return i > 0 ? ids[i - 1] : null;
}
