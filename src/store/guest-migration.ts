/**
 * Moving a guest's progress into the account they sign in to.
 *
 * A guest's progress lives in this browser's guest store (localStorage).
 * Release 3 (D79, spec 5.5): it moves only when the person signed in says
 * it is theirs ("Add it to my account", claimGuestWork in demo-state.tsx),
 * once their profile step is done — on a shared computer it may be someone
 * else's. Until then it stays in the guest store, untouched, and the
 * learner store offers it (guestWorkOf). It moves only where the account
 * has none: the saved data always wins — per course for the course (D37, D69:
 * the guest store holds one), which is sent in fill mode, so the account
 * still wins if another device saves it at the same moment (spec 5.4).
 * The guest store is emptied only once every write has got through (or
 * been refused, which no try can change: `settled`): until then it is the
 * copy that outlives a tab closed mid-move, and is offered again on the
 * next page. Moving it twice changes nothing — the account has it then,
 * and wins. No write is given up on at its first failure — a dropped
 * connection, or a session lookup that failed (the save actions fail then:
 * see requireLearner in src/app/actions/learner.ts) — and one failure
 * doesn't stop the rest: each write is tried again (retry.ts), and what
 * the account should now hold goes to the store whether its write got
 * through or not. What didn't is then saved by the store's own
 * write-throughs, which try again too: the Comp Card, the badges not yet
 * awarded, and the course once it has loaded.
 *
 * No React: DemoStateProvider in demo-state.tsx applies it.
 */

import type { CompCardData, CourseProgress, DemoState } from "./demo-state";
import { hasCourseProgress } from "./progress-merge";
import type { CompCardInput } from "@/app/actions/learner";
import type { Locale } from "@/lib/cms/types";
import { COMP_CARD_FIELDS, COMP_CARD_TEXT_MAX } from "@/lib/comp-card-visibility";
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
  /** Did every write get through or get refused (none left to the store)? */
  settled: boolean;
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
  let settled = true;
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
      settled = false;
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

  // Comp Card: only if the account has none, as "Only me" (the save never
  // shares). A refused save (a text over the limit) isn't counted as saved:
  // the card stays in the store, whose write-through saves the rest.
  let compCard = saved.compCard;
  const guestCard = guest.compCard;
  if (!compCard && guestCard?.updatedAt) {
    await write(() => writes.saveCompCard(guestCard));
    compCard = { ...guestCard, sharing: "onlyMe", sharedAt: null, organisationName: null };
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

  return { badges: [...saved.badges, ...newBadges], awarded, compCard, course, wrote, settled };
}

/** A summary of the work a guest store holds, for the prompt that offers it (spec 5.5). */
export interface GuestWork {
  /**
   * The courses with progress in it, by title, each with the language the
   * title was recorded in (null when the store, written before Release 3,
   * didn't record one: shown in the page's language).
   */
  courses: { title: string; locale: Locale | null }[];
  /** A Comp Card filled in. */
  compCard: boolean;
  /** Reflection answers written. */
  reflections: number;
  /** Badges earned. */
  badges: number;
}

const answered = (text: unknown) => typeof text === "string" && text.trim() !== "";

/**
 * What of `guest` (a guest store, as storedGuestState reads it) is work
 * worth offering: progress in its course, a Comp Card filled in, or
 * badges. Null when there is none.
 */
export function guestWorkOf(guest: DemoState): GuestWork | null {
  const course = guest.course;
  const inCourse = !!course.courseSlug && hasCourseProgress(course);
  const card = guest.compCard;
  const compCard = !!card.updatedAt && COMP_CARD_FIELDS.some((f) => answered(card[f]));
  if (!inCourse && !compCard && !(guest.badges ?? []).length) return null;
  const reflections = inCourse
    ? [course.reflection.p1, course.reflection.p2, course.reflection.p3].filter(answered).length +
      Object.values(course.responses).filter(
        (a) => a?.type === "reflection" && Object.values(a.text).some(answered)
      ).length
    : 0;
  return {
    courses: inCourse
      ? [
          course.courseTitle
            ? { title: course.courseTitle, locale: course.courseLocale ?? null }
            : { title: course.courseSlug!, locale: null },
        ]
      : [],
    compCard,
    reflections,
    badges: (guest.badges ?? []).length,
  };
}

/**
 * What a Comp Card save sends (D80): the confidence and every text field
 * within COMP_CARD_TEXT_MAX. A longer one is held back — the learner is told
 * it is too long — and keeps its stored text; the others save. Never who
 * sees it: that has its own action.
 */
export function cardToSave(card: CompCardData): CompCardInput {
  // The texts first, in the card's order, as the save has always sent them.
  const input: CompCardInput = {};
  for (const field of COMP_CARD_FIELDS) {
    const text = card[field];
    if (typeof text === "string" && text.length <= COMP_CARD_TEXT_MAX) input[field] = text;
  }
  input.confidence = card.confidence;
  return input;
}
