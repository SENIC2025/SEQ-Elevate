/**
 * Server-side read queries for dashboards. Plain async functions called
 * from server components (not form actions). All project-scoped; learner
 * queries are for the *current* user, staff queries respect RBAC + Comp
 * Card privacy.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { getCourse } from "@/lib/cms";
import { readAssessment, scoreAssessment } from "@/lib/assessment-progress";
import {
  courseProgress,
  nextStage,
  overallProgress,
} from "@/lib/course-progress";
import type { Locale, CourseContent } from "@/lib/cms/types";
import type { Role } from "@prisma/client";

const PROJECT = "seq-elevate";

const PRIVACY_FROM_DB: Record<
  string,
  "self" | "facilitator" | "facilitatorAndMentor"
> = {
  SELF: "self",
  FACILITATOR: "facilitator",
  FACILITATOR_AND_MENTOR: "facilitatorAndMentor",
};

/** The current user's per-course enrollment summaries (own data). */
export async function getLearnerEnrollments() {
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    const rows = await prisma.courseEnrollment.findMany({
      where: { userId: user.id },
      include: { course: true },
    });
    return rows.map((e) => ({
      slug: e.course.slug,
      // Lowercased stage keys, so the dashboard checklist can show *which*
      // stages are done (not just the count) without re-querying.
      // The dashboard counts these against each course's own lessons
      // (CourseSummary.stageKeys), which it already has from the catalogue.
      stages: e.stagesCompleted.map((s) => s.toLowerCase()),
      stagesCompleted: e.stagesCompleted.length,
      completed: !!e.completedAt,
    }));
  } catch {
    return null;
  }
}

/** The current user's roles in the project (for view gating). */
export async function getViewerRoles(): Promise<Role[]> {
  try {
    const memberships = await getProjectMemberships(PROJECT);
    return memberships.map((m) => m.role);
  } catch {
    return [];
  }
}

export interface FacilitatorLearner {
  id: string;
  name: string;
  email: string;
  progressPct: number;
  completed: boolean;
  needsAttention: boolean;
  scenario: string | null;
  compCard: {
    wentWell: string;
    difficult: string;
    improve: string;
    behaviour: string;
    confidence: number;
    privacy: "self" | "facilitator" | "facilitatorAndMentor";
  } | null;
  /** In-video quiz engagement (questions answered / answered correctly). */
  videoAnswered: number;
  videoCorrect: number;
  /** Where the learner is right now. */
  currentCourse: string | null;
  currentStage: string | null; // stage key, or "complete"
  lastActiveAt: string | null; // ISO
  /** Active time on task (seconds): total + per stage key. */
  secondsTotal: number;
  secondsByStage: Record<string, number>;
  /** Quiz performance across the learner's courses. */
  assessmentCorrect: number;
  assessmentTotal: number;
  simulationCorrect: number;
  simulationTotal: number;
}

/**
 * Real learners in the project, for the facilitator workspace. RBAC-gated:
 * returns null unless the current user is a FACILITATOR or ADMIN. Comp Card
 * privacy is respected at the field level in the UI; scenario evidence is
 * resolved from the CMS.
 */
export async function getProjectLearners(
  locale: Locale
): Promise<FacilitatorLearner[] | null> {
  const roles = await getViewerRoles();
  if (!roles.includes("FACILITATOR") && !roles.includes("ADMIN")) return null;

  try {
    return await loadLearners(locale);
  } catch {
    return [];
  }
}

async function loadLearners(
  locale: Locale
): Promise<FacilitatorLearner[]> {
  const memberships = await prisma.membership.findMany({
    where: { projectId: PROJECT, role: "LEARNER" },
    include: {
      user: {
        include: {
          enrollments: { include: { course: true } },
          compCards: { where: { projectId: PROJECT } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Engagement + time-on-task per learner (recorded as AuditLog events).
  const learnerIds = memberships.map((m) => m.user.id);
  const videoByUser = new Map<string, { answered: number; correct: number }>();
  const timeByUser = new Map<
    string,
    { total: number; byStage: Record<string, number> }
  >();
  if (learnerIds.length) {
    const events = await prisma.auditLog.findMany({
      where: {
        projectId: PROJECT,
        action: { in: ["video.cue_answered", "stage.time"] },
        actorId: { in: learnerIds },
      },
      select: { actorId: true, action: true, metadata: true },
    });
    for (const ev of events) {
      if (!ev.actorId) continue;
      if (ev.action === "video.cue_answered") {
        const cur = videoByUser.get(ev.actorId) ?? { answered: 0, correct: 0 };
        cur.answered += 1;
        const md = ev.metadata as { correct?: boolean } | null;
        if (md?.correct === true) cur.correct += 1;
        videoByUser.set(ev.actorId, cur);
      } else {
        const md = ev.metadata as { stage?: string; seconds?: number } | null;
        const secs = md?.seconds ?? 0;
        const cur =
          timeByUser.get(ev.actorId) ?? { total: 0, byStage: {} };
        cur.total += secs;
        if (md?.stage) cur.byStage[md.stage] = (cur.byStage[md.stage] ?? 0) + secs;
        timeByUser.set(ev.actorId, cur);
      }
    }
  }

  // Resolve course content once per slug for scenario labels.
  const slugs = new Set<string>();
  for (const m of memberships)
    for (const e of m.user.enrollments) slugs.add(e.course.slug);
  const contentBySlug = new Map<string, CourseContent>();
  for (const slug of slugs) {
    const c = await getCourse(PROJECT, slug, locale);
    if (c) contentBySlug.set(slug, c);
  }

  const labelFor = (
    courseSlug: string,
    root: string | null,
    followup: string | null
  ): string | null => {
    if (!root) return null;
    const scenario = contentBySlug
      .get(courseSlug)
      ?.stages.find((s) => s.key === "scenario")?.scenario;
    const r = scenario?.choices.find((c) => c.id === root);
    if (!r) return null;
    const f = r.followups?.find((x) => x.id === followup);
    return f ? `${r.text} → ${f.text}` : r.text;
  };

  // Each course's own lessons, as the player shows them: a course created in
  // the CMS can have four rather than seven. A course that no longer
  // resolves counts as the full seven (courseStageKeys' default).
  const stageKeysOf = (slug: string) =>
    contentBySlug.get(slug)?.stages.map((s) => s.key);

  return memberships.map((m): FacilitatorLearner => {
    const u = m.user;
    const enr = u.enrollments;
    const { pct: progressPct } = overallProgress(
      enr.map((e) =>
        courseProgress(
          stageKeysOf(e.course.slug),
          e.stagesCompleted,
          !!e.completedAt
        )
      )
    );
    const completed = enr.length > 0 && enr.every((e) => !!e.completedAt);
    const card = u.compCards[0] ?? null;
    const ev = enr.find((e) => e.scenarioRoot);
    const video = videoByUser.get(u.id) ?? { answered: 0, correct: 0 };
    const time = timeByUser.get(u.id) ?? { total: 0, byStage: {} };

    // Current position: the most recently updated enrollment, and the next
    // stage in it (or "complete").
    const recent = [...enr].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    )[0];
    let currentStage: string | null = null;
    let currentCourse: string | null = null;
    let lastActiveAt: string | null = null;
    if (recent) {
      lastActiveAt = recent.updatedAt.toISOString();
      currentCourse =
        contentBySlug.get(recent.course.slug)?.title ?? recent.course.slug;
      currentStage = nextStage(
        stageKeysOf(recent.course.slug),
        recent.stagesCompleted,
        !!recent.completedAt
      );
    }

    // Quiz performance across enrollments.
    let assessmentCorrect = 0;
    let assessmentTotal = 0;
    let simulationCorrect = 0;
    let simulationTotal = 0;
    for (const e of enr) {
      if (e.simulationCorrect != null) {
        simulationTotal += 1;
        if (e.simulationCorrect) simulationCorrect += 1;
      }
      const qs =
        contentBySlug.get(e.course.slug)?.stages.find(
          (s) => s.key === "assessment"
        )?.assessment?.questions ?? [];
      // By question id: a quiz made in the course editor has its own ids,
      // and any number of questions (see assessment-progress.ts).
      const score = scoreAssessment(qs, readAssessment(e.assessment));
      assessmentTotal += score.total;
      assessmentCorrect += score.correct;
    }

    return {
      id: u.id,
      name: u.name ?? u.email ?? "Learner",
      email: u.email,
      progressPct,
      completed,
      needsAttention: progressPct > 0 && progressPct < 50 && !completed,
      scenario: ev
        ? labelFor(ev.course.slug, ev.scenarioRoot, ev.scenarioFollowup)
        : null,
      compCard: card
        ? {
            wentWell: card.wentWell,
            difficult: card.difficult,
            improve: card.improve,
            behaviour: card.behaviour,
            confidence: card.confidence,
            privacy: PRIVACY_FROM_DB[card.privacy],
          }
        : null,
      videoAnswered: video.answered,
      videoCorrect: video.correct,
      currentCourse,
      currentStage,
      lastActiveAt,
      secondsTotal: time.total,
      secondsByStage: time.byStage,
      assessmentCorrect,
      assessmentTotal,
      simulationCorrect,
      simulationTotal,
    };
  });
}

/** Aggregate counts for the admin dashboard (anonymised). */
export async function getAdminCounts() {
  try {
    const [users, cohorts, organisations, courses] = await Promise.all([
      prisma.membership.count({
        where: { projectId: PROJECT, role: "LEARNER" },
      }),
      prisma.cohort.count({ where: { projectId: PROJECT } }),
      prisma.organisation.count({ where: { projectId: PROJECT } }),
      prisma.course.count({
        where: { projectId: PROJECT, status: "published" },
      }),
    ]);
    return { users, cohorts, organisations, courses };
  } catch {
    return { users: 0, cohorts: 0, organisations: 0, courses: 0 };
  }
}
