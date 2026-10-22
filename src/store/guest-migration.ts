/**
 * A guest's work, offered to the account they sign in to.
 *
 * A guest's progress lives in this browser's guest store (localStorage).
 * Release 3 (D79, spec 5.5): it moves only when the person signed in says
 * it is theirs ("Add it to my account", claimGuestWork in demo-state.tsx),
 * once their profile step is done — on a shared computer it may be someone
 * else's. Until then it stays in the guest store, untouched, and the
 * learner store offers it (guestWorkOf).
 *
 * Adding it sends the guest store's work to the server once (guestClaimOf),
 * and the server decides each part in one transaction, as the account is
 * then (D37, D69, D80; src/lib/guest-claim.ts): the course only into an
 * account with no progress in it, the Comp Card only into none or a blank
 * one not shared, badges as a union. The guest store then loses only what
 * the server says is in the account, and only as it was read
 * (storeAfterClaim): what a tab still a guest saved meanwhile stays, and
 * so does what the account kept back. A text too long to add is offered to
 * be shortened, in the guest store (withText).
 *
 * No React: DemoStateProvider in demo-state.tsx applies it.
 */

import type { CompCardData, DemoState } from "./demo-state";
import { hasCourseProgress, storedGuestState } from "./progress-merge";
import { CLAIM_LIMITS, type GuestClaim, type GuestText } from "@/lib/guest-claim";
import type { CompCardInput } from "@/app/actions/learner";
import type { Locale } from "@/lib/cms/types";
import {
  COMP_CARD_BLANK_CONFIDENCE,
  COMP_CARD_FIELDS,
  COMP_CARD_TEXT_MAX,
  type CompCardField,
} from "@/lib/comp-card-visibility";
import { EMPTY_PROGRESS, patchSince } from "@/lib/learner-progress/patch";

/**
 * A text of the guest work as the guest store holds it: where it is (a
 * Comp Card answer, or one reflection question's answer in the course), what
 * it says, and the longest it may be to be added (D80, D62.d: refused,
 * never cut).
 */
export interface GuestTextAt {
  ref: GuestText;
  text: string;
  max: number;
  /** A reflection answer's place among the course's written ones (1, 2, …), for its label. */
  n?: number;
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
  /**
   * Its texts over COMP_CARD_TEXT_MAX, in the card's order: they can't be
   * added as they are, and are offered to be shortened (GuestWorkPrompt).
   */
  cardTooLong: { field: CompCardField; text: string }[];
  /**
   * Every answer written in the course's reflections, in order, then every
   * Comp Card answer: what can be shortened on the offer when the work is
   * too big to add (GuestWorkPrompt).
   */
  texts: GuestTextAt[];
  /** Of those, the ones too long to add as they are: offered to be shortened. */
  tooLong: GuestTextAt[];
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
  const cardTooLong = compCard
    ? COMP_CARD_FIELDS.filter((f) => answered(card[f]) && card[f].length > COMP_CARD_TEXT_MAX).map((field) => ({
        field,
        text: card[field],
      }))
    : [];
  const reflections = inCourse
    ? [course.reflection.p1, course.reflection.p2, course.reflection.p3].filter(answered).length +
      Object.values(course.responses).filter(
        (a) => a?.type === "reflection" && Object.values(a.text).some(answered)
      ).length
    : 0;
  const texts = guestTexts(guest, inCourse, compCard);
  return {
    courses: inCourse
      ? [
          course.courseTitle
            ? { title: course.courseTitle, locale: course.courseLocale ?? null }
            : { title: course.courseSlug!, locale: null },
        ]
      : [],
    compCard,
    cardTooLong,
    texts,
    tooLong: texts.filter((t) => t.text.length > t.max),
    reflections,
    badges: (guest.badges ?? []).length,
  };
}

/**
 * The written texts of a guest store's work (GuestWork.texts): the
 * course's reflection answers, the standard reflection's first, numbered in
 * order, when the course is work (`inCourse`); then the Comp Card's
 * answers, when it is (`inCard`).
 */
function guestTexts(guest: DemoState, inCourse: boolean, inCard: boolean): GuestTextAt[] {
  const out: GuestTextAt[] = [];
  if (inCourse) {
    let n = 0;
    const reflection = (key: string, text: Record<string, unknown>) => {
      for (const [prompt, value] of Object.entries(text)) {
        if (typeof value !== "string" || !answered(value)) continue;
        out.push({ ref: { part: "course", key, prompt }, text: value, max: CLAIM_LIMITS.reflectionChars, n: ++n });
      }
    };
    const r = guest.course.reflection;
    reflection("reflection/main", { p1: r.p1, p2: r.p2, p3: r.p3 });
    for (const [key, a] of Object.entries(guest.course.responses)) {
      if (a?.type === "reflection") reflection(key, a.text);
    }
  }
  if (inCard) {
    for (const field of COMP_CARD_FIELDS) {
      const text = guest.compCard[field];
      if (answered(text)) out.push({ ref: { part: "compCard", field }, text, max: CLAIM_LIMITS.cardChars });
    }
  }
  return out;
}

/**
 * What "Add it to my account" sends for a guest store (`guest`, as
 * storedGuestState reads it): each part that holds work, as it is — the
 * course as a patch of all of it, the Comp Card's texts and confidence
 * (never who sees it), the badges. Null when there is no work. Texts too
 * long to add are sent as they are: the server refuses the whole of it,
 * and the offer shows them to be shortened (D80: never cut).
 */
export function guestClaimOf(guest: DemoState): GuestClaim | null {
  const work = guestWorkOf(guest);
  if (!work) return null;
  // "claim" first: the request is known by it.
  const claim: GuestClaim = { claim: 1 };
  const course = guest.course;
  if (work.courses.length && course.courseSlug) {
    claim.course = { slug: course.courseSlug, patch: patchSince(EMPTY_PROGRESS, course) ?? { v: 2 } };
  }
  if (work.compCard) {
    const c = guest.compCard;
    const text = (v: unknown) => (typeof v === "string" ? v : "");
    claim.compCard = {
      wentWell: text(c.wentWell),
      difficult: text(c.difficult),
      improve: text(c.improve),
      behaviour: text(c.behaviour),
      confidence:
        Number.isInteger(c.confidence) && c.confidence >= 1 && c.confidence <= 5 ? c.confidence : COMP_CARD_BLANK_CONFIDENCE,
    };
  }
  const badges = [...new Set((guest.badges ?? []).filter((b): b is string => typeof b === "string" && b !== ""))];
  if (badges.length) claim.badges = badges;
  return claim;
}

/** The parts of a claim the server says are in the account: moved there, or there already. */
export interface ClaimedParts {
  course: boolean;
  compCard: boolean;
  badges: readonly string[];
}

/**
 * The guest store once a claim is answered: `read` is its text as the
 * claim read it, `now` as it is now (null: gone). A part the server says
 * is in the account (`claimed`) goes, but only if it is as it was read (a
 * tab still a guest may have saved more in it meanwhile: that stays, and
 * is offered again); a badge in the account goes. What `store` holds:
 * undefined to leave the guest store as it is, null to remove it (no work
 * left), else its new text. `more`: the browser holds work now that it
 * didn't when the claim read it.
 */
export function storeAfterClaim(
  read: string,
  now: string | null,
  claimed: ClaimedParts,
  blank: DemoState
): { store: string | null | undefined; more: boolean } {
  if (now === null) return { store: undefined, more: false };
  let was: Record<string, unknown>;
  let is: Record<string, unknown>;
  try {
    was = JSON.parse(read) as Record<string, unknown>;
    is = JSON.parse(now) as Record<string, unknown>;
    if (!was || typeof was !== "object" || !is || typeof is !== "object") throw new Error("not a store");
  } catch {
    return { store: undefined, more: now !== read };
  }
  const same = (part: string) => JSON.stringify(was[part]) === JSON.stringify(is[part]);
  const nowWork = storedGuestState(is, blank);
  const badgesOf = (s: Record<string, unknown>) => (Array.isArray(s.badges) ? (s.badges as unknown[]) : []);
  const more =
    (!same("course") && !!nowWork.course.courseSlug && hasCourseProgress(nowWork.course)) ||
    (!same("compCard") && guestWorkOf({ ...nowWork, badges: [], course: blank.course })?.compCard === true) ||
    badgesOf(is).some((b) => !badgesOf(was).includes(b));

  const next: Record<string, unknown> = { ...is };
  if (claimed.course && same("course")) {
    next.course = blank.course;
    next.refusedKeys = blank.refusedKeys;
  }
  if (claimed.compCard && same("compCard")) next.compCard = blank.compCard;
  next.badges = badgesOf(is).filter((b) => !claimed.badges.includes(b as string));
  if (JSON.stringify(next) === JSON.stringify(is)) return { store: undefined, more };
  return { store: guestWorkOf(storedGuestState(next, blank)) ? JSON.stringify(next) : null, more };
}

/**
 * The guest store's text (`raw`) with one text of its work (`ref`) put as
 * `text`: a Comp Card answer (its time changes), or a reflection answer in
 * the course. Null when the store doesn't hold that text.
 */
export function withText(raw: string, ref: GuestText, text: string): string | null {
  try {
    const stored = JSON.parse(raw) as Record<string, unknown> | null;
    if (!stored || typeof stored !== "object") return null;
    const object = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
    if (ref.part === "compCard") {
      const card = object(stored.compCard);
      if (typeof card?.[ref.field] !== "string") return null;
      stored.compCard = { ...card, [ref.field]: text, updatedAt: new Date().toISOString() };
      return JSON.stringify(stored);
    }
    const course = object(stored.course);
    if (!course) return null;
    if (ref.key === "reflection/main") {
      const reflection = object(course.reflection);
      if (typeof reflection?.[ref.prompt] !== "string") return null;
      stored.course = { ...course, reflection: { ...reflection, [ref.prompt]: text } };
      return JSON.stringify(stored);
    }
    const responses = object(course.responses);
    const answer = object(responses?.[ref.key]);
    const answerText = object(answer?.text);
    if (answer?.type !== "reflection" || typeof answerText?.[ref.prompt] !== "string") return null;
    stored.course = {
      ...course,
      responses: { ...responses, [ref.key]: { ...answer, text: { ...answerText, [ref.prompt]: text } } },
    };
    return JSON.stringify(stored);
  } catch {
    return null;
  }
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
