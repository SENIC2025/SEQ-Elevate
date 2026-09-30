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

/**
 * The signed-in learner, for every load and save the learner store makes.
 * The store calls them only once the session says someone is signed in, so
 * no user here means the session lookup failed, not that nothing is saved
 * or that nothing needs saving: Auth.js's database session lookup logs a
 * database error (a cold start, a dropped connection) and answers "no
 * session" instead of failing. Answering "nothing saved" would let the
 * store save what it holds over the learner's saved data, and answering a
 * save as done would lose it, so this fails, and the store tries again
 * (src/store/retry.ts, src/store/pending-save.ts). A real sign-out ends
 * the same way: nothing loads or saves, and the store stops trying once it
 * has let go of the learner's data (src/store/session-owner.ts).
 */
async function requireLearner() {
  const user = await getCurrentUser();
  if (!user) throw new Error("No signed-in learner, or the session lookup failed");
  return user;
}

/**
 * Is `user` the learner a save was made for? The store sends whose data
 * it saves (`forUser`: the learner whose saved data it loaded — their id,
 * or their email if a session had no id; src/store/session-owner.ts). A
 * save still on its way when another account signed in on this browser
 * must not land in that account: it's dropped, not tried again. A call
 * without it comes from a page loaded before the store sent it, and is
 * saved for whoever is signed in, as it was then.
 */
function isLearner(
  user: { id: string; email: string | null },
  forUser: string | undefined
) {
  if (typeof forUser !== "string") return true;
  return user.id === forUser || (user.email !== null && user.email === forUser);
}

/** Auto-provision a LEARNER membership on first use. */
export async function ensureLearnerMembership() {
  const user = await requireLearner();
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
  const user = await requireLearner();
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

/**
 * A single course's progress, with display labels resolved from the CMS;
 * null when there is no such course or the learner isn't enrolled in it.
 */
export async function loadCourseProgress(slug: string, locale: Locale) {
  const user = await requireLearner();
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

/**
 * Upsert a course's progress for the current user, who must be `forUser`
 * (see isLearner). A completed course's badge is saved with it, in one
 * transaction: the badge award the store sends separately may not get
 * through, and the course can't end up completed without its badge.
 */
export async function saveCourseProgress(
  slug: string,
  progress: CourseProgressInput,
  forUser: string
) {
  const user = await requireLearner();
  if (!isLearner(user, forUser)) return;
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

  const enrollment = prisma.courseEnrollment.upsert({
    where: { userId_courseId: { userId: user.id, courseId: course.id } },
    create: { userId: user.id, courseId: course.id, ...data },
    update: data,
  });
  if (data.completedAt && course.badgeId) {
    await prisma.$transaction([
      enrollment,
      prisma.userBadge.upsert({
        where: { userId_badgeId: { userId: user.id, badgeId: course.badgeId } },
        create: { userId: user.id, badgeId: course.badgeId },
        update: {},
      }),
    ]);
  } else {
    await enrollment;
  }
}

/** Upsert the current user's Comp Card; they must be `forUser` (isLearner). */
export async function saveCompCard(input: CompCardInput, forUser: string) {
  const user = await requireLearner();
  if (!isLearner(user, forUser)) return;
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

/**
 * Award a badge to the current user (idempotent); they must be `forUser`
 * (isLearner).
 */
export async function awardBadgeAction(slug: string, forUser: string) {
  const user = await requireLearner();
  if (!isLearner(user, forUser)) return;
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
