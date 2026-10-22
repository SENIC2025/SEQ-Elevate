/**
 * Moving a guest's progress into the account they sign in to.
 *
 * A guest's progress lives in this browser's guest store (localStorage).
 * Release 3 (D79, spec 5.5): it moves only when the person signed in says
 * it is theirs ("Add it to my account", claimGuestWork in demo-state.tsx),
 * once their profile step is done — on a shared computer it may be someone
 * else's. Until then it stays in the guest store, untouched, and the
 * learner store offers it (guestWorkOf). It fills only what the account
 * lacks, as the account is when each write lands: what the account has
 * saved always wins (D37, D69), answer by answer in the course (the guest
 * store holds one; it is sent in fill mode, and the server says where it
 * kept an answer of the account's over the guest's) and field by field in
 * the Comp Card (filled on the server under its row's lock), so a course
 * the account started elsewhere still gets the guest's lessons, answers
 * and completion (D79: what the page says was added is in the account). A
 * Comp Card the account shares gets nothing: moving never shares (D80);
 * the guest's card stays in the browser (`cardHeldBack`). A text of the
 * guest's card longer than a card holds (COMP_CARD_TEXT_MAX), where the
 * account's card has none, isn't moved (a longer text is refused, never
 * cut, D80) and isn't dropped either: it alone stays in the browser
 * (`cardTooLong`), and the page says which and offers to shorten it there.
 * No write is given up on at its first failure — a dropped connection, or
 * a session lookup that failed (the save actions fail then: see
 * requireLearner in src/app/actions/learner.ts) — and one failure doesn't
 * stop the rest: each write is tried again (retry.ts). One refused as
 * another account's stops the move (someone else signed in on this
 * browser): none of it would land in the account that started it. What
 * didn't move — a write that never got through, a Comp Card held back —
 * stays in the guest store, and only that (`left`, guestStoreLeft): it is
 * the copy that outlives a tab closed mid-move, and is offered again;
 * moving it twice changes nothing the account has. The page shows only
 * what the server confirmed.
 *
 * No React: DemoStateProvider in demo-state.tsx applies it.
 */

import type { CompCardData, CourseProgress, DemoState } from "./demo-state";
import { hasCourseProgress, storedGuestState } from "./progress-merge";
import { CLAIM_LIMITS, type GuestClaim, type GuestText } from "@/lib/guest-claim";
import type { CompCardInput, SavedCompCard } from "@/app/actions/learner";
import type { Locale } from "@/lib/cms/types";
import {
  COMP_CARD_BLANK_CONFIDENCE,
  COMP_CARD_FIELDS,
  COMP_CARD_TEXT_MAX,
  type CompCardField,
} from "@/lib/comp-card-visibility";
import { withRetry } from "./retry";
import { isRefusedAward } from "@/lib/badge-award";
import type { ProgressPatch, ProgressState, RefusedKey } from "@/lib/learner-progress/contract";
import { EMPTY_PROGRESS, applyPatch, fitPatch, patchSince, withoutRefused } from "@/lib/learner-progress/patch";

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
  /** saveCompCard, in fill mode (`fill: true`, cardFill's fields): never who sees the card. */
  saveCompCard(input: CompCardInput): Promise<unknown>;
  /** saveCourseProgressPatch, with a patch in fill mode. */
  saveCourse(slug: string, patch: ProgressPatch): Promise<unknown>;
}

/** What of the guest store is still to move: the badges, its Comp Card, and whether its course. */
export interface GuestLeft {
  badges: string[];
  /**
   * Its Comp Card: all of it (true), only these texts (too long to move as
   * they are, `cardTooLong`; the rest of the card moved), or none (false).
   */
  compCard: boolean | CompCardField[];
  course: boolean;
}

export interface Migrated {
  /** The account's badges, then the guest's: what the store shows. */
  badges: string[];
  /** Of those, the ones the server holds now; the store awards the rest. */
  awarded: string[];
  /**
   * The Comp Card as the account holds it after the move: the server's,
   * once filled (`cardMoved`); else the saved one as read (null: none).
   */
  compCard: CompCardData | null;
  /** Did the guest's Comp Card go into the account (the server confirmed it)? */
  cardMoved: boolean;
  /** The guest's course, when it holds any progress (null: none). */
  course: CourseProgress | null;
  /** Did the guest's course go into the account (the server confirmed every save of it)? */
  courseMoved: boolean;
  /** Did any write get through (so server-rendered pages are stale)? */
  wrote: boolean;
  /** Did every write get through or get refused for good (none left to try)? */
  settled: boolean;
  /**
   * Did the account keep an answer of its own over a different one of the
   * guest's: in the course (the server says where, `kept`), or in the Comp
   * Card (a text, or the confidence, the card has its own of)?
   */
  accountFirst: boolean;
  /**
   * Did something of the guest's Comp Card stay in the browser for a reason
   * no try changes: text for a card the account shares, so that nothing of
   * it moved (D80), or a text too long to move (`cardTooLong`)?
   */
  cardHeldBack: boolean;
  /**
   * The guest's Comp Card texts over COMP_CARD_TEXT_MAX that the account's
   * card has none of: not moved (the server refuses a longer text, never
   * cuts it, D80) and kept in the browser alone, for the learner to shorten
   * and add (GuestWorkPrompt). Empty when there are none, and when the card
   * stays whole (a shared card, a write that didn't get through).
   */
  cardTooLong: CompCardField[];
  /**
   * Was a write refused as another account's? Someone else signed in on
   * this browser meanwhile: the move stopped there, and nothing is settled.
   */
  otherAccount: boolean;
  /** What of the guest store is still to move (guestStoreLeft); null: nothing. */
  left: GuestLeft | null;
}

/** The confidence of a card no one has touched: the blank card's (DEFAULT_STATE) and the database's default. */
const BLANK_CONFIDENCE = COMP_CARD_BLANK_CONFIDENCE;

/**
 * What of the guest's Comp Card (`guest`) an account whose card is `saved`
 * gets (D37, D69: the account wins, field by field): every text it holds,
 * within COMP_CARD_TEXT_MAX, where the saved card has none, and its
 * confidence when the saved card has nothing in it at all (a card in use
 * has a confidence of its own, even the default). No saved card: the whole
 * card (cardToSave). Null when there is nothing to fill in, or the guest
 * never filled the card in. Never who sees the card. The server applies the
 * same rule again to the card as it is when the fill is written
 * (compCardFill), so a text saved elsewhere since `saved` was read stays.
 */
export function cardFill(guest: CompCardData, saved: CompCardData | null): CompCardInput | null {
  if (!guest.updatedAt) return null;
  if (!saved) return cardToSave(guest);
  const input: CompCardInput = {};
  for (const field of COMP_CARD_FIELDS) {
    const text = guest[field];
    if (answered(text) && !answered(saved[field]) && text.length <= COMP_CARD_TEXT_MAX) input[field] = text;
  }
  const savedBlank = COMP_CARD_FIELDS.every((f) => !answered(saved[f])) && saved.confidence === BLANK_CONFIDENCE;
  if (savedBlank && guest.confidence !== BLANK_CONFIDENCE) input.confidence = guest.confidence;
  return Object.keys(input).length > 0 ? input : null;
}

/**
 * The texts of the guest's Comp Card (`guest`) an account whose card is
 * `saved` lacks, but which are over COMP_CARD_TEXT_MAX: cardFill leaves
 * them out, as the server would refuse them (D80: never cut), so they stay
 * in the browser to be shortened (`cardTooLong`). Where the saved card has
 * a text of its own the account's stays (cardFill), long or not.
 */
export function cardTooLong(guest: CompCardData, saved: CompCardData | null): CompCardField[] {
  if (!guest.updatedAt) return [];
  return COMP_CARD_FIELDS.filter(
    (f) => answered(guest[f]) && guest[f].length > COMP_CARD_TEXT_MAX && !(saved && answered(saved[f]))
  );
}

/**
 * Did the account's Comp Card (`card`, after the move) keep something of
 * its own over the guest's (`guest`): a text the guest wrote that isn't in
 * it because the card has another, or a confidence the guest chose that it
 * doesn't have?
 */
function cardKeptOwn(guest: CompCardData, card: CompCardData): boolean {
  return (
    COMP_CARD_FIELDS.some((f) => answered(guest[f]) && answered(card[f]) && card[f] !== guest[f]) ||
    (guest.confidence !== BLANK_CONFIDENCE && card.confidence !== guest.confidence)
  );
}

/** A write's answer that no try can change: a refusal ({ ok: false }). Another account's is told apart. */
function refusal(result: unknown): { otherAccount: boolean; shared: boolean } | null {
  if (!isRefusedAward(result)) return null;
  const r = result as { reason?: unknown; error?: unknown };
  return {
    otherAccount: r.reason === "other-account" || r.error === "other-account",
    shared: r.error === "shared",
  };
}

/** The most saves one course's move is split into (fitPatch): far more than any course needs. */
const MOST_COURSE_SAVES = 20;

/**
 * Moves `guest` into the account that has `saved`, with `writes`, each
 * tried again with `retry` when it fails. It never rejects for a write
 * that doesn't get through: see Migrated for what it reports, and
 * guestStoreLeft for what stays in the browser.
 */
export async function migrateGuest(
  guest: DemoState,
  saved: SavedGlobal,
  writes: GuestWrites,
  retry: <T>(call: () => Promise<T>) => Promise<T> = (call) => withRetry(call)
): Promise<Migrated> {
  let wrote = false;
  let settled = true;
  let otherAccount = false;
  /**
   * One write: its answer once it got through; else why not — it failed
   * on every try, the server refused it for good (logged), the card is
   * shared, or another account's session is on this browser now (nothing
   * more is sent then: none of it would land).
   */
  const write = async (
    call: () => Promise<unknown>
  ): Promise<{ done: true; result: unknown } | { done: false; why: "failed" | "refused" | "shared" | "other-account" }> => {
    if (otherAccount) return { done: false, why: "other-account" };
    try {
      const result = await retry(call);
      // A refusal (a badge the server has no row for, a course it doesn't
      // have, another account's session) is answered, not thrown, so it
      // isn't tried again: no try could succeed. It isn't counted as saved.
      const refused = refusal(result);
      if (refused?.otherAccount) {
        otherAccount = true;
        settled = false;
        return { done: false, why: "other-account" };
      }
      if (refused?.shared) return { done: false, why: "shared" };
      if (refused) {
        console.error("The server refused a guest's progress; it isn't saved.", result);
        return { done: false, why: "refused" };
      }
      wrote = true;
      return { done: true, result };
    } catch (err) {
      settled = false;
      console.error("A guest's progress didn't reach their account; it stays in this browser.", err);
      return { done: false, why: "failed" };
    }
  };
  /** Not in the account, and a later move may still get it there. */
  const stays = (why: string) => why === "failed" || why === "other-account";
  const left: GuestLeft = { badges: [], compCard: false, course: false };

  // Badges: a union. Awarding is idempotent.
  const known = new Set(saved.badges);
  const newBadges = (guest.badges ?? []).filter((b) => !known.has(b));
  const awarded = [...saved.badges];
  for (const slug of newBadges) {
    const done = await write(() => writes.awardBadge(slug));
    if (done.done) awarded.push(slug);
    else if (stays(done.why)) left.badges.push(slug);
  }

  // Comp Card: what the account's lacks, field by field (cardFill), written
  // by the server in fill mode against the card as it is then; no card, the
  // guest's, as "Only me" (the save never shares). A card the account
  // shares gets nothing: what moves into it would be shared without the
  // learner choosing so (D80); the server says so too if it was shared
  // since it was read. A refused save isn't counted as saved, and isn't
  // tried again. A text over the limit isn't sent (cardFill): it stays in
  // the browser alone (cardTooLong), the rest of the card moves.
  let compCard = saved.compCard;
  let cardMoved = false;
  // The whole card stays: the account's is shared.
  let cardHeldBack = false;
  let accountFirst = false;
  const guestCard = guest.compCard;
  const fill = guestCard ? cardFill(guestCard, saved.compCard) : null;
  const tooLong = guestCard ? cardTooLong(guestCard, saved.compCard) : [];
  if (guestCard && (fill || tooLong.length)) {
    if (saved.compCard?.sharing === "facilitators") {
      cardHeldBack = true;
    } else if (fill) {
      const done = await write(() => writes.saveCompCard({ ...fill, fill: true }));
      if (done.done) {
        cardMoved = true;
        const base: CompCardData = saved.compCard ?? { ...guestCard, sharing: "onlyMe", sharedAt: null, organisationName: null };
        const server = (done.result as { card?: SavedCompCard | null } | undefined)?.card;
        compCard = server
          ? { ...base, ...server }
          : saved.compCard
            ? { ...saved.compCard, ...fill, updatedAt: guestCard.updatedAt }
            : base;
      } else if (done.why === "shared") {
        cardHeldBack = true;
      } else if (stays(done.why)) {
        left.compCard = true;
      }
    }
  }
  if (cardHeldBack) left.compCard = true;
  // What the account kept of its own over the guest's card: as it is once
  // filled, or as it was read when there was nothing to fill.
  if (guestCard?.updatedAt && !cardHeldBack && compCard && (cardMoved || !fill)) {
    accountFirst ||= cardKeptOwn(guestCard, compCard);
  }
  // A text too long to move stays in the browser, alone, unless the whole
  // card does.
  if (tooLong.length && left.compCard === false) left.compCard = tooLong;

  // Course: the guest store only holds the last-played course. Everything
  // the guest did in it is sent in fill mode, also when the account has
  // progress in it: the server keeps the account's lessons and answers and
  // adds only what it lacks, the completion included, and says where it
  // kept an answer of the account's over another (`kept`). A course too
  // big for one save is sent in several (fitPatch).
  let course: CourseProgress | null = null;
  let courseMoved = false;
  const gc = guest.course;
  const slug = gc?.courseSlug;
  if (slug && hasCourseProgress(gc)) {
    course = gc;
    courseMoved = true;
    let sent: ProgressState = EMPTY_PROGRESS;
    for (let i = 0; i < MOST_COURSE_SAVES; i++) {
      const all = patchSince(sent, gc);
      const fitted = all ? fitPatch({ ...all, fill: true }) : null;
      if (!fitted?.patch) break;
      const patch = fitted.patch;
      const done = await write(() => writes.saveCourse(slug, patch));
      if (!done.done) {
        courseMoved = false;
        if (stays(done.why)) left.course = true;
        break;
      }
      const result = done.result as { refused?: RefusedKey[]; kept?: string[] } | undefined;
      if (result?.kept?.length) accountFirst = true;
      if (!fitted.more) break;
      sent = applyPatch(sent, withoutRefused(patch, result?.refused ?? []));
    }
  }
  if (otherAccount) {
    // None of it is in the account signed in now: all of it stays.
    left.badges = newBadges;
    left.compCard = !!fill || cardHeldBack || tooLong.length > 0;
    left.course = !!course;
  }

  const cardTooLongLeft = Array.isArray(left.compCard) ? left.compCard : [];
  const nothingLeft = !left.badges.length && !left.compCard && !left.course;
  return {
    badges: [...saved.badges, ...newBadges],
    awarded,
    compCard,
    cardMoved,
    course,
    courseMoved,
    wrote,
    settled,
    accountFirst,
    cardHeldBack: cardHeldBack || cardTooLongLeft.length > 0,
    cardTooLong: cardTooLongLeft,
    otherAccount,
    left: nothingLeft ? null : left,
  };
}

/**
 * The guest store once a move has taken what it could (`left`, from
 * migrateGuest): only what is still to move — the badges not awarded, the
 * Comp Card held back or not saved (or only its texts too long to move),
 * the course not saved — so a later "Add" moves only that, never again
 * what the account may have changed since (spec 5.5). Null when nothing is
 * left. `blank` is the empty store.
 */
export function guestStoreLeft(guest: DemoState, left: GuestLeft | null, blank: DemoState): DemoState | null {
  if (!left) return null;
  const card = left.compCard;
  return {
    ...blank,
    projectId: guest.projectId,
    role: guest.role,
    badges: left.badges,
    compCard:
      card === true
        ? guest.compCard
        : card
          ? {
              ...blank.compCard,
              ...Object.fromEntries(card.map((f) => [f, guest.compCard[f]])),
              updatedAt: guest.compCard.updatedAt,
            }
          : blank.compCard,
    course: left.course ? guest.course : blank.course,
  };
}

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
