"use server";

/**
 * DB-backed learner state. Authenticated learners persist progress, Comp
 * Card, and badges to Postgres (Neon); guests use localStorage (handled in
 * the client provider). All actions are scoped to the current user +
 * project. Stage keys map to the StageKey enum; the client uses lowercase.
 */

import { getCurrentUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getCourse } from "@/lib/cms";
import type { Locale } from "@/lib/cms/types";
import type { StageKey, PrivacyChoice } from "@prisma/client";

const PROJECT = "seq-elevate";

const PRIVACY_TO_DB: Record<string, PrivacyChoice> = {
  self: "SELF",
  facilitator: "FACILITATOR",
  facilitatorAndMentor: "FACILITATOR_AND_MENTOR",
};
const PRIVACY_FROM_DB: Record<string, "self" | "facilitator" | "facilitatorAndMentor"> = {
  SELF: "self",
  FACILITATOR: "facilitator",
  FACILITATOR_AND_MENTOR: "facilitatorAndMentor",
};

export interface CourseProgressInput {
  stagesCompleted: string[];
  simulation: { choice: string; correct: boolean } | null;
  scenario: { root: string | null; followup: string | null };
  reflection: { p1: string; p2: string; p3: string };
  assessment: { q1: string | null; q2: string | null; q3: string | null };
  completedAt: string | null;
}

export interface CompCardInput {
  wentWell: string;
  difficult: string;
  improve: string;
  behaviour: string;
  confidence: number;
  privacy: "self" | "facilitator" | "facilitatorAndMentor";
}

/** Auto-provision a LEARNER membership on first use. */
export async function ensureLearnerMembership() {
  const user = await getCurrentUser();
  if (!user) return false;
  const existing = await prisma.membership.findFirst({
    where: { userId: user.id, projectId: PROJECT, role: "LEARNER" },
  });
  if (!existing) {
    await prisma.membership.create({
      data: { userId: user.id, projectId: PROJECT, role: "LEARNER" },
    });
  }
  return true;
}

/** Global learner state: Comp Card, badges, per-course enrollment summaries. */
export async function loadLearnerGlobal() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [compCard, badges, enrollments] = await Promise.all([
    prisma.compCard.findUnique({
      where: { userId_projectId: { userId: user.id, projectId: PROJECT } },
    }),
    prisma.userBadge.findMany({
      where: { userId: user.id },
      include: { badge: true },
    }),
    prisma.courseEnrollment.findMany({
      where: { userId: user.id },
      include: { course: true },
    }),
  ]);
  return {
    compCard: compCard
      ? {
          wentWell: compCard.wentWell,
          difficult: compCard.difficult,
          improve: compCard.improve,
          behaviour: compCard.behaviour,
          confidence: compCard.confidence,
          privacy: PRIVACY_FROM_DB[compCard.privacy],
          updatedAt: compCard.updatedAt.toISOString(),
        }
      : null,
    badges: badges.map((b) => b.badge.slug),
    enrollments: enrollments.map((e) => ({
      slug: e.course.slug,
      stagesCompleted: e.stagesCompleted.length,
      completed: !!e.completedAt,
    })),
  };
}

/** A single course's progress, with display labels resolved from the CMS. */
export async function loadCourseProgress(slug: string, locale: Locale) {
  const user = await getCurrentUser();
  if (!user) return null;
  const course = await prisma.course.findUnique({
    where: { projectId_slug: { projectId: PROJECT, slug } },
  });
  if (!course) return null;
  const e = await prisma.courseEnrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId: course.id } },
  });
  if (!e) return null;

  // Resolve scenario choice labels + course title from the CMS.
  const content = await getCourse(PROJECT, slug, locale);
  let rootLabel: string | null = null;
  let followupLabel: string | null = null;
  const scenario = content?.stages.find((s) => s.key === "scenario")?.scenario;
  if (scenario) {
    const root = scenario.choices.find((c) => c.id === e.scenarioRoot);
    rootLabel = root?.text ?? null;
    followupLabel =
      root?.followups?.find((f) => f.id === e.scenarioFollowup)?.text ?? null;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const refl = (e.reflection as any) ?? {};
  const asmt = (e.assessment as any) ?? {};
  return {
    courseSlug: slug,
    courseTitle: content?.title ?? null,
    stagesCompleted: e.stagesCompleted.map((s) => s.toLowerCase()),
    simulation: e.simulationChoice
      ? { choice: e.simulationChoice, correct: !!e.simulationCorrect }
      : null,
    scenario: {
      root: e.scenarioRoot,
      followup: e.scenarioFollowup,
      rootLabel,
      followupLabel,
    },
    reflection: { p1: refl.p1 ?? "", p2: refl.p2 ?? "", p3: refl.p3 ?? "" },
    assessment: {
      q1: asmt.q1 ?? null,
      q2: asmt.q2 ?? null,
      q3: asmt.q3 ?? null,
    },
    completedAt: e.completedAt?.toISOString() ?? null,
  };
}

/** Upsert a course's progress for the current user. */
export async function saveCourseProgress(
  slug: string,
  progress: CourseProgressInput
) {
  const user = await getCurrentUser();
  if (!user) return;
  const course = await prisma.course.findUnique({
    where: { projectId_slug: { projectId: PROJECT, slug } },
  });
  if (!course) return;

  const data = {
    stagesCompleted: progress.stagesCompleted.map(
      (s) => s.toUpperCase() as StageKey
    ),
    simulationChoice: progress.simulation?.choice ?? null,
    simulationCorrect: progress.simulation?.correct ?? null,
    scenarioRoot: progress.scenario.root,
    scenarioFollowup: progress.scenario.followup,
    reflection: progress.reflection,
    assessment: progress.assessment,
    completedAt: progress.completedAt ? new Date(progress.completedAt) : null,
  };

  await prisma.courseEnrollment.upsert({
    where: { userId_courseId: { userId: user.id, courseId: course.id } },
    create: { userId: user.id, courseId: course.id, ...data },
    update: data,
  });
}

/** Upsert the current user's Comp Card. */
export async function saveCompCard(input: CompCardInput) {
  const user = await getCurrentUser();
  if (!user) return;
  const data = {
    wentWell: input.wentWell,
    difficult: input.difficult,
    improve: input.improve,
    behaviour: input.behaviour,
    confidence: input.confidence,
    privacy: PRIVACY_TO_DB[input.privacy] ?? "FACILITATOR",
  };
  await prisma.compCard.upsert({
    where: { userId_projectId: { userId: user.id, projectId: PROJECT } },
    create: { userId: user.id, projectId: PROJECT, ...data },
    update: data,
  });
}

/** Award a badge to the current user (idempotent). */
export async function awardBadgeAction(slug: string) {
  const user = await getCurrentUser();
  if (!user) return;
  const badge = await prisma.badge.findUnique({
    where: { projectId_slug: { projectId: PROJECT, slug } },
  });
  if (!badge) return;
  await prisma.userBadge.upsert({
    where: { userId_badgeId: { userId: user.id, badgeId: badge.id } },
    create: { userId: user.id, badgeId: badge.id },
    update: {},
  });
}
