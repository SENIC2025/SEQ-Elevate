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
 * the guest's card stays in the browser (`cardHeldBack`).
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
import { hasCourseProgress } from "./progress-merge";
import type { CompCardInput, SavedCompCard } from "@/app/actions/learner";
import type { Locale } from "@/lib/cms/types";
import { COMP_CARD_BLANK_CONFIDENCE, COMP_CARD_FIELDS, COMP_CARD_TEXT_MAX } from "@/lib/comp-card-visibility";
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

/** What of the guest store is still to move: the badges, and whether its Comp Card and its course. */
export interface GuestLeft {
  badges: string[];
  compCard: boolean;
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
  /** Did the guest's Comp Card have text for a card the account shares, so that nothing of it moved (D80)? */
  cardHeldBack: boolean;
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
  // since it was read. A refused save (a text over the limit) isn't
  // counted as saved, and isn't tried again.
  let compCard = saved.compCard;
  let cardMoved = false;
  let cardHeldBack = false;
  let accountFirst = false;
  const guestCard = guest.compCard;
  const fill = guestCard ? cardFill(guestCard, saved.compCard) : null;
  if (guestCard && fill) {
    if (saved.compCard?.sharing === "facilitators") {
      cardHeldBack = true;
    } else {
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
    left.compCard = !!fill || cardHeldBack;
    left.course = !!course;
  }

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
    cardHeldBack,
    otherAccount,
    left: nothingLeft ? null : left,
  };
}

/**
 * The guest store once a move has taken what it could (`left`, from
 * migrateGuest): only what is still to move — the badges not awarded, the
 * Comp Card held back or not saved, the course not saved — so a later
 * "Add" moves only that, never again what the account may have changed
 * since (spec 5.5). Null when nothing is left. `blank` is the empty store.
 */
export function guestStoreLeft(guest: DemoState, left: GuestLeft | null, blank: DemoState): DemoState | null {
  if (!left) return null;
  return {
    ...blank,
    projectId: guest.projectId,
    role: guest.role,
    badges: left.badges,
    compCard: left.compCard ? guest.compCard : blank.compCard,
    course: left.course ? guest.course : blank.course,
  };
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
