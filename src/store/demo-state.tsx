"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
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
  | { type: "hydrateCourse"; course: CourseProgress };

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
      return {
        ...state,
        badges: action.badges,
        compCard: action.compCard ?? state.compCard,
      };
    case "hydrateCourse":
      return { ...state, course: action.course };
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
  const locale = useLocale() as Locale;
  const authed = status === "authenticated";

  const courseLoadingRef = React.useRef(false);
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
    let cancelled = false;
    (async () => {
      if (authed) {
        await ensureLearnerMembership();
        const global = await loadLearnerGlobal();
        if (cancelled) return;
        if (global) {
          dispatch({
            type: "hydrateGlobal",
            compCard: global.compCard as CompCardData | null,
            badges: global.badges,
          });
          persistedBadges.current = new Set(global.badges);
        }
        setDbReady(true);
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
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, authed]);

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
  React.useEffect(() => {
    if (!authed || !dbReady) return;
    const slug = state.course.courseSlug;
    if (!slug || loadedCourseRef.current === slug) return;
    let cancelled = false;
    courseLoadingRef.current = true;
    (async () => {
      const prog = await loadCourseProgress(slug, locale);
      if (cancelled) return;
      if (prog) dispatch({ type: "hydrateCourse", course: prog as CourseProgress });
      loadedCourseRef.current = slug;
      courseLoadingRef.current = false;
    })();
    return () => {
      cancelled = true;
      courseLoadingRef.current = false;
    };
  }, [authed, dbReady, state.course.courseSlug, locale]);

  // ---- DB write-through: course progress (debounced) ----
  React.useEffect(() => {
    if (!authed || !dbReady || courseLoadingRef.current) return;
    const slug = state.course.courseSlug;
    if (!slug) return;
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

export function useDemoState() {
  const ctx = React.useContext(DemoStateContext);
  if (!ctx) throw new Error("useDemoState must be used inside DemoStateProvider");
  return ctx;
}
