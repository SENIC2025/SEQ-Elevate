"use client";

import * as React from "react";
import { getSession, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  ensureLearnerMembership,
  loadLearnerGlobal,
  loadCourseProgress,
  saveCourseProgress,
  saveCompCard,
  awardBadgeAction,
} from "@/app/actions/learner";
import type { Locale } from "@/lib/cms/types";
import {
  courseAfterLoad,
  courseAfterMigration,
  guestStateAfterHydrate,
  hasCourseProgress,
  mergeBadges,
  mergeCompCardOnHydrate,
} from "./progress-merge";
import { migrateGuest } from "./guest-migration";
import { pendingSave } from "./pending-save";
import { RETRY_DELAYS_MS, wait, withRetry } from "./retry";
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

export interface AssessmentAnswers {
  q1: string | null;
  q2: string | null;
  q3: string | null;
}

export interface CourseProgress {
  /** The course currently being played (set when the player mounts). */
  courseSlug: string | null;
  courseTitle: string | null;
  stagesCompleted: string[];
  simulation: SimulationAttempt | null;
  scenario: ScenarioAttempt;
  reflection: ReflectionAnswers;
  assessment: AssessmentAnswers;
  completedAt: string | null;
}

export interface CompCardData {
  wentWell: string;
  difficult: string;
  improve: string;
  behaviour: string;
  confidence: number;
  privacy: "self" | "facilitator" | "facilitatorAndMentor";
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
}

const DEFAULT_STATE: DemoState = {
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
    assessment: { q1: null, q2: null, q3: null },
    completedAt: null,
  },
  compCard: {
    wentWell: "",
    difficult: "",
    improve: "",
    behaviour: "",
    confidence: 3,
    privacy: "facilitator",
    updatedAt: null,
  },
};

const STORAGE_KEY = "seq-elevate-demo-state-v1";

type Action =
  | { type: "setProject"; projectId: string }
  | { type: "setRole"; role: Role | null }
  | { type: "setCourseContext"; slug: string; title: string }
  | { type: "completeStage"; stage: string }
  | { type: "recordSimulation"; attempt: SimulationAttempt }
  | { type: "recordScenarioRoot"; choice: string; label: string }
  | { type: "recordScenarioFollowup"; choice: string; label: string }
  | { type: "updateReflection"; patch: Partial<ReflectionAnswers> }
  | { type: "updateAssessment"; patch: Partial<AssessmentAnswers> }
  | { type: "completeCourse" }
  | { type: "awardBadge"; badge: string }
  | { type: "updateCompCard"; patch: Partial<CompCardData> }
  | { type: "reset" }
  | { type: "forgetLearner" }
  | { type: "hydrate"; state: DemoState }
  | { type: "hydrateGlobal"; compCard: CompCardData | null; badges: string[] }
  | { type: "guestCourseMigrated"; course: CourseProgress }
  | { type: "courseProgressLoaded"; slug: string; saved: CourseProgress | null };

function reducer(state: DemoState, action: Action): DemoState {
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
        state.course.courseTitle === action.title
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
          },
        };
      }
      return {
        ...state,
        course: {
          ...state.course,
          courseSlug: action.slug,
          courseTitle: action.title,
        },
      };
    case "completeStage":
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
        ...state,
        course: {
          ...state.course,
          reflection: { ...state.course.reflection, ...action.patch },
        },
      };
    case "updateAssessment":
      return {
        ...state,
        course: {
          ...state.course,
          assessment: { ...state.course.assessment, ...action.patch },
        },
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
      const course = courseAfterLoad(state.course, action.slug, action.saved);
      return course ? { ...state, course } : state;
    }
    default:
      return state;
  }
}

interface ContextValue {
  state: DemoState;
  dispatch: React.Dispatch<Action>;
}

const DemoStateContext = React.createContext<ContextValue | null>(null);
// How many times the store has let go of a learner's data (LearnerView).
const GenerationContext = React.createContext(0);

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
  const persistedBadges = React.useRef<Set<string>>(new Set());
  const badgeTries = React.useRef<Map<string, number>>(new Map());
  // The course and Comp Card last handed to the saves below. A write-through
  // that runs again with the same one — the session read again and the
  // learner found again (authed back) — doesn't save it again: this tab's
  // copy may be older than what the learner has saved since, elsewhere.
  const courseScheduled = React.useRef<CourseProgress | null>(null);
  const cardScheduled = React.useRef<CompCardData | null>(null);
  // The debounced saves, one waiting at a time each (see pending-save.ts).
  const [courseSave] = React.useState(() => pendingSave(700));
  const [cardSave] = React.useState(() => pendingSave(700));
  // next-auth's "read the session again, and tell the other tabs", for the
  // identity effect below: the latest one, without re-running it.
  const updateSession = React.useRef(update);
  React.useEffect(() => {
    updateSession.current = update;
  }, [update]);

  // A guest's progress, from this browser's guest store.
  const hydrateGuest = React.useCallback(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DemoState;
        dispatch({ type: "hydrate", state: { ...DEFAULT_STATE, ...parsed } });
        persistedBadges.current = new Set(parsed.badges ?? []);
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
    loadedCourseRef.current = null;
    persistedBadges.current = new Set();
    badgeTries.current = new Map();
    courseScheduled.current = null;
    cardScheduled.current = null;
    setDbOwner(null);
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
    heldBy.current = owner;
    if (change === "forget") letGo();
  }, [owner, courseSave, cardSave, letGo, hydrateGuest]);

  // ---- Hydration: DB for authed users, localStorage for guests ----
  React.useEffect(() => {
    if (status === "loading") return;
    // Aborted on cleanup: stops the retries below and drops their result.
    const abort = new AbortController();
    const cancelled = () => abort.signal.aborted;
    (async () => {
      if (authed && typeof owner === "string") {
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
        let global: Awaited<ReturnType<typeof loadLearnerGlobal>>;
        try {
          global = await withRetry(
            async () => {
              await ensureLearnerMembership();
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

        // One-time guest→DB migration: a learner who built progress as a
        // guest (localStorage) and then signed in keeps that progress. The
        // DB always wins on conflict — we only fill gaps the server has no
        // data for. Runs before the data counts as loaded (setDbOwner) so
        // the write-through effects below don't race the migration.
        let mergedCompCard = global.compCard as CompCardData | null;
        let mergedBadges = global.badges;
        let awardedBadges = global.badges;
        let migratedCourse: CourseProgress | null = null;
        let migratedAnything = false;
        let guest: DemoState | null = null;
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (raw) {
            // Remove first, so a re-run (StrictMode, second tab) can't
            // double-migrate.
            window.localStorage.removeItem(STORAGE_KEY);
            guest = JSON.parse(raw) as DemoState;
          }
        } catch {
          /* a bad localStorage blob: dropped — never block sign-in on it */
        }
        if (guest) {
          try {
            // Each write is tried again, and what didn't get through is
            // still handed to the store below, whose write-throughs save
            // it: the guest store no longer holds it (guest-migration.ts).
            // Not stopped by this effect re-running, for the same reason.
            const migrated = await migrateGuest(
              guest,
              {
                compCard: mergedCompCard,
                badges: mergedBadges,
                enrollments: global.enrollments,
              },
              {
                awardBadge: (slug) => awardBadgeAction(slug, forUser),
                saveCompCard: (card) =>
                  saveCompCard(
                    {
                      wentWell: card.wentWell,
                      difficult: card.difficult,
                      improve: card.improve,
                      behaviour: card.behaviour,
                      confidence: card.confidence,
                      privacy: card.privacy,
                    },
                    forUser
                  ),
                saveCourse: (slug, gc) =>
                  saveCourseProgress(
                    slug,
                    {
                      stagesCompleted: gc.stagesCompleted,
                      simulation: gc.simulation,
                      scenario: {
                        root: gc.scenario.root,
                        followup: gc.scenario.followup,
                      },
                      reflection: gc.reflection,
                      assessment: gc.assessment,
                      completedAt: gc.completedAt,
                    },
                    forUser
                  ),
              }
            );
            mergedCompCard = migrated.compCard;
            mergedBadges = migrated.badges;
            awardedBadges = migrated.awarded;
            migratedCourse = migrated.course;
            migratedAnything = migrated.wrote;
          } catch {
            /* a malformed guest store — never block sign-in on it */
          }
        }
        if (cancelled()) return;

        dispatch({
          type: "hydrateGlobal",
          compCard: mergedCompCard,
          badges: mergedBadges,
        });
        // Only what the server now holds. A badge earned while this loaded,
        // or a guest's whose award didn't get through, stays in state
        // (hydrateGlobal unions) but not here, so the badge write-through
        // below awards it.
        persistedBadges.current = new Set(awardedBadges);
        if (migratedCourse) {
          // Shown at once if it's the course being played (merged with the
          // steps taken meanwhile) or no course is; another course's player
          // keeps its own. It isn't marked loaded: the course load below
          // reads it back from the server and merges it like any saved
          // progress, and only then is the course saved — a save that
          // didn't get through above among it.
          dispatch({ type: "guestCourseMigrated", course: migratedCourse });
        }
        setDbOwner(forUser);
        // Server components (dashboard journey, facilitator) were rendered
        // with pre-migration data — refresh them to pick up what we just wrote.
        if (migratedAnything) router.refresh();
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
  React.useEffect(() => {
    if (!hydrated || authed || dbReady || typeof heldBy.current === "string") {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state, hydrated, authed, dbReady]);

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
    if (loadedCourseRef.current !== slug) {
      courseSave.flush();
      loadedCourseRef.current = null;
    }
    if (!authed || !dbReady || !slug || loadedCourseRef.current === slug) return;
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
      // resulting render saves the merge.
      loadedCourseRef.current = slug;
      dispatch({
        type: "courseProgressLoaded",
        slug,
        saved: prog as CourseProgress | null,
      });
    })();
    return () => abort.abort();
  }, [authed, dbReady, state.course.courseSlug, locale, owner, courseSave]);

  // ---- DB write-through: course progress (debounced) ----
  // Never a course whose saved progress hasn't loaded and been merged in
  // here (loadedCourseRef, null while any course loads): the save replaces
  // the whole enrollment, so it would overwrite that progress with what's
  // in memory — nothing at all, for a course the learner has just come
  // back to. A save that fails is tried again (see pending-save.ts).
  React.useEffect(() => {
    if (!authed || !dbOwner) return;
    const slug = state.course.courseSlug;
    if (!slug || loadedCourseRef.current !== slug) return;
    const snap = state.course;
    // Opening a course doesn't enroll anyone: nothing done, nothing saved.
    if (snap === courseScheduled.current || !hasCourseProgress(snap)) return;
    courseScheduled.current = snap;
    const forUser = dbOwner;
    courseSave.schedule(
      () =>
        saveCourseProgress(
          slug,
          {
            stagesCompleted: snap.stagesCompleted,
            simulation: snap.simulation,
            scenario: { root: snap.scenario.root, followup: snap.scenario.followup },
            reflection: snap.reflection,
            assessment: snap.assessment,
            completedAt: snap.completedAt,
          },
          forUser
        ),
      slug
    );
  }, [authed, dbOwner, state.course, courseSave]);

  // ---- DB write-through: Comp Card (debounced) ----
  React.useEffect(() => {
    if (!authed || !dbOwner || !state.compCard.updatedAt) return;
    const snap = state.compCard;
    if (snap === cardScheduled.current) return;
    cardScheduled.current = snap;
    const forUser = dbOwner;
    cardSave.schedule(() =>
      saveCompCard(
        {
          wentWell: snap.wentWell,
          difficult: snap.difficult,
          improve: snap.improve,
          behaviour: snap.behaviour,
          confidence: snap.confidence,
          privacy: snap.privacy,
        },
        forUser
      )
    );
  }, [authed, dbOwner, state.compCard, cardSave]);

  // ---- DB write-through: badges (append-only) ----
  // An award that doesn't get through (a dropped connection, a session
  // lookup that failed) is sent again after 1 s, 2 s, 4 s and 8 s — it's
  // idempotent — unless the learner's data has been let go of meanwhile
  // (persistedBadges replaced). A completed course's badge is also saved
  // with the course itself (see saveCourseProgress).
  React.useEffect(() => {
    if (!authed || !dbOwner) return;
    const sent = persistedBadges.current;
    const tries = badgeTries.current;
    const forUser = dbOwner;
    for (const slug of state.badges) {
      if (sent.has(slug)) continue;
      sent.add(slug);
      awardBadgeAction(slug, forUser).then(
        () => tries.delete(slug),
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
  // Not left to a timer outliving this store: sent now, it reaches the
  // server before a store mounted next loads it back.
  React.useEffect(
    () => () => {
      courseSave.close();
      cardSave.close();
    },
    [courseSave, cardSave]
  );

  const value = React.useMemo(() => ({ state, dispatch }), [state]);

  return (
    <DemoStateContext.Provider value={value}>
      <GenerationContext.Provider value={generation}>
        {children}
      </GenerationContext.Provider>
    </DemoStateContext.Provider>
  );
}

/**
 * A page that shows the learner's data: the learner area's pages. It starts
 * over whenever the store lets go of the learner's data (their session gone,
 * or another account's now), so nothing on it keeps showing what was
 * theirs — or records it again, as the completion screen would — and its
 * server-rendered parts are rendered again for whoever holds the session
 * now: the dashboard's progress comes from the server. Only these pages: an
 * editor's, a facilitator's or an admin's page keeps what's typed into it.
 */
export function LearnerView({ children }: { children: React.ReactNode }) {
  const generation = React.useContext(GenerationContext);
  const router = useRouter();
  const shown = React.useRef(generation);
  React.useEffect(() => {
    if (shown.current === generation) return;
    shown.current = generation;
    router.refresh();
  }, [generation, router]);
  return <React.Fragment key={generation}>{children}</React.Fragment>;
}

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
  const value = React.useMemo(() => ({ state, dispatch }), [state]);
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
