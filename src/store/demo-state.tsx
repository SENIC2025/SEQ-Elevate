"use client";

import * as React from "react";
import { getSession, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  ensureLearnerMembership,
  loadLearnerGlobal,
  loadCourseProgress,
  saveCourseProgress,
  saveCourseProgressPatch,
  saveCompCard,
  setCompCardSharing,
  awardBadgeAction,
  claimGuestWork as claimGuestWorkAction,
} from "@/app/actions/learner";
import { COMP_CARD_FIELDS, type Sharing } from "@/lib/comp-card-visibility";
import { claimTooLarge, type ClaimCardOutcome, type ClaimCourseOutcome, type GuestClaimResult, type GuestText } from "@/lib/guest-claim";
import type { Locale } from "@/lib/cms/types";
import {
  answerQuestion,
  readAssessment,
  retakeQuiz,
  type AssessmentProgress,
} from "@/lib/assessment-progress";
import {
  isCustomSectionId,
  isSectionId,
  type PartKey,
  type SectionId,
} from "@/lib/cms/sections/contract";
import type {
  KeyRefusal,
  ProgressPatch,
  ProgressState,
  RefusedKey,
  StoredAnswer,
} from "@/lib/learner-progress/contract";
import { completeLesson, withAnswer } from "@/lib/learner-progress/answers";
import { EMPTY_PROGRESS, applyPatch, patchSince } from "@/lib/learner-progress/patch";
import {
  courseAfterLoad,
  courseAfterMigration,
  guestStateAfterHydrate,
  mergeBadges,
  mergeCompCardOnHydrate,
  storedGuestState,
} from "./progress-merge";
import { guestClaimOf, guestWorkOf, storeAfterClaim, withText, type GuestWork } from "./guest-migration";
import { cardAfterReread, guestCardOrBadgesChanged, saveCard, savedCardOf, type SavedCard } from "./card-save";
import { courseChanged, courseLoaded, courseSaveRefs, saveCourse } from "./course-save";
import { clearEveryOutbox, restoreOutbox } from "./outbox";
import { pendingSave } from "./pending-save";
import { RETRY_DELAYS_MS, wait, withRetry } from "./retry";
import { isRefusedAward } from "@/lib/badge-award";
import {
  SESSION_RECHECK_MS,
  forgetLearner,
  sessionChange,
  sessionOwner,
} from "./session-owner";

/**
 * Learner state. For AUTHENTICATED users it's backed by Postgres (Neon)
 * via server actions — progress, Comp Card and badges persist server-side
 * and follow the learner across devices. For GUESTS it falls back to
 * localStorage (the instant-clickable demo). The component-facing API
 * (useDemoState) is identical for both.
 */

export type Role = "learner" | "facilitator" | "admin" | "content";

export interface SimulationAttempt {
  choice: string;
  correct: boolean;
}

export interface ScenarioAttempt {
  root: string | null;
  followup: string | null;
  /** Human-readable choice text, stored so Comp Card / facilitator views
   *  display the evidence without re-resolving against course content. */
  rootLabel: string | null;
  followupLabel: string | null;
}

export interface ReflectionAnswers {
  p1: string;
  p2: string;
  p3: string;
}

export type { AssessmentProgress };

export interface CourseProgress {
  /** The course currently being played (set when the player mounts). */
  courseSlug: string | null;
  courseTitle: string | null;
  /**
   * Release 3 (D90, spec 9.3): the language the course's title and its
   * scenario's choice texts are in, which is English on a German or Greek
   * page until that language is switched on for the course; the Comp Card
   * marks them with it (WCAG 3.1.2). Unknown (undefined) in a guest store
   * written before it, which is shown unmarked, as before.
   */
  courseLocale?: Locale | null;
  stagesCompleted: string[];
  simulation: SimulationAttempt | null;
  scenario: ScenarioAttempt;
  reflection: ReflectionAnswers;
  /** Quick-check answers by question id, and whether they were checked. */
  assessment: AssessmentProgress;
  /**
   * Release 2 (D62): lessons of the course's own finished ("s-…"). Standard
   * lessons stay in stagesCompleted, which never holds one of these, so
   * Release 1's save never meets one after a rollback.
   */
  sectionsCompleted: string[];
  /**
   * Release 2 (D62): every answer without a field above, by
   * "lessonId/contentId" (src/lib/learner-progress/answers.ts). `retaken`
   * marks a quick check tried again on this page, as assessment's does.
   */
  responses: Partial<Record<PartKey, StoredAnswer & { retaken?: true }>>;
  completedAt: string | null;
}

// Release 1's save of a course's whole progress is never called by this
// build, but pages loaded before the deploy still call it (D62.e, D68). Next
// builds only the server actions client code refers to — an action no page
// refers to answers "not found" — so it is referred to here, and stays.
void saveCourseProgress;

// The store's course progress is what patches are worked out from
// (src/lib/learner-progress/patch.ts).
const _isProgressState = (c: CourseProgress): ProgressState => c;
void _isProgressState;

export interface CompCardData {
  wentWell: string;
  difficult: string;
  improve: string;
  behaviour: string;
  confidence: number;
  /**
   * Who sees the card (D80): "Only me", or the facilitators of the learner's
   * organisation. The server's, always (loadLearnerGlobal); changed only by
   * its own action (setSharing), never as an edit of the card.
   */
  sharing: Sharing;
  /** When it was shared, and with whom; null when it isn't. */
  sharedAt?: string | null;
  organisationName?: string | null;
  updatedAt: string | null;
}

export interface DemoState {
  /**
   * Project the learner is currently in. Defaults to "seq-elevate".
   * Every other field below is conceptually scoped to this project — in
   * the real platform, swapping project loads a different state row from
   * the database. In the demo, swapping project clears the current state.
   */
  projectId: string;
  role: Role | null;
  badges: string[];
  course: CourseProgress;
  compCard: CompCardData;
  /**
   * Answers of the course being played the server refused, or the store
   * holds back because it would (spec 5.8): by key, why. Cleared for a key
   * when the learner changes its answer.
   */
  refusedKeys: Partial<Record<string, KeyRefusal>>;
}

export const DEFAULT_STATE: DemoState = {
  projectId: "seq-elevate",
  role: null,
  badges: [],
  course: {
    courseSlug: null,
    courseTitle: null,
    stagesCompleted: [],
    simulation: null,
    scenario: { root: null, followup: null, rootLabel: null, followupLabel: null },
    reflection: { p1: "", p2: "", p3: "" },
    assessment: { answers: {}, checked: false },
    sectionsCompleted: [],
    responses: {},
    completedAt: null,
  },
  compCard: {
    wentWell: "",
    difficult: "",
    improve: "",
    behaviour: "",
    confidence: 3,
    sharing: "onlyMe",
    sharedAt: null,
    organisationName: null,
    updatedAt: null,
  },
  refusedKeys: {},
};

/** This tab's sessionStorage, for the outbox; null where the browser has none or blocks it. */
function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * What the server holds of a course, from what loadCourseProgress answered
 * (null: nothing), as patches are worked out against it. A server from
 * before Release 2 (a rollback) answers without the new fields: none.
 */
function savedProgress(saved: CourseProgress | null): ProgressState {
  if (!saved) return EMPTY_PROGRESS;
  return {
    stagesCompleted: saved.stagesCompleted,
    sectionsCompleted: saved.sectionsCompleted ?? [],
    simulation: saved.simulation,
    scenario: saved.scenario,
    reflection: saved.reflection,
    assessment: readAssessment(saved.assessment),
    responses: saved.responses ?? {},
    completedAt: saved.completedAt,
  };
}

/** The same texts and confidence: what a Comp Card save sends. */
function sameCardText(a: CompCardData, b: CompCardData): boolean {
  return (
    a.wentWell === b.wentWell &&
    a.difficult === b.difficult &&
    a.improve === b.improve &&
    a.behaviour === b.behaviour &&
    a.confidence === b.confidence
  );
}

const STORAGE_KEY = "seq-elevate-demo-state-v1";

/** ensureLearnerMembership's answer before the profile step is done (D79). */
const PROFILE_INCOMPLETE = Symbol("profile-incomplete");

/** This browser's guest store, as storedGuestState reads it; null when there is none or it can't be read. */
function readGuestStore(): DemoState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? storedGuestState(JSON.parse(raw), DEFAULT_STATE) : null;
  } catch {
    return null;
  }
}

/** The work this browser's guest store holds (guest-migration.ts), if any. */
function readGuestWork(): GuestWork | null {
  const guest = readGuestStore();
  return guest ? guestWorkOf(guest) : null;
}

/**
 * What became of the guest store's work on this page (GuestWorkPrompt):
 *   claimed      the server answered "Add it to my account" part by part
 *                (src/lib/guest-claim.ts): each part the claim had, and how
 *                many of its badges are in the account (moved there, or
 *                there already) or can't be given there; `more`: the
 *                browser holds work now that the claim didn't read (a tab
 *                still a guest saved more meanwhile);
 *   tooLong      nothing was written: `count` texts are too long to add,
 *                and are offered to be shortened;
 *   tooLarge     nothing was written: the work is too big to add;
 *   otherAccount nothing was written: another account is signed in on this
 *                browser now;
 *   unconfirmed  no answer came back, after every try: the work stays here,
 *                and adding it again changes nothing twice;
 *   failed       the server refused it as no claim at all;
 *   nothing      the browser held no work any more (added or removed in
 *                another tab meanwhile, or not readable);
 *   removed      removed from this browser, nothing sent.
 */
export type GuestWorkDone =
  | { kind: "nothing" | "removed" | "failed" | "unconfirmed" | "otherAccount" | "tooLarge" }
  | { kind: "tooLong"; count: number }
  | {
      kind: "claimed";
      course?: { outcome: ClaimCourseOutcome; title: string; locale: Locale | null };
      compCard?: ClaimCardOutcome;
      badgesMoved: number;
      badgesAlready: number;
      badgesRefused: number;
      more: boolean;
    };

/**
 * Removes the guest store if it still holds `read`, the text the move read
 * (compare and remove): a tab still a guest may have saved more since, and
 * that stays. "removed", "gone" (another tab removed it meanwhile) or
 * "changed".
 */
function removeGuestStoreIf(read: string): "removed" | "gone" | "changed" {
  try {
    const now = window.localStorage.getItem(STORAGE_KEY);
    if (now === null) return "gone";
    if (now !== read) return "changed";
    window.localStorage.removeItem(STORAGE_KEY);
    return "removed";
  } catch {
    return "gone"; // the browser's storage can't be reached: nothing to remove or offer
  }
}

type Action =
  | { type: "setProject"; projectId: string }
  | { type: "setRole"; role: Role | null }
  | { type: "setCourseContext"; slug: string; title: string; locale?: Locale }
  | { type: "completeStage"; stage: string }
  | { type: "recordSimulation"; attempt: SimulationAttempt }
  | { type: "recordScenarioRoot"; choice: string; label: string }
  | { type: "recordScenarioFollowup"; choice: string; label: string }
  | { type: "updateReflection"; patch: Partial<ReflectionAnswers> }
  | { type: "answerAssessment"; questionId: string; optionId: string }
  | { type: "checkAssessment" }
  | { type: "retakeAssessment" }
  | { type: "completeCourse" }
  | { type: "awardBadge"; badge: string }
  | { type: "updateCompCard"; patch: Partial<CompCardData> }
  /** Who sees the Comp Card, as shown: not an edit (updatedAt stays). */
  | { type: "sharingShown"; sharing: Sharing; sharedAt: string | null; organisationName: string | null }
  | { type: "reset" }
  | { type: "forgetLearner" }
  | { type: "hydrate"; state: DemoState }
  | { type: "hydrateGlobal"; compCard: CompCardData | null; badges: string[] }
  | { type: "guestCourseMigrated"; course: CourseProgress }
  /**
   * The course being played, read again after guest work moved into it
   * ("Add it to my account"): what the server holds now (`saved`), with
   * what this page did that the server didn't have yet (since `base`, what
   * it held before) on top — never this page's older copy over the server's.
   */
  | { type: "courseReread"; slug: string; saved: CourseProgress | null; base: ProgressState }
  /**
   * The Comp Card as the server holds it after guest work moved into it
   * (`card`), but for the fields the learner changed on this page since the
   * move began (`before`: the card then).
   */
  | { type: "cardAfterClaim"; card: CompCardData; before: CompCardData }
  | { type: "accountReread"; compCard: CompCardData | null; saved: SavedCard; badges: string[] }
  /**
   * `migrated`: the guest's course, when it moved into the account on
   * sign-in and this is its first load — the account's answers come first
   * (progress-merge.ts).
   */
  | {
      type: "courseProgressLoaded";
      slug: string;
      saved: CourseProgress | null;
      migrated?: CourseProgress | null;
    }
  // Release 2 (spec 5.4). The actions above stay as they are, so the stage
  // screens keep working.
  /** A lesson finished: a standard one to stagesCompleted, one of the course's own to sectionsCompleted. */
  | { type: "completeLesson"; id: SectionId }
  /**
   * An answer to `key`, where it lives (answers.ts): the four standard
   * answers in their fields, everything else in responses. `labels` are a
   * scenario's choice texts, for the Comp Card and the facilitator.
   */
  | {
      type: "answerPart";
      key: PartKey;
      answer: StoredAnswer;
      labels?: { root?: string | null; followup?: string | null };
    }
  /** Keys of `slug` the server refused, or the store holds back: the learner is told. */
  | { type: "progressRefused"; slug: string; keys: RefusedKey[] }
  /** What this tab's outbox kept for `slug` (outbox.ts), applied as changes made here. */
  | { type: "outboxRestored"; slug: string; patch: ProgressPatch };

/** `state` with `course` in place of its course progress. */
const withCourse = (state: DemoState, course: CourseProgress): DemoState =>
  course === state.course ? state : { ...state, course };

/** `state` without a refusal for `key`: the learner changed that answer. */
function answerChanged(state: DemoState, key: string): DemoState {
  if (!(key in state.refusedKeys)) return state;
  const { [key]: _gone, ...refusedKeys } = state.refusedKeys;
  void _gone;
  return { ...state, refusedKeys };
}

/** The store's reducer; exported for its tests (demo-state.test.ts). */
export function reducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case "setProject":
      // Switching project resets the per-project state.
      // In production this would load the user's project-scoped row from the DB.
      return { ...DEFAULT_STATE, projectId: action.projectId };
    case "setRole":
      return { ...state, role: action.role };
    case "setCourseContext":
      // The same course opened again: nothing changes. A new course object
      // would make the write-through save it, enrolling a learner who has
      // only opened it.
      if (
        state.course.courseSlug === action.slug &&
        state.course.courseTitle === action.title &&
        state.course.courseLocale === action.locale
      ) {
        return state;
      }
      // If the learner opens a different course than the one in progress,
      // reset the per-course progress for the new course.
      if (state.course.courseSlug && state.course.courseSlug !== action.slug) {
        return {
          ...state,
          course: {
            ...DEFAULT_STATE.course,
            courseSlug: action.slug,
            courseTitle: action.title,
            courseLocale: action.locale,
          },
          refusedKeys: DEFAULT_STATE.refusedKeys,
        };
      }
      return {
        ...state,
        course: {
          ...state.course,
          courseSlug: action.slug,
          courseTitle: action.title,
          courseLocale: action.locale,
        },
      };
    case "completeStage":
      // A lesson of the course's own never goes to stagesCompleted.
      if (isCustomSectionId(action.stage)) {
        return withCourse(state, completeLesson(state.course, action.stage));
      }
      return state.course.stagesCompleted.includes(action.stage)
        ? state
        : {
            ...state,
            course: {
              ...state.course,
              stagesCompleted: [...state.course.stagesCompleted, action.stage],
            },
          };
    case "recordSimulation":
      return {
        ...state,
        course: { ...state.course, simulation: action.attempt },
      };
    case "recordScenarioRoot":
      return {
        ...state,
        course: {
          ...state.course,
          scenario: {
            root: action.choice,
            rootLabel: action.label,
            followup: null,
            followupLabel: null,
          },
        },
      };
    case "recordScenarioFollowup":
      return {
        ...state,
        course: {
          ...state.course,
          scenario: {
            ...state.course.scenario,
            followup: action.choice,
            followupLabel: action.label,
          },
        },
      };
    case "updateReflection":
      return {
        ...answerChanged(state, "reflection/main"),
        course: {
          ...state.course,
          reflection: { ...state.course.reflection, ...action.patch },
        },
      };
    case "answerAssessment":
      return {
        ...state,
        course: {
          ...state.course,
          assessment: answerQuestion(
            state.course.assessment,
            action.questionId,
            action.optionId
          ),
        },
      };
    case "checkAssessment":
      return state.course.assessment.checked
        ? state
        : {
            ...state,
            course: {
              ...state.course,
              assessment: { ...state.course.assessment, checked: true },
            },
          };
    case "retakeAssessment":
      // "Try again" on a checked quick check: answered and checked afresh,
      // and saved like any change, so the latest check is the one the
      // facilitator sees. It's never merged away by the saved check if
      // that arrives later (see assessment-progress.ts).
      return {
        ...state,
        course: { ...state.course, assessment: retakeQuiz() },
      };
    case "completeCourse":
      return {
        ...state,
        course: { ...state.course, completedAt: new Date().toISOString() },
      };
    case "awardBadge":
      return state.badges.includes(action.badge)
        ? state
        : { ...state, badges: [...state.badges, action.badge] };
    case "updateCompCard":
      return {
        ...state,
        compCard: {
          ...state.compCard,
          ...action.patch,
          updatedAt: new Date().toISOString(),
        },
      };
    case "sharingShown":
      return {
        ...state,
        compCard: {
          ...state.compCard,
          sharing: action.sharing,
          sharedAt: action.sharedAt,
          organisationName: action.organisationName,
        },
      };
    case "reset":
      return DEFAULT_STATE;
    case "forgetLearner":
      // The session changed hands: nothing of the learner's stays (see
      // session-owner.ts).
      return forgetLearner(state, DEFAULT_STATE);
    case "hydrate":
      // A guest's stored progress, read once the session is known: what
      // was done meanwhile is kept, and the course being played stays
      // that course (see progress-merge.ts).
      return guestStateAfterHydrate(state, action.state, DEFAULT_STATE);
    case "hydrateGlobal":
      // Badges are a union: one earned before the saved ones arrived (a
      // course finished while they loaded) must not be dropped. The Comp
      // Card is merged too: what the learner entered while the saved card
      // loaded is newer, and kept (see progress-merge.ts).
      return {
        ...state,
        badges: mergeBadges(action.badges, state.badges),
        compCard: mergeCompCardOnHydrate(
          state.compCard,
          action.compCard,
          DEFAULT_STATE.compCard
        ),
      };
    case "guestCourseMigrated": {
      // Only into the course being played (or none): another course's
      // player keeps its own progress (see progress-merge.ts).
      const course = courseAfterMigration(state.course, action.course);
      return course ? { ...state, course } : state;
    }
    case "courseProgressLoaded": {
      // Merged with what the learner did while it loaded, never swapped in
      // (see progress-merge.ts). A new course object means there's
      // something to save; null means nothing changes.
      const course = courseAfterLoad(state.course, action.slug, action.saved, action.migrated);
      return course ? { ...state, course } : state;
    }
    case "courseReread": {
      if (state.course.courseSlug !== action.slug) return state;
      const local = patchSince(action.base, state.course);
      const server = savedProgress(action.saved);
      const fresh: CourseProgress = {
        ...DEFAULT_STATE.course,
        ...server,
        courseSlug: action.slug,
        courseTitle: state.course.courseTitle ?? action.saved?.courseTitle ?? null,
        courseLocale: state.course.courseTitle ? state.course.courseLocale : action.saved?.courseLocale,
        scenario: {
          root: server.scenario.root,
          followup: server.scenario.followup,
          rootLabel: server.scenario.rootLabel ?? null,
          followupLabel: server.scenario.followupLabel ?? null,
        },
      };
      if (!local) return { ...state, course: fresh };
      const course = applyPatch(fresh, local);
      // The page's own answers as it holds them: a scenario with its
      // choices' texts, a quick check tried again on this page.
      if (local.answers?.["scenario/main"]) course.scenario = state.course.scenario;
      if (local.answers?.["assessment/main"]) course.assessment = state.course.assessment;
      return { ...state, course };
    }
    case "accountReread":
      // The account's card and badges read again (another tab changed
      // them): the server's, but what was changed here and isn't saved yet
      // stays (see card-save.ts); badges are a union.
      return {
        ...state,
        badges: mergeBadges(action.badges, state.badges),
        compCard: cardAfterReread(state.compCard, action.saved, action.compCard, DEFAULT_STATE.compCard),
      };
    case "cardAfterClaim": {
      const now = state.compCard;
      const card: CompCardData = { ...action.card };
      let edited = false;
      for (const field of [...COMP_CARD_FIELDS, "confidence"] as const) {
        if (now[field] === action.before[field]) continue;
        (card as unknown as Record<string, unknown>)[field] = now[field];
        edited = true;
      }
      return { ...state, compCard: edited ? { ...card, updatedAt: now.updatedAt } : card };
    }
    case "completeLesson":
      if (!isSectionId(action.id)) return state;
      return withCourse(state, completeLesson(state.course, action.id));
    case "answerPart":
      return withCourse(
        answerChanged(state, action.key),
        withAnswer(state.course, action.key, action.answer, action.labels)
      );
    case "progressRefused": {
      if (action.slug !== state.course.courseSlug) return state;
      const fresh = action.keys.filter((r) => state.refusedKeys[r.key] !== r.reason);
      if (!fresh.length) return state;
      const refusedKeys = { ...state.refusedKeys };
      for (const r of fresh) refusedKeys[r.key] = r.reason;
      return { ...state, refusedKeys };
    }
    case "outboxRestored":
      // Only into the course it was kept for; it waits in the outbox
      // otherwise.
      if (action.slug !== state.course.courseSlug) return state;
      return withCourse(state, applyPatch(state.course, action.patch));
    default:
      return state;
  }
}

interface ContextValue {
  state: DemoState;
  dispatch: React.Dispatch<Action>;
  /**
   * The course whose saved progress has loaded and been merged in, so what
   * the store holds of it is what the learner has (spec 5.4): a signed-in
   * learner's once loadCourseProgress has answered, a guest's once the
   * guest store has been read; null meanwhile. True in a preview, which
   * loads nothing. Read it with useCourseReady.
   */
  readyCourse: string | true | null;
  /**
   * A save was answered "unknown action": this page is from a build the
   * server no longer has (D68). What it held is in the tab's outbox, and
   * the learner is asked to reload.
   */
  staleBuild: boolean;
  /**
   * Release 3 (D79): the signed-in person hasn't done the profile step, so
   * the store loads, moves and saves nothing — it holds what is on screen —
   * and the page says so (ProfileNotSaving).
   */
  profileIncomplete: boolean;
  /**
   * Work this browser's guest store holds, offered to the signed-in person
   * (GuestWorkPrompt, spec 5.5): it moves only when they say it is theirs.
   * Null when there is none, for guests, and until their data has loaded.
   */
  guestWork: GuestWork | null;
  /** What became of it on this page (GuestWorkDone). */
  guestWorkDone: GuestWorkDone | null;
  /**
   * A text of the guest store's work (a Comp Card answer, a reflection
   * answer), too long to add, as the learner shortens it in the offer
   * (GuestWorkPrompt): written into the guest store at once, that text
   * only, so it outlives a reload and the next "Add" sends it. False when
   * the guest store doesn't hold it.
   */
  shortenGuestText: (ref: GuestText, text: string) => boolean;
  /** "Add it to my account": the guest store's work goes to the server once, and what is in the account leaves the browser. */
  claimGuestWork: () => Promise<void>;
  /** "Remove it from this browser": the guest store is removed; nothing is sent. */
  discardGuestWork: () => void;
  /** A guest's "Clear my work from this browser": the guest store and what the page holds of it. */
  clearGuestWork: () => void;
  /**
   * Who sees the Comp Card (setCompCardSharing): shown at once and sent at
   * once, never debounced; put back, answering false, when it didn't save.
   */
  setSharing: (choice: Sharing) => Promise<boolean>;
  /** The signed-in person's saved data has loaded: their choices can be saved. */
  accountLoaded: boolean;
  /**
   * A guest's page on which someone signed in in another tab (IL-2b): it
   * stays the guest's until it is reloaded — what is done here is saved on
   * this browser only, nothing of the account loads — and says so
   * (GuestWorkPrompt).
   */
  signedInElsewhere: boolean;
  /**
   * A guest's page whose guest store another tab added to an account,
   * removed or changed: it writes no more to it, and says so, with a way
   * to reload (GuestWorkPrompt).
   */
  guestStoreChanged: boolean;
}

const DemoStateContext = React.createContext<ContextValue | null>(null);
// How many times the store has let go of a learner's data (LearnerView).
const GenerationContext = React.createContext(0);
// A guest's page kept the guest's (signedInElsewhere): LearnerView takes
// nothing rendered for the account into it.
const PinnedContext = React.createContext(false);

export function DemoStateProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, DEFAULT_STATE);
  const [hydrated, setHydrated] = React.useState(false);
  // Whose saved data has loaded and been merged in: the signed-in learner
  // once it has, else null (a guest, while it loads, once the session has
  // been lost). Saves are only sent once it has, and for them only — the
  // server refuses them for anyone else (see isLearner in learner.ts).
  const [dbOwner, setDbOwnerState] = React.useState<string | null>(null);
  const dbReady = dbOwner !== null;
  // The same, for the effects that must see it without re-running on it.
  const dbOwnerRef = React.useRef<string | null>(null);
  const setDbOwner = React.useCallback((who: string | null) => {
    dbOwnerRef.current = who;
    setDbOwnerState(who);
  }, []);
  // Bumped whenever the store lets go of a learner's data: the learner's
  // pages start over (LearnerView), so none keeps showing — or recording
  // again, as the completion screen would — what was theirs.
  const [generation, setGeneration] = React.useState(0);
  // Bumped to send the badges whose award failed again (below).
  const [badgeRetry, setBadgeRetry] = React.useState(0);

  const { data: session, status, update } = useSession();
  const router = useRouter();
  const locale = useLocale() as Locale;
  const authed = status === "authenticated";
  // Whose data this is: the signed-in learner, null for a guest, undefined
  // while the session loads (see session-owner.ts).
  const owner = sessionOwner(status, session?.user);

  // The course whose saved progress has loaded and been merged into state;
  // null while one loads. Only this course is ever saved (see below).
  const loadedCourseRef = React.useRef<string | null>(null);
  // The course being played, read again once guest work moved into it
  // ("Add it to my account", courseReread): set with the course, and the
  // load below runs again (courseReload).
  const rereadRef = React.useRef<string | null>(null);
  const [courseReload, setCourseReload] = React.useState(0);
  // The store as last rendered, for what runs outside a render.
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);
  // A guest's page on which someone signed in in another tab, kept the
  // guest's (IL-2b, the identity effect below); the ref for the effects
  // that must see it in the same commit.
  const [guestPinned, setGuestPinned] = React.useState(false);
  const guestPinnedRef = React.useRef(false);
  // The page a guest's page was kept the guest's on: going to any other is
  // a full load, the account's page (below).
  const [pinnedAt, setPinnedAt] = React.useState<string | null>(null);
  const pinGuest = React.useCallback((on: boolean) => {
    guestPinnedRef.current = on;
    setPinnedAt(on ? window.location.pathname : null);
    setGuestPinned(on);
  }, []);
  // A guest's page (kept the guest's, or not signed in) whose guest store
  // another tab changed under it: what it holds is no longer what the
  // browser holds, so it writes no more, and says so (guestStoreChanged).
  const [guestStopped, setGuestStopped] = React.useState(false);
  const guestStoppedRef = React.useRef(false);
  const stopGuest = React.useCallback(() => {
    guestStoppedRef.current = true;
    setGuestStopped(true);
  }, []);
  // The guest store's text as this page last wrote or read it: a page kept
  // the guest's writes only over that (the guest write-through).
  const lastGuestText = React.useRef<string | null>(null);
  // "Add it to my account" is on its way from this page: the offer follows
  // the browser's copy again once it is answered.
  const claimingRef = React.useRef(false);
  const persistedBadges = React.useRef<Set<string>>(new Set());
  const badgeTries = React.useRef<Map<string, number>>(new Map());
  // The course and Comp Card last handed to the saves below. A write-through
  // that runs again with the same one — the session read again and the
  // learner found again (authed back) — doesn't save it again: this tab's
  // copy may be older than what the learner has saved since, elsewhere.
  const courseScheduled = React.useRef<CourseProgress | null>(null);
  const cardScheduled = React.useRef<CompCardData | null>(null);
  // What the server is known to hold of the Comp Card, and for whom: a
  // save sends only what was changed here from it (card-save.ts).
  const cardSaved = React.useRef<{ forUser: string; card: SavedCard } | null>(null);
  // The debounced saves, one waiting at a time each (see pending-save.ts).
  const [courseSave] = React.useState(() => pendingSave(700));
  const [cardSave] = React.useState(() => pendingSave(700));
  // Per course: what the server is known to hold, and what the learner has
  // now — a save sends the difference (course-save.ts). Replaced whole when
  // the store lets go of the learner's data, so an answer to a save sent
  // before can't move them on.
  const progressRefs = React.useRef(courseSaveRefs());
  // The guest's course moved into the account ("Add it to my account"),
  // not the course being played, until it loads: what the server holds
  // then is what the page shows, the guest's copy on the page left out
  // (courseAfterLoad).
  const migratedRef = React.useRef<CourseProgress | null>(null);
  // The course whose saved progress has loaded and been merged in, for
  // readyCourse (a signed-in learner's; loadedCourseRef, as state).
  const [loadedCourse, setLoadedCourse] = React.useState<string | null>(null);
  const [staleBuild, setStaleBuild] = React.useState(false);
  // Release 3 (D79, spec 5.5): no complete profile yet; the guest store's
  // work on offer, and what became of it.
  const [profileIncomplete, setProfileIncomplete] = React.useState(false);
  const [guestWork, setGuestWork] = React.useState<GuestWork | null>(null);
  const [guestWorkDone, setGuestWorkDone] = React.useState<GuestWorkDone | null>(null);
  // A guest's work just cleared: the guest write-through doesn't write the
  // empty store back.
  const clearedGuest = React.useRef(false);
  // The Comp Card as shown, for putting a sharing change back.
  const cardShown = React.useRef(state.compCard);
  React.useEffect(() => {
    cardShown.current = state.compCard;
  }, [state.compCard]);
  // next-auth's "read the session again, and tell the other tabs", for the
  // identity effect below: the latest one, without re-running it.
  const updateSession = React.useRef(update);
  React.useEffect(() => {
    updateSession.current = update;
  }, [update]);

  // A guest's progress, from this browser's guest store: what the page
  // holds is the browser's again, and is written again.
  const hydrateGuest = React.useCallback(() => {
    guestStoppedRef.current = false;
    setGuestStopped(false);
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      lastGuestText.current = raw;
      if (raw) {
        // Possibly written by an older page (see storedGuestState).
        const stored = storedGuestState(JSON.parse(raw), DEFAULT_STATE);
        dispatch({ type: "hydrate", state: stored });
        persistedBadges.current = new Set(stored.badges);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  // Lets go of the learner's data: nothing of theirs stays in memory, is
  // saved or goes to the guest store — the saves still waiting are dropped,
  // the session cookie may be someone else's now — and nothing is saved
  // again until the next learner's data has loaded and been merged
  // (dbOwner, loadedCourseRef). The learner's pages start over, and are
  // rendered again on the server for whoever now holds the session
  // (generation, LearnerView).
  const letGo = React.useCallback(() => {
    courseSave.drop();
    cardSave.drop();
    // Nor in the tab: what a page from a gone build kept for them (D68)
    // holds their answers, reflection text included (outbox.ts).
    clearEveryOutbox(tabStorage());
    loadedCourseRef.current = null;
    setLoadedCourse(null);
    rereadRef.current = null;
    progressRefs.current = courseSaveRefs();
    migratedRef.current = null;
    persistedBadges.current = new Set();
    badgeTries.current = new Map();
    courseScheduled.current = null;
    cardScheduled.current = null;
    cardSaved.current = null;
    setDbOwner(null);
    setProfileIncomplete(false);
    setGuestWork(null);
    setGuestWorkDone(null);
    dispatch({ type: "forgetLearner" });
    setGeneration((g) => g + 1);
  }, [courseSave, cardSave, setDbOwner]);

  // ---- The session changed hands, or can't be read ----
  // Another account signed in (in another tab): what's in memory isn't this
  // session's, and is let go of at once. The session found no one — signed
  // out in another tab, or a lookup that failed for a moment, which look
  // the same (see session-owner.ts): the learner's data is held — nothing
  // saved, nothing written to the guest store, no guest's progress read in
  // — and the session read again. The learner found again, what's held is
  // saved as it is — the changes made meanwhile — and, if their data hadn't
  // loaded yet, it loads and merges with what's held; still no one, it's
  // let go of. What was waiting to be saved is sent now, for the learner it
  // was made for: the server refuses it for anyone else. Declared before
  // the effects below, which see heldBy and the reset refs in the same
  // commit; the hydration and course load re-run for the new owner.
  const heldBy = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    const held = heldBy.current;
    const change = sessionChange(held, owner);
    if (owner === undefined) return;
    if (change === "hold") {
      // Nothing is saved meanwhile (the write-throughs wait for authed).
      // What had loaded stays loaded (dbOwner, loadedCourseRef): it isn't
      // loaded and merged again when the learner is found again.
      courseSave.flush();
      cardSave.flush();
      const abort = new AbortController();
      (async () => {
        try {
          for (const ms of SESSION_RECHECK_MS) {
            await wait(ms, abort.signal);
            // Read without telling the other tabs, and without the store's
            // session going to "loading" (which would end this hold).
            const now = await getSession({ broadcast: false });
            if (abort.signal.aborted) return;
            if (now?.user) {
              // Someone is signed in: this tab takes the session up, and
              // this effect sees who (the same learner, or another).
              void updateSession.current();
              return;
            }
          }
        } catch {
          return; // the owner changed meanwhile
        }
        // Still no one: signed out. A guest's progress is read in as usual.
        heldBy.current = null;
        letGo();
        hydrateGuest();
      })();
      return () => abort.abort();
    }
    if (change === "signedInElsewhere") {
      // A guest's page, and someone signed in in another tab (where the
      // sign-in link opened). What the guest did here is the guest's until
      // they say it is theirs (D79), and it isn't newer than what the
      // account has saved: taken up into the account in place, it would
      // win over the saved data as if entered while it loaded, and taking
      // it off the screen would leave the learner mid-course with nothing
      // (IL-2b). So the page stays the guest's until it is reloaded: the
      // account doesn't load into it, what is done here goes on being
      // written to this browser's guest store only, and the page says so
      // (signedInElsewhere). Reloaded, the account's page offers the work
      // (GuestWorkPrompt). A page with no guest work on it takes the
      // account up at once, and starts over for it.
      if (guestWorkOf(stateRef.current)) {
        pinGuest(true);
        return;
      }
      heldBy.current = owner;
      pinGuest(false);
      dispatch({ type: "forgetLearner" });
      setGeneration((g) => g + 1);
      return;
    }
    heldBy.current = owner;
    // The session finds no one again: the page is a guest's, as it was.
    if (owner === null && guestPinnedRef.current) pinGuest(false);
    if (change === "forget") letGo();
  }, [owner, courseSave, cardSave, letGo, hydrateGuest, pinGuest]);

  // ---- Hydration: DB for authed users, localStorage for guests ----
  React.useEffect(() => {
    if (status === "loading") return;
    // Aborted on cleanup: stops the retries below and drops their result.
    const abort = new AbortController();
    const cancelled = () => abort.signal.aborted;
    (async () => {
      if (authed && typeof owner === "string") {
        // A guest's page kept the guest's (signedInElsewhere): the account
        // doesn't load into it.
        if (guestPinnedRef.current) return;
        const forUser = owner;
        // This learner's data has loaded already: the session was read
        // again (and the learner found again, the identity effect above).
        // It isn't loaded and merged again: merged as if entered while it
        // loaded, this tab's copy — older, maybe, than what the learner has
        // saved since, elsewhere — would win over the saved data, and be
        // saved over it.
        if (dbOwnerRef.current === forUser) return;
        // Nothing is saved until this has loaded, so a failed try doesn't
        // end it: it's tried again (see retry.ts), and what the learner
        // does meanwhile stays in memory until it's through. A session
        // lookup that failed is a failed try too: the actions fail rather
        // than answer "nothing saved" (see requireLearner).
        let global: Awaited<ReturnType<typeof loadLearnerGlobal>> | typeof PROFILE_INCOMPLETE;
        try {
          global = await withRetry(
            async () => {
              // Release 3 (D79): before the profile step nothing of theirs
              // loads, moves or saves.
              if ((await ensureLearnerMembership()) === "profile-incomplete") return PROFILE_INCOMPLETE;
              return loadLearnerGlobal();
            },
            { signal: abort.signal }
          );
        } catch (err) {
          if (!cancelled()) {
            console.error(
              "Couldn't load the learner's saved data; nothing is saved on this visit.",
              err
            );
          }
          return;
        }
        if (cancelled()) return;
        if (global === PROFILE_INCOMPLETE) {
          // What is on screen is held, nothing is saved, and the guest
          // store is neither read nor removed. The page says so; the next
          // full page load goes to the profile step.
          setProfileIncomplete(true);
          return;
        }
        setProfileIncomplete(false);

        // The browser's guest store stays where it is (spec 5.5): on a
        // shared computer it may be another person's. Its work is offered
        // (guestWork), and moves only when they say it is theirs
        // (claimGuestWork) — nothing moves, and nothing is removed, until
        // they do.
        setGuestWork(readGuestWork());
        dispatch({
          type: "hydrateGlobal",
          compCard: global.compCard as CompCardData | null,
          badges: global.badges,
        });
        cardSaved.current = { forUser, card: savedCardOf(global.compCard, DEFAULT_STATE.compCard) };
        // Only what the server holds. A badge earned while this loaded stays
        // in state (hydrateGlobal unions) but not here, so the badge
        // write-through below awards it.
        persistedBadges.current = new Set(global.badges);
        setDbOwner(forUser);
      } else if (typeof heldBy.current !== "string") {
        // Not while a learner's data is held (the identity effect above):
        // a guest's progress would take its place. It's read once that has
        // been let go of.
        hydrateGuest();
        return;
      } else {
        return;
      }
      if (!cancelled()) setHydrated(true);
    })();
    return () => abort.abort();
  }, [status, authed, owner, router, hydrateGuest, setDbOwner]);

  // ---- Guest localStorage write-through ----
  // Never state loaded from the database (dbReady): in the commit where the
  // session changes hands, this still sees dbReady, and the learner's data
  // is let go of (above) before a guest's state is written. Nor a learner's
  // data held while their session can't be read (heldBy, above): it would
  // go from there into the next account that signs in on this browser.
  // A guest's page kept the guest's after a sign-in in another tab
  // (guestPinned) goes on writing it, but only over what it last wrote: the
  // work may have been added to the account, removed or changed in another
  // tab meanwhile, and what this page holds would then come back over it.
  // It stops instead, and says so (guestStoreChanged). So does any guest's
  // page once another tab changed the store under it (the listener below).
  React.useEffect(() => {
    if (!hydrated || (authed && !guestPinned) || dbReady || typeof heldBy.current === "string") {
      return;
    }
    if (guestStoppedRef.current) return;
    // Just cleared (clearGuestWork): the store stays removed until the
    // guest does something again.
    if (clearedGuest.current) {
      clearedGuest.current = false;
      return;
    }
    try {
      if (guestPinnedRef.current && window.localStorage.getItem(STORAGE_KEY) !== lastGuestText.current) {
        // What the browser holds (an external store) changed under this
        // page: it is told so, once.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        stopGuest();
        return;
      }
      const text = JSON.stringify(state);
      window.localStorage.setItem(STORAGE_KEY, text);
      lastGuestText.current = text;
    } catch {
      /* ignore */
    }
  }, [state, hydrated, authed, dbReady, guestPinned, stopGuest]);

  // ---- The guest store, changed in another tab ----
  // A guest's page (kept the guest's, or not signed in): the work was added
  // to an account, removed, or changed in another tab. A page kept the
  // guest's stops writing at any change; a guest's page at its removal (two
  // guest tabs still write in turn, as they always have). A signed-in page
  // offers the work as the browser holds it now (none: no offer), unless
  // its own "Add" is on its way. Its Comp Card or badges having changed
  // there — added to the account in another tab, perhaps — it reads the
  // account's card and badges again (rereadAccount): it shows what the
  // account holds, and a save or a sharing choice made on it is about that.
  const authedRef = React.useRef(authed);
  const hydratedRef = React.useRef(hydrated);
  React.useEffect(() => {
    authedRef.current = authed;
    hydratedRef.current = hydrated;
  }, [authed, hydrated]);
  // Once the guest store has settled for a moment; one read at a time.
  const rereadTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rereadAccount = React.useCallback(() => {
    clearTimeout(rereadTimer.current);
    rereadTimer.current = setTimeout(async () => {
      const forUser = dbOwnerRef.current;
      if (!forUser) return;
      let global: Awaited<ReturnType<typeof loadLearnerGlobal>>;
      try {
        global = await withRetry(() => loadLearnerGlobal());
      } catch {
        return; // the page goes on as it was: its saves send only what changed here
      }
      const saved = cardSaved.current;
      if (dbOwnerRef.current !== forUser || saved?.forUser !== forUser) return;
      dispatch({
        type: "accountReread",
        compCard: global.compCard as CompCardData | null,
        saved: saved.card,
        badges: global.badges,
      });
      cardSaved.current = { forUser, card: savedCardOf(global.compCard, DEFAULT_STATE.compCard) };
      for (const slug of global.badges) persistedBadges.current.add(slug);
    }, 250);
  }, []);
  React.useEffect(() => () => clearTimeout(rereadTimer.current), []);
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY && e.key !== null) return;
      if (guestPinnedRef.current || (!authedRef.current && hydratedRef.current)) {
        if (guestPinnedRef.current || e.newValue === null) stopGuest();
        return;
      }
      if (!dbOwnerRef.current || claimingRef.current) return;
      setGuestWork(readGuestWork());
      if (e.key === null || guestCardOrBadgesChanged(e.oldValue, e.newValue)) rereadAccount();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [stopGuest, rereadAccount]);

  // ---- A guest's page kept the guest's: any other page is a full load ----
  // Every page after the sign-in is rendered for the account, so a page
  // opened from it in the app (a link, the language, back and forward)
  // would show the account's data on the guest's page, and the store would
  // take it as the guest's. A link is followed by the browser instead: a
  // full load, the account's page, which offers the guest's work. Any other
  // way the app goes to another page shows nothing and loads it in full.
  React.useEffect(() => {
    if (!guestPinned) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const to = new URL(link.href, window.location.href);
      if (to.origin !== window.location.origin) return;
      if (to.pathname === window.location.pathname && to.search === window.location.search) return;
      // Not to the app's router: the browser follows the link.
      e.stopImmediatePropagation();
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [guestPinned]);
  const pathname = usePathname();
  const leftPinnedPage = guestPinned && pinnedAt !== null && pathname !== pinnedAt;
  React.useEffect(() => {
    if (leftPinnedPage) window.location.reload();
  }, [leftPinnedPage]);

  // ---- Load a course's saved progress from the DB when it becomes active ----
  // The learner may be in the course before their data has loaded — on a
  // cold server they can walk all of it first — and the save effect below
  // skips every change until this load is done. So the result is always
  // dispatched, even when nothing is saved: courseProgressLoaded merges the
  // two, and a changed course object makes the save effect persist it.
  // Whatever course was loaded before stops counting as loaded as soon as
  // another one is active, even while loading waits for the session or the
  // learner's data: coming back to it resets it to empty (setCourseContext),
  // so it has to load and merge again before it may be saved. Its last
  // change, if still waiting out the save debounce, is sent now: the next
  // course's first save would replace it. And it loads again only once no
  // save of it is left (settle): one that failed and waits to be tried
  // again is sent now, so what it holds is read back — the save of the
  // merge would otherwise take its place (pending-save.ts). A failed load
  // is tried again (see retry.ts); until a try gets through, the course
  // isn't saved and what the learner does stays in memory.
  React.useEffect(() => {
    const slug = state.course.courseSlug;
    // Read again only as the course it was asked for.
    if (rereadRef.current !== null && rereadRef.current !== slug) rereadRef.current = null;
    if (loadedCourseRef.current !== slug) {
      courseSave.flush();
      loadedCourseRef.current = null;
      // Not ready until it has loaded again (readyCourse): kept in step
      // with the ref above, which isn't state.
      setLoadedCourse(null);
    }
    if (!authed || !dbReady || !slug || loadedCourseRef.current === slug) return;
    const forUser = dbOwnerRef.current;
    const abort = new AbortController();
    (async () => {
      await courseSave.settle(slug);
      if (abort.signal.aborted) return;
      let prog: Awaited<ReturnType<typeof loadCourseProgress>>;
      try {
        prog = await withRetry(() => loadCourseProgress(slug, locale), {
          signal: abort.signal,
        });
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error(
            `Couldn't load the saved progress of "${slug}"; it isn't saved on this visit.`,
            err
          );
        }
        return;
      }
      if (abort.signal.aborted) return;
      // Loaded BEFORE the dispatch, so the save effect that runs on the
      // resulting render saves the merge. What the server holds is what
      // patches are worked out against from now on; what the learner has
      // is set by that effect, once merged (courseLoaded).
      loadedCourseRef.current = slug;
      setLoadedCourse(slug);
      const saved = prog as CourseProgress | null;
      const refs = progressRefs.current;
      const server = savedProgress(saved);
      // Read again after guest work moved into it: what the server held
      // before, so only what this page did since goes on top (courseReread).
      const base = rereadRef.current === slug ? refs.acked.get(slug) : undefined;
      if (rereadRef.current === slug) rereadRef.current = null;
      courseLoaded(refs, slug, server);
      if (base) {
        dispatch({ type: "courseReread", slug, saved, base });
        return;
      }
      const migrated = migratedRef.current?.courseSlug === slug ? migratedRef.current : null;
      if (migrated) migratedRef.current = null;
      dispatch({ type: "courseProgressLoaded", slug, saved, migrated });
      // What this tab kept for this learner when a save of the course found
      // a newer build (D68): applied as changes made here, so it's saved
      // like any, in the same render as the merge — and the outbox cleared
      // once nothing is left to send (course-save.ts). Only what the server
      // still holds as it was when it was kept: an answer saved elsewhere
      // since is newer (outbox.ts restoreOutbox).
      const kept = forUser ? restoreOutbox(tabStorage(), forUser, slug, server) : null;
      if (kept) dispatch({ type: "outboxRestored", slug, patch: kept });
    })();
    return () => abort.abort();
  }, [authed, dbReady, state.course.courseSlug, locale, owner, courseSave, courseReload]);

  // ---- DB write-through: course progress (debounced) ----
  // Never a course whose saved progress hasn't loaded and been merged in
  // here (loadedCourseRef, null while any course loads): a save sends what
  // the learner has that the server doesn't, and before the load the store
  // doesn't know what the server has — it would send what's in memory over
  // that progress, nothing at all for a course the learner has just come
  // back to. Each save is a patch worked out when it's sent, against what
  // the server has confirmed (course-save.ts), so it never takes back an
  // answer this tab didn't change (D62). A save that fails is tried again
  // (see pending-save.ts); one that finds a newer build keeps what isn't
  // confirmed in the tab's outbox (outbox.ts).
  const saveFor = React.useCallback(
    (slug: string, forUser: string) => {
      const refs = progressRefs.current;
      const save = (): Promise<void> =>
        saveCourse(slug, forUser, refs, {
          send: saveCourseProgressPatch,
          refusedKeys: (s, keys) => dispatch({ type: "progressRefused", slug: s, keys }),
          staleBuild: () => setStaleBuild(true),
          outbox: tabStorage(),
          again: () => courseSave.schedule(save, slug),
          current: () => refs === progressRefs.current,
        });
      return save;
    },
    [courseSave]
  );
  React.useEffect(() => {
    if (!authed || !dbOwner) return;
    const slug = state.course.courseSlug;
    if (!slug || loadedCourseRef.current !== slug) return;
    const snap = state.course;
    if (snap === courseScheduled.current) return;
    // Nothing the server doesn't have: nothing to send, and nothing the
    // outbox kept is needed. Opening a course doesn't enroll anyone.
    if (!courseChanged(progressRefs.current, slug, dbOwner, snap, tabStorage())) return;
    // This change finishes the course: it's sent at once, not after the
    // pause, so a learner who leaves on "Course complete" keeps it. (Next
    // runs server actions one at a time, so it can still wait behind one
    // already on its way, such as the last step's time; usually a moment.)
    const prev = courseScheduled.current;
    const finishedNow =
      !!snap.completedAt &&
      !(prev?.courseSlug === snap.courseSlug && prev.completedAt);
    courseScheduled.current = snap;
    courseSave.schedule(saveFor(slug, dbOwner), slug);
    if (finishedNow) courseSave.flush();
  }, [authed, dbOwner, state.course, courseSave, saveFor]);

  // ---- DB write-through: Comp Card (debounced) ----
  // What is sent is only what was changed here from what the server is
  // known to hold (cardSaved), worked out when it is sent (card-save.ts):
  // a card loaded, or read again, is not saved back, and a field another
  // tab or device changed since is never written over with this page's
  // older copy. It leaves out who sees the card (its own action,
  // setSharing) and any text over the limit, which keeps its stored text
  // while the learner is told it is too long (cardToSave). A change of who
  // sees it alone (updatedAt and the texts as they were) isn't an edit, and
  // sends nothing. A save confirmed while the card still differs from what
  // the server is then known to hold — an answer changed back while it was
  // on its way — is followed by another, of the card as it is then; so is a
  // save that fails once the card has changed since it was sent (its own
  // retry would be skipped for the newer save, which may have found nothing
  // to send), tried again as any save is.
  const saveCardFor = React.useCallback(
    (card: CompCardData, forUser: string) => {
      const save = (c: CompCardData): Promise<void> =>
        saveCard(c, forUser, cardSaved, {
          send: saveCompCard,
          latest: () => cardScheduled.current,
          again: () => {
            const latest = cardScheduled.current;
            if (latest) cardSave.schedule(() => save(latest));
          },
        });
      return () => save(card);
    },
    [cardSave]
  );
  React.useEffect(() => {
    if (!authed || !dbOwner || !state.compCard.updatedAt) return;
    const snap = state.compCard;
    const prev = cardScheduled.current;
    if (snap === prev) return;
    cardScheduled.current = snap;
    if (prev && prev.updatedAt === snap.updatedAt && sameCardText(prev, snap)) return;
    cardSave.schedule(saveCardFor(snap, dbOwner));
  }, [authed, dbOwner, state.compCard, cardSave, saveCardFor]);

  // ---- DB write-through: badges (append-only) ----
  // An award that doesn't get through (a dropped connection, a session
  // lookup that failed) is sent again after 1 s, 2 s, 4 s and 8 s — it's
  // idempotent — unless the learner's data has been let go of meanwhile
  // (persistedBadges replaced). One the server refuses (no Badge row for
  // it) is logged once and not sent again this visit: no retry can fix it
  // (badge-award.ts). A completed course's badge is also saved with the
  // course itself (see saveCourseProgress).
  React.useEffect(() => {
    if (!authed || !dbOwner) return;
    const sent = persistedBadges.current;
    const tries = badgeTries.current;
    const forUser = dbOwner;
    for (const slug of state.badges) {
      if (sent.has(slug)) continue;
      sent.add(slug);
      awardBadgeAction(slug, forUser).then(
        (result) => {
          tries.delete(slug);
          if (isRefusedAward(result)) {
            console.error(`The badge "${slug}" wasn't saved.`, result);
          }
        },
        (err: unknown) => {
          sent.delete(slug);
          if (persistedBadges.current !== sent) return;
          const attempt = tries.get(slug) ?? 0;
          if (attempt >= RETRY_DELAYS_MS.length) {
            console.error(`Couldn't award the badge "${slug}".`, err);
            return;
          }
          tries.set(slug, attempt + 1);
          setTimeout(() => setBadgeRetry((n) => n + 1), RETRY_DELAYS_MS[attempt]);
        }
      );
    }
  }, [authed, dbOwner, state.badges, badgeRetry]);

  // ---- Unmounting: send what's still waiting now ----
  // A tab that's hidden (another app, another tab) or closed sends what's
  // waiting now: the pause before a save would otherwise outlive the page.
  // Only what was already scheduled, under the rules above, is sent. A
  // closing page can still drop it if another server action is ahead of it
  // in Next's queue: this narrows the gap, it doesn't close it.
  React.useEffect(() => {
    const sendWaiting = () => {
      courseSave.flush();
      cardSave.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") sendWaiting();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", sendWaiting);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", sendWaiting);
    };
  }, [courseSave, cardSave]);

  // Not left to a timer outliving this store: sent now, it reaches the
  // server before a store mounted next loads it back.
  React.useEffect(
    () => () => {
      courseSave.close();
      cardSave.close();
    },
    [courseSave, cardSave]
  );

  // ---- The guest store's work (spec 5.5) ----
  // "Add it to my account" (D37, D69, D79, D80): what this page has
  // waiting to be saved is sent first, so the account is judged with it.
  // Then the guest store, as it is read now, goes to the server once
  // (claimGuestWork in learner.ts), which decides each part in one
  // transaction: the course only into an account with no progress in it,
  // the Comp Card only into none or a blank one not shared, badges as a
  // union. A try that fails (a dropped connection, a session lookup that
  // failed) is sent again; a part already in the account is answered
  // "already", never added twice. Nothing to send — the guest store gone or
  // emptied in another tab, or unreadable — and the page says nothing was
  // added. A refusal (another account's session, a text too long to add)
  // leaves the guest store as it is; for another account the page reads
  // its session again, lets go of this account's data and offers the work
  // to whoever is signed in. Otherwise the guest store loses what the
  // server says is in the account, and only as it was read
  // (storeAfterClaim) — whoever is signed in by then: it is in the account
  // it was sent for. What a tab still a guest saved meanwhile stays, and is
  // offered again.
  // The page then shows what the server holds: the Comp Card as answered
  // (fields changed here meanwhile kept), the course being played read
  // again (courseReread), the account's badges; and says what became of
  // each part.
  const claimGuestWork = React.useCallback(async () => {
    const forUser = dbOwnerRef.current;
    if (!forUser) return;
    courseSave.flush();
    cardSave.flush();
    // The Comp Card as this page holds it now: a field changed from it while
    // the work is added was changed here, and stays.
    const cardBefore = stateRef.current.compCard;
    let read: string | null = null;
    try {
      read = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      /* none to read */
    }
    let guest: DemoState | null = null;
    let unreadable = false;
    try {
      guest = read ? storedGuestState(JSON.parse(read), DEFAULT_STATE) : null;
    } catch {
      unreadable = true;
    }
    const claim = guest ? guestClaimOf(guest) : null;
    if (read === null || !guest || !claim) {
      if (unreadable && read !== null) removeGuestStoreIf(read);
      setGuestWork(null);
      setGuestWorkDone({ kind: "nothing" });
      return;
    }
    // Too big for the server to take: said here, as the server would.
    if (claimTooLarge(claim)) {
      setGuestWork(readGuestWork());
      setGuestWorkDone({ kind: "tooLarge" });
      return;
    }
    let answer: GuestClaimResult;
    claimingRef.current = true;
    try {
      answer = await withRetry(() => claimGuestWorkAction(claim, forUser));
    } catch {
      claimingRef.current = false;
      if (dbOwnerRef.current === forUser) {
        setGuestWork(readGuestWork());
        setGuestWorkDone({ kind: "unconfirmed" });
      }
      return;
    }
    claimingRef.current = false;
    if (!answer.ok) {
      if (dbOwnerRef.current !== forUser) return;
      setGuestWork(readGuestWork());
      if (answer.error === "other-account") {
        setGuestWorkDone({ kind: "otherAccount" });
        void updateSession.current();
      } else if (answer.error === "too-long") {
        setGuestWorkDone({ kind: "tooLong", count: answer.texts.length });
      } else if (answer.error === "too-large") {
        setGuestWorkDone({ kind: "tooLarge" });
      } else {
        setGuestWorkDone({ kind: "failed" });
      }
      return;
    }
    // In the account it was sent for: it leaves this browser, as it was read.
    const inAccount = (outcome: string | undefined) => outcome === "moved" || outcome === "already";
    let more = false;
    try {
      const after = storeAfterClaim(
        read,
        window.localStorage.getItem(STORAGE_KEY),
        {
          course: inAccount(answer.course),
          compCard: inAccount(answer.compCard),
          badges: [...answer.badges.moved, ...answer.badges.already],
        },
        DEFAULT_STATE
      );
      more = after.more;
      if (after.store === null) window.localStorage.removeItem(STORAGE_KEY);
      else if (after.store !== undefined) window.localStorage.setItem(STORAGE_KEY, after.store);
    } catch {
      /* the browser's storage can't be reached: nothing to remove */
    }
    // The account let go of meanwhile (signed out, another account): nothing
    // of it is shown to the next one.
    if (dbOwnerRef.current !== forUser) return;
    dispatch({ type: "hydrateGlobal", compCard: null, badges: answer.accountBadges });
    for (const slug of answer.accountBadges) persistedBadges.current.add(slug);
    if (answer.card && inAccount(answer.compCard)) {
      // Not saved again: it is what the server holds (the write-through
      // sends only a field changed here meanwhile). Moved, it is Only me.
      cardSaved.current = { forUser, card: savedCardOf(answer.card, DEFAULT_STATE.compCard) };
      const card: CompCardData =
        answer.compCard === "moved"
          ? { ...cardBefore, ...answer.card, sharing: "onlyMe", sharedAt: null, organisationName: null }
          : { ...cardBefore, ...answer.card };
      cardScheduled.current = card;
      dispatch({ type: "cardAfterClaim", card, before: cardBefore });
    }
    const slug = claim.course?.slug;
    if (answer.course === "moved" && slug) {
      if (stateRef.current.course.courseSlug === slug) {
        // The course being played moved under this page: it is read again,
        // and what was done here that the server didn't have goes on top
        // (one still loading loads again, after the move).
        rereadRef.current = loadedCourseRef.current === slug ? slug : null;
        loadedCourseRef.current = null;
        setLoadedCourse(null);
        setCourseReload((n) => n + 1);
      } else {
        // Shown when no course is being played, and loaded like any other
        // when it is opened: what the server holds then, the guest's copy
        // on the page left out (courseAfterLoad).
        migratedRef.current = guest.course;
        dispatch({ type: "guestCourseMigrated", course: guest.course });
      }
    }
    // Server-rendered parts (the dashboard) show what was just written.
    if (answer.course === "moved" || answer.compCard === "moved" || answer.badges.moved.length) router.refresh();
    const title = guestWorkOf(guest)?.courses[0];
    setGuestWork(readGuestWork());
    setGuestWorkDone({
      kind: "claimed",
      ...(answer.course ? { course: { outcome: answer.course, title: title?.title ?? slug ?? "", locale: title?.locale ?? null } } : {}),
      ...(answer.compCard ? { compCard: answer.compCard } : {}),
      badgesMoved: answer.badges.moved.length,
      badgesAlready: answer.badges.already.length,
      badgesRefused: answer.badges.refused.length,
      more,
    });
  }, [router, courseSave, cardSave]);

  // "Remove it from this browser": nothing is sent.
  const discardGuestWork = React.useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to remove */
    }
    setGuestWork(null);
    setGuestWorkDone({ kind: "removed" });
  }, []);

  // A text of the guest store too long to add, shortened in the offer: that
  // text of the guest store changes (a Comp Card answer with its time);
  // nothing else of it, and nothing is sent (the next "Add" sends it).
  const shortenGuestText = React.useCallback((ref: GuestText, text: string): boolean => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const next = raw === null ? null : withText(raw, ref, text);
      if (next === null) return false;
      window.localStorage.setItem(STORAGE_KEY, next);
      return true;
    } catch {
      return false;
    }
  }, []);

  // A guest's "Clear my work from this browser": the guest store goes, and
  // so does what the page holds of it.
  const clearGuestWork = React.useCallback(() => {
    if (authed && !guestPinnedRef.current) return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to remove */
    }
    clearedGuest.current = true;
    lastGuestText.current = null;
    dispatch({ type: "reset" });
  }, [authed]);

  // ---- Who sees the Comp Card (D80) ----
  // Shown at once and sent at once; put back on a refusal or an error. Not
  // an edit: the text's write-through doesn't send it (above).
  const setSharing = React.useCallback(async (choice: Sharing): Promise<boolean> => {
    const forUser = dbOwnerRef.current;
    if (!forUser) return false;
    const before = cardShown.current;
    const put = (c: Pick<CompCardData, "sharing" | "sharedAt" | "organisationName">) =>
      dispatch({
        type: "sharingShown",
        sharing: c.sharing,
        sharedAt: c.sharedAt ?? null,
        organisationName: c.organisationName ?? null,
      });
    put({ sharing: choice, sharedAt: choice === "facilitators" ? new Date().toISOString() : null, organisationName: before.organisationName });
    try {
      const answer = await setCompCardSharing(choice, forUser);
      if (dbOwnerRef.current !== forUser) return false;
      if (answer.ok) {
        put(answer);
        return true;
      }
    } catch {
      /* put back below */
    }
    if (dbOwnerRef.current === forUser) put(before);
    return false;
  }, []);

  // A signed-in learner's course once loaded and merged; a guest's as soon
  // as the guest store has been read (it holds their one course, D69), also
  // on a guest's page kept the guest's (guestPinned).
  const readyCourse = authed && !guestPinned
    ? dbReady
      ? loadedCourse
      : null
    : hydrated
      ? state.course.courseSlug
      : null;
  const value = React.useMemo(
    () => ({
      state,
      dispatch,
      readyCourse,
      staleBuild,
      profileIncomplete,
      guestWork,
      guestWorkDone,
      shortenGuestText,
      claimGuestWork,
      discardGuestWork,
      clearGuestWork,
      setSharing,
      accountLoaded: dbReady,
      signedInElsewhere: guestPinned,
      guestStoreChanged: guestStopped,
    }),
    [
      state,
      readyCourse,
      staleBuild,
      profileIncomplete,
      guestWork,
      guestWorkDone,
      shortenGuestText,
      claimGuestWork,
      discardGuestWork,
      clearGuestWork,
      setSharing,
      dbReady,
      guestPinned,
      guestStopped,
    ]
  );

  return (
    <DemoStateContext.Provider value={value}>
      <GenerationContext.Provider value={generation}>
        <PinnedContext.Provider value={guestPinned}>
          {/* Leaving a guest's page kept the guest's: nothing of the next page is shown before it loads in full. */}
          {leftPinnedPage ? null : children}
        </PinnedContext.Provider>
      </GenerationContext.Provider>
    </DemoStateContext.Provider>
  );
}

/** How often, and how many times, LearnerView checks a refresh landed. */
const LEARNER_VIEW_RECHECK_MS = 2000;
const LEARNER_VIEW_REFRESHES = 3;

/**
 * A page that shows the learner's data: the learner area's pages. It starts
 * over whenever the store lets go of the learner's data (their session gone,
 * or another account's now), so nothing on it keeps showing what was
 * theirs — or records it again, as the completion screen would — and its
 * server-rendered parts are rendered again for whoever holds the session
 * now: the dashboard's progress comes from the server. Only these pages: an
 * editor's, a facilitator's or an admin's page keeps what's typed into it.
 *
 * `renderedFor` is whom the server rendered the page for (the learner's id,
 * null for a guest). A refresh sometimes doesn't show until the next router
 * update (Next 16), which would leave the last learner's progress on the
 * page: until it's rendered for whoever holds the session now, it's
 * refreshed again — the next refresh brings the stalled one in — and at
 * last reloaded.
 */
export function LearnerView({
  renderedFor,
  children,
}: {
  renderedFor: string | null;
  children: React.ReactNode;
}) {
  const generation = React.useContext(GenerationContext);
  const pinned = React.useContext(PinnedContext);
  const router = useRouter();
  const { data: session, status } = useSession();
  const owner = sessionOwner(status, session?.user);
  // For the checks below, which outlive the render that scheduled them.
  const latest = React.useRef({ renderedFor, owner });
  React.useEffect(() => {
    latest.current = { renderedFor, owner };
  });
  const shown = React.useRef(generation);
  React.useEffect(() => {
    if (shown.current === generation) return;
    shown.current = generation;
    // A guest's page kept the guest's isn't refreshed: the server renders
    // for the account (its next page loads in full).
    if (pinned) return;
    router.refresh();
    let refreshes = 1;
    const timer = setInterval(() => {
      const now = latest.current;
      if (now.owner === undefined) return; // the session is loading
      if (now.renderedFor === now.owner) {
        clearInterval(timer);
      } else if (refreshes < LEARNER_VIEW_REFRESHES) {
        refreshes++;
        router.refresh();
      } else {
        clearInterval(timer);
        window.location.reload();
      }
    }, LEARNER_VIEW_RECHECK_MS);
    return () => clearInterval(timer);
  }, [generation, router, pinned]);
  return <React.Fragment key={generation}>{children}</React.Fragment>;
}

/** A preview's store: no profile, no guest store, nothing shared or saved. */
const NOTHING_SAVED = {
  profileIncomplete: false,
  guestWork: null,
  guestWorkDone: null,
  shortenGuestText: () => false,
  claimGuestWork: async () => {},
  discardGuestWork: () => {},
  clearGuestWork: () => {},
  setSharing: async () => false,
  accountLoaded: false,
  signedInElsewhere: false,
  guestStoreChanged: false,
} satisfies Partial<ContextValue>;

/**
 * In-memory course state for an editor's preview: no hydration and no
 * write-through to the DB or localStorage. The player and its stages read
 * the nearest provider, so wrapping the player in this one catches every
 * dispatch — progress, answers, completion, badges — and the page-wide
 * provider above never sees them. Nothing done in a preview is saved.
 */
export function PreviewStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(reducer, DEFAULT_STATE);
  const value = React.useMemo(
    () => ({ state, dispatch, readyCourse: true as const, staleBuild: false, ...NOTHING_SAVED }),
    [state]
  );
  return (
    <DemoStateContext.Provider value={value}>
      {children}
    </DemoStateContext.Provider>
  );
}

export function useDemoState() {
  const ctx = React.useContext(DemoStateContext);
  if (!ctx) throw new Error("useDemoState must be used inside DemoStateProvider");
  return ctx;
}

/**
 * Has `slug`'s saved progress loaded and been merged in (readyCourse)? The
 * player's resume check waits for it (spec 5.5).
 */
export function useCourseReady(slug: string): boolean {
  const { readyCourse } = useDemoState();
  return readyCourse === true || readyCourse === slug;
}

/** Is this page from a build the server no longer has (staleBuild)? */
export function useStaleBuild(): boolean {
  return useDemoState().staleBuild;
}
