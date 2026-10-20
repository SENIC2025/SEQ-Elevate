"use server";

/**
 * DB-backed learner state. Authenticated learners persist progress, Comp
 * Card, and badges to Postgres (Neon); guests use localStorage (handled in
 * the client provider). All actions are scoped to the current user +
 * project. Stage keys map to the StageKey enum; the client uses lowercase.
 *
 * Release 2 (D62): progress is saved as patches (saveCourseProgressPatch),
 * merged into the enrolment under its row lock, so a stale tab can't
 * un-complete a course or overwrite an answer it never changed. Release 1's
 * whole-progress save stays for pages loaded before the deploy, filtered to
 * the standard lessons.
 */

import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { isBootstrapAdmin } from "@/lib/admin-bootstrap";
import { needsLearnerMembership } from "@/lib/learner-membership";
import { ensureProjectRoles } from "@/lib/role-grants";
import { prisma } from "@/lib/prisma";
import type { BadgeAwardResult } from "@/lib/badge-award";
import { getCourse } from "@/lib/cms";
import { ensureCourseBadge } from "@/lib/cms/ensure-course-badge";
import { isLegacySectionId } from "@/lib/cms/sections/contract";
import { SLUG } from "@/lib/cms/sections/store.server";
import type { Locale } from "@/lib/cms/types";
import {
  parseAssessmentInput,
  readAssessment,
  type AssessmentProgress,
} from "@/lib/assessment-progress";
import type { RefusedKey, SaveProgressResult } from "@/lib/learner-progress/contract";
import { completedLessonIds, enrolmentHasProgress } from "@/lib/learner-progress/enrolment-read";
import {
  EMPTY_ENROLLMENT,
  mergeIntoEnrollment,
  type EnrollmentProgress,
  type MergeResult,
  type ProgressColumn,
} from "@/lib/learner-progress/merge-server";
import { parseProgressPatch, readIds, readResponses } from "@/lib/learner-progress/parse";
import { Prisma, type StageKey, type PrivacyChoice } from "@prisma/client";

export type { SaveProgressResult };

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
  /**
   * Quick-check answers by question id, and whether they were checked
   * (see assessment-progress.ts). A page loaded before answers were kept
   * still sends three empty slots ({ q1, q2, q3 }): that leaves the saved
   * answers as they are.
   */
  assessment: AssessmentProgress | Record<string, string | null>;
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

/**
 * Give someone who signed in by themselves a place in the project: a
 * LEARNER membership, but only when they hold no role in it at all (see
 * needsLearnerMembership). Staff stay staff, and nothing they hold is
 * removed. The roles are read through getProjectMemberships, which grants
 * an ADMIN_EMAILS address its roles first. A failed read fails the call,
 * so the store tries again rather than guessing that there are none.
 */
export async function ensureLearnerMembership() {
  const user = await requireLearner();
  const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
  if (
    needsLearnerMembership(roles, {
      bootstrapAdmin: isBootstrapAdmin(user.email),
    })
  ) {
    // Two tabs loading at once can both get here; the upsert (and its
    // unique-constraint guard) makes the second one a no-op.
    await ensureProjectRoles(user.id, PROJECT, ["LEARNER"]);
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
      // Standard lessons and the course's own.
      stagesCompleted: completedLessonIds(e).length,
      completed: !!e.completedAt,
      // Anything saved at all: a rating or an own reflection alone counts
      // (D37 "the account wins", per course).
      hasProgress: enrolmentHasProgress(e),
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
    assessment: readAssessment(e.assessment),
    completedAt: e.completedAt?.toISOString() ?? null,
    // Release 2: the course's own lessons finished, and every answer
    // without a column of its own (without the time of its last change).
    sectionsCompleted: readIds(e.sectionsCompleted),
    responses: readResponses(e.responses),
  };
}

/** The progress columns, as mergeIntoEnrollment reads them. */
const PROGRESS_SELECT = {
  stagesCompleted: true,
  sectionsCompleted: true,
  simulationChoice: true,
  simulationCorrect: true,
  scenarioRoot: true,
  scenarioFollowup: true,
  reflection: true,
  assessment: true,
  responses: true,
  completedAt: true,
} as const;

interface ProgressCourse {
  id: string;
  badgeId: string | null;
  meta: unknown;
}

/** The changed columns as Prisma writes them: an empty JSON column is NULL again. */
function columnsOf(m: MergeResult): Prisma.CourseEnrollmentUpdateInput {
  const data: Record<string, unknown> = {};
  for (const column of m.changed) {
    const value = m.next[column];
    if (column === "sectionsCompleted" || column === "responses") {
      const empty =
        value === null ||
        (Array.isArray(value) && value.length === 0) ||
        (column === "responses" &&
          typeof value === "object" &&
          Object.keys((value as { items?: object }).items ?? {}).length === 0);
      data[column] = empty ? Prisma.DbNull : value;
    } else if (column === "stagesCompleted") {
      data[column] = value as StageKey[];
    } else {
      data[column] = value;
    }
  }
  return data as Prisma.CourseEnrollmentUpdateInput;
}

/**
 * One progress save, in one transaction, with the lock order fixed (spec
 * 4.1, 4.9):
 *
 *   1. the Course row: FOR UPDATE up front when this save may create the
 *      course's badge (ensureCourseBadge takes it), so no lock is ever
 *      upgraded and two learners finishing a badgeless course can't
 *      deadlock; else FOR KEY SHARE, which runs beside other learners and
 *      content saves, and waits for list changes, deletes and publishing —
 *      so an editor's learner count can't change under their lock;
 *   2. the enrolment row FOR UPDATE: two tabs are taken one at a time. No
 *      row yet: merged against an empty one, and created only if something
 *      would be written (opening a course enrols no one), then locked and
 *      read again in case another tab created it meanwhile.
 *
 * Only the columns that changed are written: a save that changes nothing
 * leaves updatedAt ("last active") alone. A course finished by this save
 * saves its badge in the same transaction. Never a Lesson row; not audited
 * (learner saves never were, and audit rows outlive erasure, D62.g).
 */
async function saveProgress(
  userId: string,
  course: ProgressCourse,
  mayComplete: boolean,
  merge: (row: EnrollmentProgress | null) => MergeResult
): Promise<RefusedKey[]> {
  return prisma.$transaction(async (tx) => {
    let badgeId = course.badgeId;
    if (mayComplete && badgeId === null && course.meta !== null) {
      badgeId = await ensureCourseBadge(tx, course.id);
    } else {
      await tx.$queryRaw`SELECT id FROM "Course" WHERE "id" = ${course.id} FOR KEY SHARE`;
    }

    const where = { userId_courseId: { userId, courseId: course.id } };
    const lockRow = async () => {
      await tx.$queryRaw`SELECT id FROM "CourseEnrollment" WHERE "userId" = ${userId} AND "courseId" = ${course.id} FOR UPDATE`;
      return tx.courseEnrollment.findUnique({ where, select: PROGRESS_SELECT });
    };
    let row = await lockRow();
    if (!row) {
      const fresh = merge(null);
      if (!fresh.changed.length) return fresh.refused;
      await tx.courseEnrollment.createMany({ data: [{ userId, courseId: course.id }], skipDuplicates: true });
      row = await lockRow();
      if (!row) throw new Error("The enrolment just created can't be read");
    }

    const merged = merge(row);
    if (merged.changed.length) {
      await tx.courseEnrollment.update({ where, data: columnsOf(merged) });
    }
    if (merged.completedNow && badgeId) {
      await tx.userBadge.upsert({
        where: { userId_badgeId: { userId, badgeId } },
        create: { userId, badgeId },
        update: {},
      });
    }
    return merged.refused;
  });
}

/**
 * Save a patch of a course's progress for the current user, who must be
 * `forUser` (see isLearner): only what changed since the store's last
 * confirmed save (src/lib/learner-progress/patch.ts), merged into what is
 * stored (merge-server.ts). Answered, not thrown, when it can never
 * succeed — another account's, no such course, not a patch, too big — so
 * the store doesn't try it again; a thrown error (no session, a dropped
 * connection) is tried again. Values the rules refuse are refused key by
 * key, and the rest is saved.
 *
 * No role check (D53: staff may play courses) and no course-status check
 * (D62.f: a learner whose course was unpublished mid-session must not lose
 * their answers).
 */
export async function saveCourseProgressPatch(
  slug: string,
  patch: unknown,
  forUser: string
): Promise<SaveProgressResult> {
  const user = await requireLearner();
  if (!isLearner(user, forUser)) return { ok: false, error: "other-account" };
  if (typeof slug !== "string" || !SLUG.test(slug)) return { ok: false, error: "bad-input" };
  const now = new Date();
  const parsed = parseProgressPatch(patch, now);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const p = parsed.patch;
  // Nothing to save (or all of it refused): the database isn't touched.
  if (!p.completed.length && !p.answers.length && !p.completedAt) return { ok: true, refused: p.refused };

  const course = await prisma.course.findUnique({
    where: { projectId_slug: { projectId: PROJECT, slug } },
    select: { id: true, badgeId: true, meta: true },
  });
  if (!course) return { ok: false, error: "unknown-course" };
  const refused = await saveProgress(user.id, course, p.completedAt !== null, (row) =>
    mergeIntoEnrollment(row, p, now)
  );
  return { ok: true, refused };
}

/**
 * Release 1's save of a course's whole progress, kept for pages loaded
 * before the deploy (D62.e, D68: the same name and signature, so their
 * action id still resolves). It runs through saveCourseProgressPatch's
 * transaction and locks, and:
 *   - keeps only the standard lessons of stagesCompleted, so it never casts
 *     an "s-…" id to the enum, and adds them to what is stored;
 *   - keeps a stored completedAt (a page that hasn't seen the completion
 *     sends null);
 *   - writes the four standard answer columns as it always has;
 *   - never touches Release 2's columns.
 * A completed course's badge is saved with it (C9).
 */
export async function saveCourseProgress(
  slug: string,
  progress: CourseProgressInput,
  forUser: string
) {
  const user = await requireLearner();
  if (!isLearner(user, forUser)) return;
  // From the browser, so checked: only short texts, and not too many of
  // them. Throws for anything else; null leaves the saved answers alone.
  const assessment = parseAssessmentInput(progress.assessment as unknown);
  const course = await prisma.course.findUnique({
    where: { projectId_slug: { projectId: PROJECT, slug } },
  });
  if (!course) return;

  const stages = progress.stagesCompleted
    .filter(isLegacySectionId)
    .map((s) => s.toUpperCase() as StageKey);
  const completedAt = progress.completedAt ? new Date(progress.completedAt) : null;
  await saveProgress(user.id, course, completedAt !== null, (row) => {
    const before = row ?? EMPTY_ENROLLMENT;
    const next: EnrollmentProgress = {
      ...before,
      stagesCompleted: [...before.stagesCompleted, ...stages.filter((s) => !before.stagesCompleted.includes(s))],
      simulationChoice: progress.simulation?.choice ?? null,
      simulationCorrect: progress.simulation?.correct ?? null,
      scenarioRoot: progress.scenario.root,
      scenarioFollowup: progress.scenario.followup,
      reflection: progress.reflection,
      // Null: the column keeps what it holds, {} for a new enrollment.
      assessment: assessment ?? before.assessment,
      completedAt: before.completedAt ?? completedAt,
    };
    const changed = (Object.keys(next) as ProgressColumn[]).filter(
      (c) => JSON.stringify(before[c]) !== JSON.stringify(next[c])
    );
    return {
      next,
      changed,
      refused: [],
      completedNow: before.completedAt === null && next.completedAt !== null,
    };
  });
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
 * (isLearner). A badge with no Badge row is refused rather than answered as
 * if it were saved: the learner would lose the badge on the next reload
 * without anyone knowing (C9). It is answered, not thrown, because a thrown
 * award is tried again as if the connection had dropped, and this one can
 * never succeed (badge-award.ts). Every course's badge has a row: the seed
 * makes the bundled ones, createCourse and its migration the others, and a
 * created course the old code left without one gets it when it is
 * published or finished, or by the next deploy (ensure-course-badge.ts).
 */
export async function awardBadgeAction(
  slug: string,
  forUser: string
): Promise<BadgeAwardResult> {
  const user = await requireLearner();
  if (!isLearner(user, forUser)) return { ok: false, reason: "other-account" };
  const badge = await prisma.badge.findUnique({
    where: { projectId_slug: { projectId: PROJECT, slug } },
  });
  if (!badge) return { ok: false, reason: "no-badge" };
  await prisma.userBadge.upsert({
    where: { userId_badgeId: { userId: user.id, badgeId: badge.id } },
    create: { userId: user.id, badgeId: badge.id },
    update: {},
  });
  return { ok: true };
}
