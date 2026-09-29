"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
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
  mergeBadges,
  mergeCompCardOnHydrate,
} from "./progress-merge";
import { withRetry } from "./retry";

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
    case "hydrate":
      return action.state;
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

export function DemoStateProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, DEFAULT_STATE);
  const [hydrated, setHydrated] = React.useState(false);
  const [dbReady, setDbReady] = React.useState(false);

  const { status } = useSession();
  const router = useRouter();
  const locale = useLocale() as Locale;
  const authed = status === "authenticated";

  // The course whose saved progress has loaded and been merged into state;
  // null while one loads. Only this course is ever saved (see below).
  const loadedCourseRef = React.useRef<string | null>(null);
  const persistedBadges = React.useRef<Set<string>>(new Set());
  const courseTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const cardTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  // ---- Hydration: DB for authed users, localStorage for guests ----
  React.useEffect(() => {
    if (status === "loading") return;
    // Aborted on cleanup: stops the retries below and drops their result.
    const abort = new AbortController();
    const cancelled = () => abort.signal.aborted;
    (async () => {
      if (authed) {
        // Nothing is saved until this has loaded, so a failed try doesn't
        // end it: it's tried again (see retry.ts), and what the learner
        // does meanwhile stays in memory until it's through.
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
        // data for. Runs before setDbReady(true) so the write-through
        // effects below don't race the migration.
        let mergedCompCard = (global?.compCard ?? null) as CompCardData | null;
        let mergedBadges = global?.badges ?? [];
        let migratedCourse: CourseProgress | null = null;
        let migratedAnything = false;
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (raw) {
            // Remove first, so a re-run (StrictMode, second tab) can't
            // double-migrate.
            window.localStorage.removeItem(STORAGE_KEY);
            const guest = JSON.parse(raw) as DemoState;
            const enrolled = new Map(
              (global?.enrollments ?? []).map((e) => [e.slug, e])
            );

            // Badges: union. awardBadgeAction is idempotent.
            const dbBadges = new Set(mergedBadges);
            const newBadges = (guest.badges ?? []).filter((b) => !dbBadges.has(b));
            for (const slug of newBadges) await awardBadgeAction(slug);
            if (newBadges.length) {
              mergedBadges = [...mergedBadges, ...newBadges];
              migratedAnything = true;
            }

            // Comp Card: migrate only if the learner has none server-side.
            if (!mergedCompCard && guest.compCard?.updatedAt) {
              await saveCompCard({
                wentWell: guest.compCard.wentWell,
                difficult: guest.compCard.difficult,
                improve: guest.compCard.improve,
                behaviour: guest.compCard.behaviour,
                confidence: guest.compCard.confidence,
                privacy: guest.compCard.privacy,
              });
              mergedCompCard = guest.compCard;
              migratedAnything = true;
            }

            // Course: the guest store only holds the last-played course.
            // Migrate it only if the DB has no progress for that course yet.
            const gc = guest.course;
            if (
              gc?.courseSlug &&
              gc.stagesCompleted.length > 0 &&
              (enrolled.get(gc.courseSlug)?.stagesCompleted ?? 0) === 0
            ) {
              await saveCourseProgress(gc.courseSlug, {
                stagesCompleted: gc.stagesCompleted,
                simulation: gc.simulation,
                scenario: {
                  root: gc.scenario.root,
                  followup: gc.scenario.followup,
                },
                reflection: gc.reflection,
                assessment: gc.assessment,
                completedAt: gc.completedAt,
              });
              migratedCourse = gc;
              migratedAnything = true;
            }
          }
        } catch {
          /* best-effort — never block sign-in on a bad localStorage blob */
        }
        if (cancelled()) return;

        dispatch({
          type: "hydrateGlobal",
          compCard: mergedCompCard,
          badges: mergedBadges,
        });
        // Only what the server now holds. A badge earned while this loaded
        // stays in state (hydrateGlobal unions) but not here, so the badge
        // write-through below awards it.
        persistedBadges.current = new Set(mergedBadges);
        if (migratedCourse) {
          // Shown at once if it's the course being played (merged with the
          // steps taken meanwhile) or no course is; another course's player
          // keeps its own. It isn't marked loaded: the course load below
          // reads it back from the server and merges it like any saved
          // progress, and only then is the course saved.
          dispatch({ type: "guestCourseMigrated", course: migratedCourse });
        }
        setDbReady(true);
        // Server components (dashboard journey, facilitator) were rendered
        // with pre-migration data — refresh them to pick up what we just wrote.
        if (migratedAnything) router.refresh();
      } else {
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
      }
      if (!cancelled()) setHydrated(true);
    })();
    return () => abort.abort();
  }, [status, authed, router]);

  // ---- Guest localStorage write-through ----
  React.useEffect(() => {
    if (!hydrated || authed) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state, hydrated, authed]);

  // ---- Load a course's saved progress from the DB when it becomes active ----
  // The learner may be in the course before their data has loaded — on a
  // cold server they can walk all of it first — and the save effect below
  // skips every change until this load is done. So the result is always
  // dispatched, even when nothing is saved: courseProgressLoaded merges the
  // two, and a changed course object makes the save effect persist it.
  // Whatever course was loaded before stops counting as loaded here: coming
  // back to it resets it to empty (setCourseContext), so it has to load and
  // merge again before it may be saved. A failed load is tried again (see
  // retry.ts); until a try gets through, the course isn't saved and what
  // the learner does stays in memory.
  React.useEffect(() => {
    if (!authed || !dbReady) return;
    const slug = state.course.courseSlug;
    if (!slug || loadedCourseRef.current === slug) return;
    loadedCourseRef.current = null;
    const abort = new AbortController();
    (async () => {
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
  }, [authed, dbReady, state.course.courseSlug, locale]);

  // ---- DB write-through: course progress (debounced) ----
  // Never a course whose saved progress hasn't loaded and been merged in
  // here (loadedCourseRef, null while any course loads): the save replaces
  // the whole enrollment, so it would overwrite that progress with what's
  // in memory — nothing at all, for a course the learner has just come
  // back to.
  React.useEffect(() => {
    if (!authed || !dbReady) return;
    const slug = state.course.courseSlug;
    if (!slug || loadedCourseRef.current !== slug) return;
    const snap = state.course;
    clearTimeout(courseTimer.current);
    courseTimer.current = setTimeout(() => {
      void saveCourseProgress(slug, {
        stagesCompleted: snap.stagesCompleted,
        simulation: snap.simulation,
        scenario: { root: snap.scenario.root, followup: snap.scenario.followup },
        reflection: snap.reflection,
        assessment: snap.assessment,
        completedAt: snap.completedAt,
      });
    }, 700);
  }, [authed, dbReady, state.course]);

  // ---- DB write-through: Comp Card (debounced) ----
  React.useEffect(() => {
    if (!authed || !dbReady || !state.compCard.updatedAt) return;
    const snap = state.compCard;
    clearTimeout(cardTimer.current);
    cardTimer.current = setTimeout(() => {
      void saveCompCard({
        wentWell: snap.wentWell,
        difficult: snap.difficult,
        improve: snap.improve,
        behaviour: snap.behaviour,
        confidence: snap.confidence,
        privacy: snap.privacy,
      });
    }, 700);
  }, [authed, dbReady, state.compCard]);

  // ---- DB write-through: badges (append-only) ----
  React.useEffect(() => {
    if (!authed || !dbReady) return;
    for (const slug of state.badges) {
      if (!persistedBadges.current.has(slug)) {
        persistedBadges.current.add(slug);
        void awardBadgeAction(slug);
      }
    }
  }, [authed, dbReady, state.badges]);

  const value = React.useMemo(() => ({ state, dispatch }), [state]);

  return (
    <DemoStateContext.Provider value={value}>
      {children}
    </DemoStateContext.Provider>
  );
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
