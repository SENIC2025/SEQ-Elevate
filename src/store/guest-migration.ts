/**
 * Moving a guest's progress into the account they sign in to.
 *
 * A guest's progress lives in this browser's guest store (localStorage).
 * When they sign in, it moves to their account, only where the account has
 * none: the saved data always wins — per course for the course (D37, D69:
 * the guest store holds one), which is sent in fill mode, so the account
 * still wins if another device saves it at the same moment (spec 5.4).
 * The guest store is emptied before the writes (so a second tab can't move
 * it twice), which leaves the learner store in memory as the only other
 * place for it. So no write is given up on at its first failure — a
 * dropped connection, or a session lookup that failed (the save actions
 * fail then: see requireLearner in src/app/actions/learner.ts) — and one
 * failure doesn't stop the rest: each write is tried again (retry.ts), and
 * what the account should now hold goes to the store whether its write got
 * through or not. What didn't is then saved by the store's own
 * write-throughs, which try again too: the Comp Card, the badges not yet
 * awarded, and the course once it has loaded.
 *
 * No React: DemoStateProvider in demo-state.tsx applies it.
 */

import type { CompCardData, CourseProgress, DemoState } from "./demo-state";
import { hasCourseProgress } from "./progress-merge";
import { withRetry } from "./retry";
import { isRefusedAward } from "@/lib/badge-award";
import type { ProgressPatch } from "@/lib/learner-progress/contract";
import { EMPTY_PROGRESS, fitPatch, patchSince } from "@/lib/learner-progress/patch";

/** What the account has saved (loadLearnerGlobal). */
export interface SavedGlobal {
  compCard: CompCardData | null;
  badges: string[];
  /** Per course: lessons finished, and whether anything at all is saved in it. */
  enrollments: { slug: string; stagesCompleted: number; completed?: boolean; hasProgress?: boolean }[];
}

/** The writes that move it, for the learner who signed in. */
export interface GuestWrites {
  awardBadge(slug: string): Promise<unknown>;
  saveCompCard(card: CompCardData): Promise<unknown>;
  /** saveCourseProgressPatch, with a patch in fill mode. */
  saveCourse(slug: string, patch: ProgressPatch): Promise<unknown>;
}

export interface Migrated {
  /** The account's badges, then the guest's: what the store shows. */
  badges: string[];
  /** Of those, the ones the server holds now; the store awards the rest. */
  awarded: string[];
  /** The Comp Card: the saved one, else the guest's (null: neither). */
  compCard: CompCardData | null;
  /** The guest's course, when it moves to the account; else null. */
  course: CourseProgress | null;
  /** Did any write get through (so server-rendered pages are stale)? */
  wrote: boolean;
}

/**
 * Moves `guest` into the account that has `saved`, with `writes`, each
 * tried again with `retry` when it fails. It never rejects for a write
 * that doesn't get through: see Migrated for what the store takes over.
 */
export async function migrateGuest(
  guest: DemoState,
  saved: SavedGlobal,
  writes: GuestWrites,
  retry: <T>(call: () => Promise<T>) => Promise<T> = (call) => withRetry(call)
): Promise<Migrated> {
  let wrote = false;
  const write = async (call: () => Promise<unknown>) => {
    try {
      const result = await retry(call);
      // A refusal (a badge the server has no row for, a course it doesn't
      // have) is answered, not thrown, so it isn't tried again: no try
      // could succeed. It isn't counted as saved either.
      if (isRefusedAward(result)) {
        console.error("The server refused a guest's progress; it isn't saved.", result);
        return false;
      }
      wrote = true;
      return true;
    } catch (err) {
      console.error(
        "A guest's progress didn't reach their account; the learner store saves it.",
        err
      );
      return false;
    }
  };

  // Badges: a union. Awarding is idempotent.
  const known = new Set(saved.badges);
  const newBadges = (guest.badges ?? []).filter((b) => !known.has(b));
  const awarded = [...saved.badges];
  for (const slug of newBadges) {
    if (await write(() => writes.awardBadge(slug))) awarded.push(slug);
  }

  // Comp Card: only if the account has none.
  let compCard = saved.compCard;
  const guestCard = guest.compCard;
  if (!compCard && guestCard?.updatedAt) {
    await write(() => writes.saveCompCard(guestCard));
    compCard = guestCard;
  }

  // Course: the guest store only holds the last-played course. Only if the
  // account has no progress in it yet (an enrolment from before Release 2
  // says so by its lessons done). Everything the guest did in it is sent,
  // within what one save may hold (fitPatch): the store saves the rest once
  // the course has loaded, as it does a write that didn't get through.
  let course: CourseProgress | null = null;
  const gc = guest.course;
  const slug = gc?.courseSlug;
  const account = saved.enrollments.find((e) => e.slug === slug);
  const accountHasProgress = account ? (account.hasProgress ?? account.stagesCompleted > 0) : false;
  if (slug && hasCourseProgress(gc) && !accountHasProgress) {
    const all = patchSince(EMPTY_PROGRESS, gc);
    const patch = all && fitPatch({ ...all, fill: true }).patch;
    if (patch) await write(() => writes.saveCourse(slug, patch));
    course = gc;
  }

  return { badges: [...saved.badges, ...newBadges], awarded, compCard, course, wrote };
}
