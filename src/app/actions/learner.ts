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
 * whole-progress save keeps its name and writes nothing (D118).
 *
 * D118: a course's completion, its date and its badge follow from what the
 * learner did. A save completes a course only once every lesson the
 * learner's player gives it is finished; the date is held between the
 * enrolment's start and now; a badge is given only for a course the
 * learner has completed.
 */

import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { isBootstrapAdmin } from "@/lib/admin-bootstrap";
import {
  COMP_CARD_BLANK_CONFIDENCE,
  COMP_CARD_FIELDS,
  SHARING_TEXT_VERSION,
  effectiveSharing,
  parseCompCardInput,
  type CompCardField,
  type Sharing,
} from "@/lib/comp-card-visibility";
import {
  parseGuestClaim,
  type ClaimCardOutcome,
  type ClaimCourseOutcome,
  type ClaimedCard,
  type GuestClaimResult,
  type ParsedClaim,
} from "@/lib/guest-claim";
import { isProfileComplete, profileRules } from "@/lib/profile";
import { needsLearnerMembership } from "@/lib/learner-membership";
import { releaseIfCountryElsewhere } from "@/lib/person-organisation";
import { ensureProjectRoles } from "@/lib/role-grants";
import { prisma } from "@/lib/prisma";
import type { BadgeAwardResult } from "@/lib/badge-award";
import { getCourse } from "@/lib/cms";
import { learnerContentLocale } from "@/lib/cms/language-ready";
import { normaliseStatus } from "@/lib/cms/course-status";
import { ensureCourseBadge } from "@/lib/cms/ensure-course-badge";
import { lessonPlanOf } from "@/lib/cms/sections/learner-path";
import { SLUG, loadLessonFacts, planFacts } from "@/lib/cms/sections/store.server";
import type { Locale } from "@/lib/cms/types";
import { readAssessment, type AssessmentProgress } from "@/lib/assessment-progress";
import type { RefusedKey, SaveProgressResult } from "@/lib/learner-progress/contract";
import { completedLessonIds, enrolmentHasProgress } from "@/lib/learner-progress/enrolment-read";
import {
  mergeIntoEnrollment,
  type CompletionRule,
  type EnrollmentProgress,
  type MergeResult,
} from "@/lib/learner-progress/merge-server";
import { parseProgressPatch, readIds, readResponses, type ParsedPatch } from "@/lib/learner-progress/parse";
import { Prisma, type StageKey } from "@prisma/client";

// SaveProgressResult is imported from @/lib/learner-progress/contract, and
// GuestClaimResult from @/lib/guest-claim, not from here: a "use server"
// module may export only async functions, and Next's action transform takes
// a re-exported type for a value.

const PROJECT = "seq-elevate";

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

/**
 * A Comp Card save (D80): every field optional, and only the fields sent are
 * written. `privacy` is what pages loaded before Release 3 still send; it is
 * ignored, as anything else is: sharing changes only through
 * setCompCardSharing.
 */
export interface CompCardInput {
  wentWell?: string;
  difficult?: string;
  improve?: string;
  behaviour?: string;
  confidence?: number;
  privacy?: unknown;
}

/** What a Comp Card save answers: answered, never thrown, so the store doesn't try it again. */
export type SaveCompCardResult =
  | { ok: true }
  | { ok: false; error: "too-long" | "bad-input"; field?: CompCardField }
  | { ok: false; error: "other-account" | "profile-incomplete" };

/** What a change of the Comp Card's sharing answers (spec 4.3). */
export type SetSharingResult =
  | { ok: true; sharing: Sharing; sharedAt: string | null; organisationName: string | null }
  | {
      ok: false;
      error: "other-account" | "bad-input" | "profile-incomplete" | "no-organisation" | "guardian-consent-needed";
    };

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
 * The signed-in person's own profile in the project, as far as the learner
 * actions read it: whether the profile step is done (for the rules in
 * force), their organisation, and the guardian rule. Called only with the
 * signed-in learner's id.
 *
 * Before the profile step is done nothing of the person's learning is
 * saved (D79): the course saves, the Comp Card's save and the badge award
 * refuse ("profile-incomplete", nothing written), whatever R3_PROFILE_GATE
 * says, as POST /api/progress/beacon and the activity records
 * (telemetry.ts, video.ts) do. A Release 3 page saves nothing before
 * then anyway (ensureLearnerMembership); the refusal is for a page loaded
 * before the person's profile stopped being complete (new Terms) or before
 * Release 3 (a Release 2 page), and for a hand-made call.
 */
async function ownProfile(userId: string) {
  return prisma.projectProfile.findUnique({
    where: { userId_projectId: { userId, projectId: PROJECT } },
    select: {
      country: true,
      termsVersion: true,
      ageConfirmedAt: true,
      consentAt: true,
      organisationId: true,
      ageRule: true,
      guardianSharingConsentAt: true,
      organisation: { select: { name: true } },
    },
  });
}

/**
 * Give someone who signed in by themselves a place in the project: a
 * LEARNER membership, but only when they hold no role in it at all (see
 * needsLearnerMembership). Staff stay staff, and nothing they hold is
 * removed. The roles are read through getProjectMemberships, which grants
 * an ADMIN_EMAILS address its roles first. A failed read fails the call,
 * so the store tries again rather than guessing that there are none.
 *
 * Release 3 (D79): only once the profile step is done. Before that it
 * grants nothing and answers "profile-incomplete" — answered, never thrown:
 * a page from before Release 3 tries a thrown call again. The store then
 * loads, moves and saves nothing (the next full page load goes to the
 * profile step). Whatever R3_PROFILE_GATE says: with the gate off, people
 * without a complete profile browse, and nothing of theirs is saved.
 *
 * Someone given LEARNER here after the profile step (a person "Removed"
 * who comes back, Q29) gets the profile step's organisation rule first
 * (releaseIfCountryElsewhere, spec 5.4 (c)): an organisation a partner
 * admin set is released when the country they gave is another
 * organisation's.
 */
export async function ensureLearnerMembership(): Promise<true | "profile-incomplete"> {
  const user = await requireLearner();
  const profile = await ownProfile(user.id);
  if (!isProfileComplete(user, profile, profileRules())) return "profile-incomplete";
  const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
  if (
    needsLearnerMembership(roles, {
      bootstrapAdmin: isBootstrapAdmin(user.email),
    })
  ) {
    await prisma.$transaction((tx) => releaseIfCountryElsewhere(tx, user.id, { actorId: user.id }));
    // Two tabs loading at once can both get here; the upsert (and its
    // unique-constraint guard) makes the second one a no-op.
    await ensureProjectRoles(user.id, PROJECT, ["LEARNER"]);
  }
  return true;
}

/**
 * Global learner state: Comp Card, badges, per-course enrollment summaries.
 *
 * Release 3: refused (thrown) until the profile step is done (D79). A page
 * from before Release 3 calls this whatever ensureLearnerMembership
 * answered; the throw makes that a failed load, which it gives up on
 * before it reads the browser's guest store, so nothing moves into an
 * account that hasn't accepted the Terms.
 *
 * The card says whether it is shared (D80: only with sharedAt, and with the
 * organisation the learner belongs to now), since when and with whom, and,
 * for pages from before Release 3, the same as their privacy value. Every
 * field of the card is optional to the store (a too-long one is held back).
 */
export async function loadLearnerGlobal() {
  const user = await requireLearner();
  const profile = await ownProfile(user.id);
  if (!isProfileComplete(user, profile, profileRules())) {
    throw new Error("The profile step isn't done; nothing of the learner's is loaded yet");
  }
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
  const sharing = compCard ? effectiveSharing(compCard, profile?.organisationId ?? null) : "onlyMe";
  const shared = sharing === "facilitators";
  return {
    compCard: compCard
      ? {
          wentWell: compCard.wentWell,
          difficult: compCard.difficult,
          improve: compCard.improve,
          behaviour: compCard.behaviour,
          confidence: compCard.confidence,
          sharing,
          sharedAt: shared ? (compCard.sharedAt?.toISOString() ?? null) : null,
          organisationName: shared ? (profile?.organisation?.name ?? null) : null,
          // What a page from before Release 3 reads (its privacy choice).
          privacy: shared ? ("facilitator" as const) : ("self" as const),
          updatedAt: compCard.updatedAt.toISOString(),
        }
      : null,
    badges: badges.map((b) => b.badge.slug),
    enrollments: enrollments.map((e) => ({
      slug: e.course.slug,
      // Standard lessons and the course's own.
      stagesCompleted: completedLessonIds(e).length,
      completed: !!e.completedAt,
      // Anything saved at all: a rating or an own reflection alone counts.
      // A guest's course moves only into a course with none (D69, D79).
      hasProgress: enrolmentHasProgress(e),
    })),
  };
}

/**
 * A single course's progress, with display labels resolved from the CMS;
 * null when there is no such course or the learner isn't enrolled in it.
 * The title and the scenario's choice texts are read in the language the
 * learner gets the course in (learnerContentLocale, D90, spec 9.3): English
 * on a German or Greek page until that language is switched on for the
 * course, as the player shows it. `courseLocale` says which, so the Comp
 * Card can mark them.
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

  // Resolve scenario choice labels + course title from the CMS, in the
  // language the learner reads the course in.
  const courseLocale = await learnerContentLocale(PROJECT, slug, locale);
  const content = await getCourse(PROJECT, slug, courseLocale);
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
    courseLocale,
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
  slug: string;
  badgeId: string | null;
  meta: unknown;
  status: string;
  publishedAt: Date | null;
}

type Reader = Pick<Prisma.TransactionClient, "course" | "lesson">;

/**
 * A save's merge into the enrolment as read under its lock (null: none
 * yet), given what completing the course takes (see saveProgress). It may
 * be called twice, the second time with a row another tab made meanwhile.
 */
type MergeWith = (row: EnrollmentProgress | null, completion: CompletionRule | null) => MergeResult;

/**
 * What completing `course` takes (D118): every lesson the learner's player
 * gives it. For a course created here, Release 2's lesson plan
 * (lessonPlanOf, D64): its lessons in order, less hidden ones and ones with
 * nothing to show (`unseen`, not needed: a finished one still counts). For
 * a built-in course, its seven standard lessons. Ids as the players spell
 * them (completedLessonIds). None for a course left with nothing to show,
 * which no save completes.
 *
 * Whatever R2_LEARNER_PLAYER says: under the switch (spec 3.4) learners
 * play a created course as Release 1 did, its standard lessons, and a
 * course whose plan that view doesn't hold (say, only lessons of its own)
 * is completed only once every lesson of the plan is done, as since the
 * integration review's finding 2. A course the view holds whole loses
 * nothing by it: its learners finish the plan's lessons on the way.
 *
 * Read in the save's transaction, after the Course row's lock, which a
 * change of the course's lesson list waits for (store.server.ts lockCourse).
 */
async function lessonsToFinish(
  client: Reader,
  course: Pick<ProgressCourse, "id" | "slug" | "meta">
): Promise<string[]> {
  if (course.meta == null) return lessonPlanOf("bundled", null, [], "en").lessons.map((l) => l.id as string);
  const row = await client.course.findUnique({ where: { id: course.id }, select: { outline: true } });
  const facts = (await loadLessonFacts(client as Prisma.TransactionClient, course.slug)).map(planFacts);
  return lessonPlanOf("cms", row?.outline ?? null, facts, "en").lessons.map((l) => l.id as string);
}

/**
 * May a learner start this course: is it published, or was it once? A
 * course nobody has ever published is a 404 to learners (and an editor
 * on a draft only ever previews it), so a save that would enrol someone
 * in it comes from no page of ours — and an enrolment would freeze the
 * draft's lessons from the cut-off (live-rules.ts). A course unpublished
 * after it was published takes new answers as before (D62.f: a learner
 * mid-session keeps theirs). A built-in course's row is published with no
 * date (course.ts), so the status counts on its own.
 */
const takesLearners = (course: Pick<ProgressCourse, "status" | "publishedAt">) =>
  normaliseStatus(String(course.status ?? "")) === "published" || course.publishedAt != null;

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
 * saves its badge in the same transaction, as an insert that leaves a row
 * already there (the award action, another tab) alone: an upsert there
 * failed the whole save on the unique key when they met. Never a Lesson
 * row is locked (one that may complete the course reads the lessons,
 * lessonsToFinish); not audited
 * (learner saves never were, and audit rows outlive erasure, D62.g).
 *
 * `merge` is handed what completing the course takes (D118): the lessons
 * to finish, for a save that may complete it (`mayComplete`: it carries a
 * completion), else null; and when the enrolment started, a new one now.
 */
async function saveProgress(
  userId: string,
  course: ProgressCourse,
  mayComplete: boolean,
  merge: MergeWith
): Promise<RefusedKey[] | "not-open"> {
  return prisma.$transaction((tx) => progressInTx(tx, userId, course, mayComplete, merge));
}

/**
 * saveProgress's work on the caller's transaction, in its lock order (the
 * Course row, then the enrolment, then the badge): a guest's course added
 * to the account takes the same path (claimGuestWork), which writes the
 * badge itself, last (`badgeLater` is handed the badge to write). `merge`
 * may be called twice, the second time with the row another tab created
 * meanwhile.
 */
async function progressInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  course: ProgressCourse,
  mayComplete: boolean,
  merge: MergeWith,
  badgeLater?: (badgeId: string) => void
): Promise<RefusedKey[] | "not-open"> {
  let badgeId = course.badgeId;
  if (mayComplete && badgeId === null && course.meta !== null) {
    badgeId = await ensureCourseBadge(tx, course.id);
  } else {
    await tx.$queryRaw`SELECT id FROM "Course" WHERE "id" = ${course.id} FOR KEY SHARE`;
  }
  // The lessons a completion needs, read once under the Course row's lock.
  const lessons = mayComplete ? await lessonsToFinish(tx, course) : null;
  const completion = (startedAt: Date): CompletionRule | null => (lessons ? { lessons, startedAt } : null);

  const where = { userId_courseId: { userId, courseId: course.id } };
  const lockRow = async () => {
    await tx.$queryRaw`SELECT id FROM "CourseEnrollment" WHERE "userId" = ${userId} AND "courseId" = ${course.id} FOR UPDATE`;
    return tx.courseEnrollment.findUnique({ where, select: { ...PROGRESS_SELECT, enrolledAt: true } });
  };

  let row = await lockRow();
  if (!row) {
    // Nobody is enrolled in a course no learner could ever open; one
    // already enrolled keeps saving whatever its status (D62.f).
    if (!takesLearners(course)) return "not-open";
    // A new enrolment starts now: a completion that would make it is dated now.
    const fresh = merge(null, completion(new Date()));
    if (!fresh.changed.length) return fresh.refused;
    await tx.courseEnrollment.createMany({ data: [{ userId, courseId: course.id }], skipDuplicates: true });
    row = await lockRow();
    if (!row) throw new Error("The enrolment just created can't be read");
  }

  const { enrolledAt, ...stored } = row;
  const merged = merge(stored, completion(enrolledAt));
  if (merged.changed.length) {
    await tx.courseEnrollment.update({ where, data: columnsOf(merged) });
  }
  if (merged.completedNow && badgeId) {
    if (badgeLater) badgeLater(badgeId);
    else await tx.userBadge.createMany({ data: [{ userId, badgeId }], skipDuplicates: true });
  }
  return merged.refused;
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
 * The patch's completion stands only once every lesson the learner's
 * player gives the course is finished, this patch's lessons included
 * (D118, lessonsToFinish), dated no later than now and no earlier than the
 * enrolment's start; the course's badge is saved with it. Without them the
 * rest of the patch is saved, and the course stays open: the player takes
 * the learner to the lesson still to do when they come back (nextLesson).
 * It is answered as any save, with nothing refused.
 *
 * No role check (D53: staff may play courses), but the profile step must
 * be done (D79: "profile-incomplete", nothing written; see ownProfile).
 * The course's status decides only whether someone not yet enrolled may
 * start it: a course nobody has ever published enrols no one
 * ("unknown-course", as to a learner it doesn't exist); a learner whose
 * course was unpublished mid-session keeps saving, enrolled or not
 * (D62.f).
 */
export async function saveCourseProgressPatch(
  slug: string,
  patch: unknown,
  forUser: string
): Promise<SaveProgressResult> {
  const user = await requireLearner();
  if (!isLearner(user, forUser)) return { ok: false, error: "other-account" };
  if (!isProfileComplete(user, await ownProfile(user.id), profileRules())) return { ok: false, error: "profile-incomplete" };
  if (typeof slug !== "string" || !SLUG.test(slug)) return { ok: false, error: "bad-input" };
  const now = new Date();
  const parsed = parseProgressPatch(patch, now);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const p = parsed.patch;
  // Nothing to save (or all of it refused): the database isn't touched.
  if (!p.completed.length && !p.answers.length && !p.completedAt) return { ok: true, refused: p.refused };

  const course = await prisma.course.findUnique({
    where: { projectId_slug: { projectId: PROJECT, slug } },
    select: { id: true, slug: true, badgeId: true, meta: true, status: true, publishedAt: true },
  });
  if (!course) return { ok: false, error: "unknown-course" };
  // In fill mode, where the account's answers stayed over the guest's, as
  // the merge that was written found them.
  let kept: string[] = [];
  const refused = await saveProgress(user.id, course, p.completedAt !== null, (row, completion) => {
    const merged = mergeIntoEnrollment(row, p, now, completion);
    kept = merged.kept;
    return merged;
  });
  // A course nobody ever published: to a learner, no course at all.
  if (refused === "not-open") return { ok: false, error: "unknown-course" };
  return p.fill ? { ok: true, refused, kept } : { ok: true, refused };
}

/**
 * Release 1's save of a course's whole progress: retired (D118, amending
 * D62.e and D68). It keeps its name and signature, so a page that still
 * calls it by its action id is answered rather than told the action is
 * gone, and writes nothing.
 *
 * It was kept for pages loaded before the Release 2 deploy (31 October,
 * 07:01); the pilot's learners start on 1 December, so none of them has
 * such a page. Nothing in this build calls it: the learner store, POST
 * /api/progress/beacon and "Add it to my account" save through
 * saveCourseProgressPatch and claimGuestWork, under their rules. The store
 * only names it, so that Next goes on building it (kept-actions.test.ts).
 * Without a signed-in learner it fails, as it always did; otherwise it
 * answers nothing, as it always did.
 */
export async function saveCourseProgress(
  slug: string,
  progress: CourseProgressInput,
  forUser: string
): Promise<void> {
  await requireLearner();
  void slug;
  void progress;
  void forUser;
}

/**
 * Save the current user's Comp Card; they must be `forUser` (isLearner).
 * Keeps its name and arguments (D68: pages loaded before Release 3 call it
 * by its id) and now (D80, spec 4.3):
 *   - writes only the fields sent: one the store holds back (too long)
 *     keeps its stored text, and a new card has the others empty;
 *   - ignores `privacy` and anything else: a save never shares the card,
 *     whatever a page from before Release 3 sends (it sends "facilitator");
 *     a new card starts "Only me" (the schema's default);
 *   - refuses a text longer than 2,000 characters only when it is longer
 *     than the stored one (an older, longer text can be saved unchanged),
 *     and then the whole save, with the field named;
 *   - writes nothing before the profile step is done (D79:
 *     "profile-incomplete"; see ownProfile);
 *   - answers, never throws, a refusal: the store doesn't try it again.
 * Pages from before Release 3 ignore the answer. A guest's card is added
 * to the account by claimGuestWork, not here. POST /api/progress/beacon
 * saves a page's card as it goes through this too (D37 as built).
 */
export async function saveCompCard(input: CompCardInput, forUser: string): Promise<SaveCompCardResult> {
  const user = await requireLearner();
  if (!isLearner(user, forUser)) return { ok: false, error: "other-account" };
  if (!isProfileComplete(user, await ownProfile(user.id), profileRules())) return { ok: false, error: "profile-incomplete" };
  const stored = await prisma.compCard.findUnique({
    where: { userId_projectId: { userId: user.id, projectId: PROJECT } },
    select: { wentWell: true, difficult: true, improve: true, behaviour: true },
  });
  const parsed = parseCompCardInput(input, stored);
  if (!parsed.ok) return parsed.field ? { ok: false, error: parsed.error, field: parsed.field } : { ok: false, error: parsed.error };
  const data = parsed.value;
  // Nothing to write: no card is made for it either.
  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.compCard.upsert({
    where: { userId_projectId: { userId: user.id, projectId: PROJECT } },
    create: { userId: user.id, projectId: PROJECT, ...data },
    update: data,
  });
  return { ok: true };
}

/**
 * Who sees the current user's Comp Card (D80, spec 4.3): "onlyMe" or
 * "facilitators" (the facilitators of the learner's organisation). Explicit,
 * never debounced; they must be `forUser` (isLearner).
 *
 * Sharing needs a complete profile with an organisation, and, for a learner
 * invited under the guardian rule, a guardian's permission that covers
 * sharing (§5.6). It records when, with which organisation (the learner's
 * own, now) and under which wording (SHARING_TEXT_VERSION): if sharing is
 * consent-based (Q16), that is the consent. "Only me" takes it back at once,
 * whatever else holds. Either way the card is made if there is none, and
 * the change is logged by the card's id, without the learner's
 * (compcard.sharing_changed; erasure removes these rows).
 */
export async function setCompCardSharing(choice: Sharing, forUser: string): Promise<SetSharingResult> {
  const user = await requireLearner();
  if (!isLearner(user, forUser)) return { ok: false, error: "other-account" };
  if (choice !== "onlyMe" && choice !== "facilitators") return { ok: false, error: "bad-input" };
  const profile = await ownProfile(user.id);
  const organisationId = profile?.organisationId ?? null;
  if (choice === "facilitators") {
    if (!isProfileComplete(user, profile, profileRules())) return { ok: false, error: "profile-incomplete" };
    if (!organisationId) return { ok: false, error: "no-organisation" };
    if (profile?.ageRule === "INVITED_WITH_GUARDIAN_CONSENT" && !profile.guardianSharingConsentAt) {
      return { ok: false, error: "guardian-consent-needed" };
    }
  }
  const sharedAt = choice === "facilitators" ? new Date() : null;
  const sharingData =
    choice === "facilitators"
      ? {
          privacy: "FACILITATOR" as const,
          sharedAt,
          sharedWithOrganisationId: organisationId,
          sharingVersion: SHARING_TEXT_VERSION,
        }
      : { privacy: "SELF" as const, sharedAt: null, sharedWithOrganisationId: null };
  await prisma.$transaction(async (tx) => {
    const card = await tx.compCard.upsert({
      where: { userId_projectId: { userId: user.id, projectId: PROJECT } },
      create: { userId: user.id, projectId: PROJECT, ...sharingData },
      update: sharingData,
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        projectId: PROJECT,
        action: "compcard.sharing_changed",
        entity: "CompCard",
        entityId: card.id,
        metadata: { to: choice, version: SHARING_TEXT_VERSION },
      },
    });
  });
  return {
    ok: true,
    sharing: choice,
    sharedAt: sharedAt?.toISOString() ?? null,
    organisationName: choice === "facilitators" ? (profile?.organisation?.name ?? null) : null,
  };
}

/**
 * Has `userId` earned the badge `badgeId`: completed, as the server holds
 * it, a course whose badge it is (D118)? The save that completes a course
 * writes its badge with it, so this gives nothing that completion hasn't.
 */
async function badgeEarned(
  client: Pick<Prisma.TransactionClient, "courseEnrollment">,
  userId: string,
  badgeId: string
): Promise<boolean> {
  const completed = await client.courseEnrollment.findFirst({
    where: { userId, completedAt: { not: null }, course: { projectId: PROJECT, badgeId } },
    select: { id: true },
  });
  return completed !== null;
}

/**
 * Award a badge to the current user (idempotent); they must be `forUser`
 * (isLearner). Keeps its name and arguments (D68: pages call it by its
 * id). A badge is a course's (D118): it is given only to a learner with a
 * completed enrolment in a course whose badge it is, and otherwise
 * refused ("not-finished"). The save that completes a course writes the
 * badge itself, in the same transaction, so the completion screen's
 * award, sent after that save, finds it given; one that reaches the
 * server first is refused, and the save gives the badge a moment later.
 *
 * A badge with no Badge row is refused rather than answered as
 * if it were saved: the learner would lose the badge on the next reload
 * without anyone knowing (C9). It is answered, not thrown, because a thrown
 * award is tried again as if the connection had dropped, and this one can
 * never succeed (badge-award.ts). Every course's badge has a row: the seed
 * makes the bundled ones, createCourse and its migration the others, and a
 * created course the old code left without one gets it when it is
 * published or finished, or by the next deploy (ensure-course-badge.ts).
 * The row is inserted unless it is there (INSERT … ON CONFLICT DO NOTHING):
 * the save that completes the course writes it at the same moment, and an
 * upsert lost that race on the unique key (P2002).
 *
 * Like the saves, it gives nothing before the profile step is done (D79:
 * "profile-incomplete", answered in the award's own shape, never thrown;
 * see ownProfile), after whose the award is.
 */
export async function awardBadgeAction(
  slug: string,
  forUser: string
): Promise<BadgeAwardResult> {
  const user = await requireLearner();
  if (!isLearner(user, forUser)) return { ok: false, reason: "other-account" };
  if (!isProfileComplete(user, await ownProfile(user.id), profileRules())) return { ok: false, reason: "profile-incomplete" };
  const badge = await prisma.badge.findUnique({
    where: { projectId_slug: { projectId: PROJECT, slug } },
  });
  if (!badge) return { ok: false, reason: "no-badge" };
  if (!(await badgeEarned(prisma, user.id, badge.id))) return { ok: false, reason: "not-finished" };
  await prisma.userBadge.createMany({
    data: [{ userId: user.id, badgeId: badge.id }],
    skipDuplicates: true,
  });
  return { ok: true };
}

/** A Comp Card's columns, as the claim reads and answers them. */
const CLAIM_CARD_SELECT = {
  wentWell: true,
  difficult: true,
  improve: true,
  behaviour: true,
  confidence: true,
  privacy: true,
  sharedAt: true,
  sharedWithOrganisationId: true,
  updatedAt: true,
} as const;

/**
 * "Add it to my account" (D37, D69, D79, D80): the browser's guest work,
 * sent once, added to the signed-in learner's account — who must be
 * `forUser` (isLearner) — part by part, in one transaction, as the account
 * is then (src/lib/guest-claim.ts says what each answer means):
 *
 *   - the course only into an account with no progress in it, through the
 *     same transaction as a save (progressInTx: its completion as a save's,
 *     standing only once the guest finished every lesson of the course and
 *     dated when it is added to an account it creates the enrolment in,
 *     D118; and its badge); an account with progress
 *     in it gets nothing, and is told apart as already holding all of the
 *     guest's ("already": the fill merge, read only, changes nothing and
 *     keeps nothing of its own over it) or not ("kept"); a course nobody
 *     can open is "unavailable" (D62.f: one unpublished after it was
 *     published still is);
 *   - the Comp Card only into no card or a blank one ("blank": no answer,
 *     the confidence untouched) that isn't shared, written as "Only me";
 *     never shares (D80);
 *   - badges as a union, each as the award action gives it: a course's
 *     badge only into an account that has completed that course, the
 *     claim's own course included (D118); refused otherwise, or with no
 *     badge row. A refused badge stays in the browser (storeAfterClaim),
 *     and the page says it couldn't be added.
 *
 * The locks, in this order, so it can't deadlock with a save, the award,
 * the sharing choice or an erasure: the User row (KEY SHARE: an erasure
 * waits for it, or it for the erasure); the Course row (KEY SHARE, or
 * UPDATE when its completion may make the course's badge); the enrolment
 * and then the Comp Card, each inserted unless it is there, then locked,
 * then read, and decided on as read under the lock (another device's
 * first save waits for this, or this for it); the badges, inserted unless
 * there.
 *
 * Nothing is written for another account's session, an incomplete profile,
 * a claim that isn't one, or one with a text too long to add or too big:
 * answered, never thrown, so the browser doesn't send it again. What
 * became of each part is logged as counts, without the learner, the course
 * or a text: whether adding more (filling, a subset rule) is worth building
 * comes from them.
 */
export async function claimGuestWork(claim: unknown, forUser: string): Promise<GuestClaimResult> {
  const user = await requireLearner();
  if (!isLearner(user, forUser)) return claimRefused({ ok: false, error: "other-account" });
  const profile = await ownProfile(user.id);
  if (!isProfileComplete(user, profile, profileRules())) return claimRefused({ ok: false, error: "profile-incomplete" });
  const now = new Date();
  const parsed = parseGuestClaim(claim, now);
  if (!parsed.ok) return claimRefused(parsed);
  const c = parsed.claim;
  const course = c.course
    ? await prisma.course.findUnique({
        where: { projectId_slug: { projectId: PROJECT, slug: c.course.slug } },
        select: { id: true, slug: true, badgeId: true, meta: true, status: true, publishedAt: true },
      })
    : null;
  const organisationId = profile?.organisationId ?? null;

  const result = await prisma.$transaction(
    async (tx) => {
      const held = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE "id" = ${user.id} FOR KEY SHARE`;
      if (!held.length) throw new Error("The signed-in learner's account is gone");
      // The course's badge, when the course moves finished: written with the guest's, last.
      const courseBadges: string[] = [];
      const coursePart: ClaimCourseOutcome | undefined = c.course
        ? course
          ? await claimCourse(tx, user.id, course, c.course.patch, now, (id) => courseBadges.push(id))
          : "unavailable"
        : undefined;
      const cardPart = c.compCard ? await claimCard(tx, user.id, organisationId, c.compCard) : undefined;
      const badges = await claimBadges(tx, user.id, c.badges, courseBadges);
      const accountBadges = await tx.userBadge.findMany({
        where: { userId: user.id },
        select: { badge: { select: { slug: true } } },
      });
      return {
        ok: true as const,
        ...(coursePart ? { course: coursePart } : {}),
        ...(cardPart ? { compCard: cardPart.outcome } : {}),
        ...(cardPart?.card ? { card: cardPart.card } : {}),
        badges,
        accountBadges: accountBadges.map((b) => b.badge.slug),
      };
    },
    { maxWait: 5_000, timeout: 15_000 }
  );
  console.info(
    `[guest-claim] ${JSON.stringify({
      course: result.course ?? "none",
      compCard: result.compCard ?? "none",
      badgesMoved: result.badges.moved.length,
      badgesAlready: result.badges.already.length,
      badgesRefused: result.badges.refused.length,
      unreadable: c.unreadable,
    })}`
  );
  return result;
}

/** A claim refused before anything is written, logged as what it was (no learner, no text). */
function claimRefused<T extends Extract<GuestClaimResult, { ok: false }>>(answer: T): T {
  console.info(
    `[guest-claim] ${JSON.stringify({ refused: answer.error, ...("texts" in answer ? { texts: answer.texts.length } : {}) })}`
  );
  return answer;
}

/** The claim's course: moved into an account with no progress in it, else told apart (see claimGuestWork). */
async function claimCourse(
  tx: Prisma.TransactionClient,
  userId: string,
  course: ProgressCourse,
  patch: ParsedPatch,
  now: Date,
  badgeLater: (badgeId: string) => void
): Promise<ClaimCourseOutcome> {
  let outcome: ClaimCourseOutcome = "moved";
  const refused = await progressInTx(
    tx,
    userId,
    course,
    patch.completedAt !== null,
    (row, completion) => {
      if (row && enrolmentHasProgress(row)) {
        const fill = mergeIntoEnrollment(row, { ...patch, fill: true }, now, completion);
        outcome = fill.changed.length === 0 && fill.kept.length === 0 ? "already" : "kept";
        return { next: row, changed: [], refused: [], completedNow: false, kept: [] };
      }
      outcome = "moved";
      return mergeIntoEnrollment(row, { ...patch, fill: false }, now, completion);
    },
    badgeLater
  );
  return refused === "not-open" ? "unavailable" : outcome;
}

/** The claim's Comp Card: into no card or a blank one not shared, as "Only me" (see claimGuestWork). */
async function claimCard(
  tx: Prisma.TransactionClient,
  userId: string,
  organisationId: string | null,
  card: NonNullable<ParsedClaim["compCard"]>
): Promise<{ outcome: ClaimCardOutcome; card?: ClaimedCard }> {
  const where = { userId_projectId: { userId, projectId: PROJECT } };
  await tx.compCard.createMany({ data: [{ userId, projectId: PROJECT }], skipDuplicates: true });
  await tx.$queryRaw`SELECT id FROM "CompCard" WHERE "userId" = ${userId} AND "projectId" = ${PROJECT} FOR UPDATE`;
  const row = await tx.compCard.findUnique({ where, select: CLAIM_CARD_SELECT });
  if (!row) throw new Error("The Comp Card just made can't be read");
  const answered = (row: Record<CompCardField, string> & { confidence: number; updatedAt: Date | null }): ClaimedCard => ({
    wentWell: row.wentWell,
    difficult: row.difficult,
    improve: row.improve,
    behaviour: row.behaviour,
    confidence: row.confidence,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
  });
  if (COMP_CARD_FIELDS.every((f) => row[f] === card[f]) && row.confidence === card.confidence) {
    return { outcome: "already", card: answered(row) };
  }
  const blank = COMP_CARD_FIELDS.every((f) => !row[f]?.trim()) && row.confidence === COMP_CARD_BLANK_CONFIDENCE;
  if (!blank) return { outcome: "kept" };
  if (effectiveSharing(row, organisationId) === "facilitators") return { outcome: "shared" };
  const moved = await tx.compCard.update({
    where,
    data: {
      wentWell: card.wentWell,
      difficult: card.difficult,
      improve: card.improve,
      behaviour: card.behaviour,
      confidence: card.confidence,
      privacy: "SELF",
    },
    select: CLAIM_CARD_SELECT,
  });
  return { outcome: "moved", card: answered(moved) };
}

/**
 * The claim's badges: a union, each as the award action gives it (a badge
 * the account has earned, badgeEarned), and the badge of the course the
 * claim finished (`courseBadges`), all inserted unless there (see
 * claimGuestWork).
 */
async function claimBadges(
  tx: Prisma.TransactionClient,
  userId: string,
  slugs: readonly string[],
  courseBadges: readonly string[]
): Promise<{ moved: string[]; already: string[]; refused: string[] }> {
  const out = { moved: [] as string[], already: [] as string[], refused: [] as string[] };
  const give = new Set<string>(courseBadges);
  if (slugs.length) {
    const rows = await tx.badge.findMany({ where: { projectId: PROJECT, slug: { in: [...slugs] } }, select: { id: true, slug: true } });
    const held = new Set(
      (await tx.userBadge.findMany({ where: { userId, badgeId: { in: rows.map((r) => r.id) } }, select: { badgeId: true } })).map(
        (r) => r.badgeId
      )
    );
    for (const slug of slugs) {
      const row = rows.find((r) => r.slug === slug);
      if (!row) out.refused.push(slug);
      else if (held.has(row.id)) out.already.push(slug);
      else if (give.has(row.id) || (await badgeEarned(tx, userId, row.id))) {
        give.add(row.id);
        out.moved.push(slug);
      } else out.refused.push(slug);
    }
  }
  for (const badgeId of give) {
    await tx.userBadge.createMany({ data: [{ userId, badgeId }], skipDuplicates: true });
  }
  return out;
}
