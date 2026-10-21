import "server-only";

/**
 * Server-side read queries for dashboards. Plain async functions called
 * from server components (not form actions). All project-scoped. Learner
 * queries are for the *current* user; staff queries take the viewer's scope
 * (src/lib/scope.ts, D74, D75) as their first argument and read nothing for
 * "none", and a learner's Comp Card text leaves the server only when it was
 * shared with the viewer's organisation (comp-card-visibility.ts, D80, D81).
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { getCourse } from "@/lib/cms";
import { readAssessment, scoreAssessment } from "@/lib/assessment-progress";
import { skillClusterOfCourse } from "@/lib/facilitator-access";
import { COURSE_DEFS, type SkillCluster } from "@/data/course";
import {
  courseProgress,
  nextStage,
  overallProgress,
} from "@/lib/course-progress";
import { getLessonPlans } from "@/lib/cms/lesson-plans";
import type { LessonPlan } from "@/lib/cms/sections/learner-path";
import { completedLessonIds } from "@/lib/learner-progress/enrolment-read";
import type { Locale, CourseContent } from "@/lib/cms/types";
import { fallbackOrder, hasText } from "@/lib/cms/text-fallback";
import { canSupportLearners } from "@/lib/permissions";
import {
  cohortsInScope,
  learnerMembershipsInScope,
  organisationsInScope,
  statisticsMembershipsInScope,
  type Scope,
} from "@/lib/scope";
import {
  compCardForViewer,
  hiddenInAnyLanguage,
  viewerOrganisation,
  type SharedCompCard,
} from "@/lib/comp-card-visibility";
import type { Role } from "@prisma/client";

const PROJECT = "seq-elevate";

/** The current user's per-course enrollment summaries (own data). */
export async function getLearnerEnrollments() {
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    const rows = await prisma.courseEnrollment.findMany({
      where: { userId: user.id },
      include: { course: true },
    });
    return rows.map((e) => {
      // The lessons done — standard keys lowercased, then the course's own
      // ("s-…") — so the dashboard checklist can show *which* are done (not
      // just the count) without re-querying. The dashboard counts these
      // against each course's own lessons (CourseSummary.stageKeys), which
      // it already has from the catalogue.
      const stages = completedLessonIds(e);
      return {
        slug: e.course.slug,
        stages,
        stagesCompleted: stages.length,
        completed: !!e.completedAt,
        // When the learner was last in the course (spec 6: the dashboard's
        // hero follows the course they are in).
        updatedAt: e.updatedAt.toISOString(),
      };
    });
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

/**
 * A course's text on a staff screen, with the language it is written in
 * when that isn't the page's, for its lang attribute (WCAG 3.1.2).
 */
export interface CourseTextPart {
  text: string;
  lang?: Locale;
}

export interface FacilitatorLearner {
  id: string;
  name: string;
  email: string;
  progressPct: number;
  completed: boolean;
  needsAttention: boolean;
  /**
   * The choice the learner made in the applied scenario, then the
   * follow-up choice if they made one, in the course's words; null before
   * a choice. A course created in the CMS reads each choice in the page's
   * language, else English, else the first language written (pickText), so
   * a part's `lang` says when it isn't the page's.
   */
  scenario: CourseTextPart[] | null;
  /**
   * The learner's Comp Card as far as it is shared with this viewer's
   * organisation (compCardForViewer); null when nothing is: no card, an
   * unshared card and a card shared elsewhere look the same.
   */
  compCard: SharedCompCard | null;
  /** Marked as a test account by an ADMIN (D85). */
  testAccount: boolean;
  /** Held a staff role in the project before (StaffHistory, D84). */
  formerStaff: boolean;
  /** In-video quiz engagement (questions answered / answered correctly). */
  videoAnswered: number;
  videoCorrect: number;
  /** Where the learner is right now. */
  currentCourse: string | null;
  currentStage: string | null; // lesson id, or "complete"; null: none (no enrolment, or a course with no lessons left)
  /**
   * The current lesson's step name (D58) in a course created in the CMS;
   * null for a bundled course's lesson (its standard name, tStage) or
   * "complete".
   */
  currentStageLabel: string | null;
  /**
   * The language of currentStageLabel when it isn't the page's (a lesson
   * of the course's own named only in another), for its lang attribute
   * (WCAG 3.1.2). Absent otherwise.
   */
  currentStageLabelLang?: Locale;
  /**
   * The skill cluster of that course, which a validation starts on; null
   * when its skill area names none (skillClusterOfCourse) or there's no
   * course.
   */
  currentCluster: SkillCluster | null;
  lastActiveAt: string | null; // ISO
  /**
   * Active time on task (seconds): total + per lesson id. The total holds
   * time in every lesson, the course's own included.
   */
  secondsTotal: number;
  secondsByStage: Record<string, number>;
  /** Quiz performance across the learner's courses. */
  assessmentCorrect: number;
  assessmentTotal: number;
  simulationCorrect: number;
  simulationTotal: number;
}

/**
 * The learners in the viewer's scope, for the facilitator workspace: null
 * for no scope (read nothing) and for someone who doesn't support learners;
 * [] when the read fails. The roster keeps D53's rule (learnerMembershipWhere):
 * staff who still hold the LEARNER role an older release gave them aren't
 * listed, and a note or validation about them would be refused anyway
 * (canRecordForLearner). Former staff and marked test accounts who are
 * learners now are listed, with a label (spec 7.4).
 */
export async function getProjectLearners(
  scope: Scope,
  locale: Locale
): Promise<FacilitatorLearner[] | null> {
  if (scope.kind === "none") return null;
  const roles = await getViewerRoles();
  if (!canSupportLearners(roles)) return null;

  try {
    return await loadLearners(scope, roles, locale);
  } catch {
    return [];
  }
}

/** The Comp Card fields a shared card shows: text, confidence, and whether and how it is shared. */
const CARD_SELECT = {
  wentWell: true,
  difficult: true,
  improve: true,
  behaviour: true,
  confidence: true,
  privacy: true,
  sharedAt: true,
  sharedWithOrganisationId: true,
} as const;

/**
 * What the roster reads of each learner: never a reflection or the
 * answers kept in `responses` (they are the learner's own), and Comp Cards
 * only as `cards` says.
 */
function rosterSelect(cards: { where: { projectId: string; privacy: "FACILITATOR"; sharedAt: { not: null }; sharedWithOrganisationId: string }; select: typeof CARD_SELECT } | false) {
  return {
    user: {
      select: {
        id: true,
        name: true,
        email: true,
        enrollments: {
          select: {
            course: { select: { slug: true, cluster: true, meta: true } },
            stagesCompleted: true,
            sectionsCompleted: true,
            completedAt: true,
            updatedAt: true,
            scenarioRoot: true,
            scenarioFollowup: true,
            simulationCorrect: true,
            assessment: true,
          },
        },
        compCards: cards,
        profiles: { where: { projectId: PROJECT }, select: { organisationId: true, testAccountAt: true } },
        staffHistory: { where: { projectId: PROJECT }, select: { firstAt: true } },
      },
    },
  } as const;
}

async function loadLearners(
  scope: Scope,
  roles: readonly Role[],
  locale: Locale
): Promise<FacilitatorLearner[]> {
  // The first of two filters on Comp Cards: the database is asked only for
  // cards shared with the viewer's organisation, and for none at all when
  // the viewer has no organisation (a SENIC admin). compCardForViewer below
  // is the second, against each learner's current organisation.
  const viewerOrg = viewerOrganisation(scope);
  const memberships = await prisma.membership.findMany({
    where: learnerMembershipsInScope(scope),
    select: rosterSelect(
      viewerOrg
        ? {
            where: {
              projectId: PROJECT,
              privacy: "FACILITATOR",
              sharedAt: { not: null },
              sharedWithOrganisationId: viewerOrg,
            },
            select: CARD_SELECT,
          }
        : false
    ),
    orderBy: { createdAt: "asc" },
  });
  // A field the Comp Card template hides in any language stays out of a
  // shared card. Read only when a card can be shown; a failed read fails
  // the roster (the caller shows none) rather than show hidden fields.
  const hidden = viewerOrg
    ? hiddenInAnyLanguage(
        (await prisma.project.findUnique({ where: { id: PROJECT }, select: { compCardTemplate: true } }))
          ?.compCardTemplate
      )
    : new Set<never>();

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

  // The stored choices of the applied scenarios learners answered in
  // courses created in the CMS, for the language each is written in (a
  // bundled course's are in every language).
  const storedChoices = await storedScenarioChoices(
    memberships.flatMap((m) => {
      const ev = m.user.enrollments.find((e) => e.scenarioRoot);
      return ev && !isBundled(ev.course.slug) ? [ev.course.slug] : [];
    })
  );

  const labelFor = (
    courseSlug: string,
    root: string | null,
    followup: string | null
  ): CourseTextPart[] | null => {
    if (!root) return null;
    const scenario = contentBySlug
      .get(courseSlug)
      ?.stages.find((s) => s.key === "scenario")?.scenario;
    const r = scenario?.choices.find((c) => c.id === root);
    if (!r) return null;
    const storedRoot = choiceById(storedChoices.get(courseSlug), root);
    const parts: CourseTextPart[] = [{ text: r.text, ...textLang(storedRoot?.text, locale) }];
    const f = r.followups?.find((x) => x.id === followup);
    if (f) {
      parts.push({ text: f.text, ...textLang(choiceById(storedRoot?.followups, f.id)?.text, locale) });
    }
    return parts;
  };

  // Each course's own lessons, as learners get them (D64): a course created
  // in the CMS by its lesson plan — its own lessons included, in its order,
  // with the finished lessons it no longer shows still counted — a bundled
  // one by its seven stages. Plans that can't be read leave each course
  // counted by the stages it shows, as before Release 2. A course that no
  // longer resolves counts as the full seven (courseStageKeys' default).
  const plans = await lessonPlansOrNull(locale);
  const planOf = (slug: string) => plans?.get(slug);
  const stageKeysOf = (slug: string) =>
    planOf(slug)?.lessons.map((l) => l.id) ??
    contentBySlug.get(slug)?.stages.map((s) => s.key);
  const unseenOf = (slug: string) => planOf(slug)?.unseen ?? [];

  return memberships.map((m): FacilitatorLearner => {
    const u = m.user;
    const enr = u.enrollments;
    const { pct: progressPct } = overallProgress(
      enr.map((e) =>
        courseProgress(
          stageKeysOf(e.course.slug),
          completedLessonIds(e),
          !!e.completedAt,
          unseenOf(e.course.slug)
        )
      )
    );
    const completed = enr.length > 0 && enr.every((e) => !!e.completedAt);
    const profile = u.profiles[0] ?? null;
    const compCard = compCardForViewer(
      (u.compCards ?? [])[0] ?? null,
      profile?.organisationId ?? null,
      { scope, roles },
      hidden
    );
    const ev = enr.find((e) => e.scenarioRoot);
    const video = videoByUser.get(u.id) ?? { answered: 0, correct: 0 };
    const time = timeByUser.get(u.id) ?? { total: 0, byStage: {} };

    // Current position: the most recently updated enrollment, and the next
    // stage in it (or "complete").
    const recent = [...enr].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    )[0];
    let currentStage: string | null = null;
    let currentStageLabel: string | null = null;
    let currentStageLabelLang: Locale | undefined;
    let currentCourse: string | null = null;
    let currentCluster: SkillCluster | null = null;
    let lastActiveAt: string | null = null;
    if (recent) {
      lastActiveAt = recent.updatedAt.toISOString();
      currentCourse =
        contentBySlug.get(recent.course.slug)?.title ?? recent.course.slug;
      currentCluster = skillClusterOfCourse(recent.course);
      const next = nextStage(
        stageKeysOf(recent.course.slug),
        completedLessonIds(recent),
        !!recent.completedAt
      );
      // A course with no lessons left that they never completed: on no
      // lesson ("—"), never "Completed all".
      currentStage = next === "empty" ? null : next;
      const current = planOf(recent.course.slug)?.lessons.find(
        (l) => l.id === currentStage
      );
      currentStageLabel = current?.label ?? null;
      currentStageLabelLang = current?.lang;
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
      compCard,
      testAccount: !!profile?.testAccountAt,
      // On the roster means a learner now (D53), so any history is former.
      formerStaff: u.staffHistory.length > 0,
      videoAnswered: video.answered,
      videoCorrect: video.correct,
      currentCourse,
      currentStage,
      currentStageLabel,
      ...(currentStageLabelLang ? { currentStageLabelLang } : {}),
      currentCluster,
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

/** Is `slug` a course the platform ships (getCourse reads it from the provider, in every language)? */
const isBundled = (slug: string) => Object.prototype.hasOwnProperty.call(COURSE_DEFS, slug);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** A stored scenario choice, as far as the language of its text goes. */
interface StoredChoice {
  id?: unknown;
  text?: unknown;
  followups?: unknown;
}

/** The stored choice with `id` among `choices`, if `choices` is a list that has it. */
function choiceById(choices: unknown, id: string): StoredChoice | undefined {
  if (!Array.isArray(choices)) return undefined;
  return choices.find((c): c is StoredChoice => isRecord(c) && c.id === id);
}

/**
 * `{ lang }` when the text pickText reads for `locale` (the first language
 * with text: `locale`, English, then the others as written) is in another
 * language; nothing when it is `locale`'s, or the stored text can't say.
 */
function textLang(text: unknown, locale: Locale): { lang?: Locale } {
  if (!isRecord(text)) return {};
  const lang = fallbackOrder(text, locale).find((k) => hasText(text[k]));
  return lang && lang !== locale && (["en", "de", "el"] as const).includes(lang as Locale)
    ? { lang: lang as Locale }
    : {};
}

/**
 * The stored choices of the applied scenario of each of `slugs` (courses
 * created in the CMS: Lesson.structure, which db-course.ts resolves), by
 * slug. When they can't be read, none: the choices are then shown without
 * their language, rather than no learner shown.
 */
async function storedScenarioChoices(slugs: string[]): Promise<Map<string, unknown>> {
  const unique = [...new Set(slugs)];
  if (!unique.length) return new Map();
  try {
    const rows = await prisma.lesson.findMany({
      where: { projectId: PROJECT, courseSlug: { in: unique }, stageKey: "scenario" },
      select: { courseSlug: true, structure: true },
    });
    return new Map(
      rows.flatMap((r) =>
        isRecord(r.structure) && r.structure.kind === "scenario" ? [[r.courseSlug, r.structure.choices] as const] : []
      )
    );
  } catch (e) {
    console.error(`[facilitator] couldn't read the scenario texts' languages: ${e instanceof Error ? e.name : "error"}`);
    return new Map();
  }
}

/**
 * The lesson plans of the courses created in the CMS, or null when they
 * can't be read: the caller then counts each course by the stages it shows,
 * as before Release 2, rather than show nothing.
 */
async function lessonPlansOrNull(
  locale: Locale
): Promise<Map<string, LessonPlan> | null> {
  try {
    return await getLessonPlans(PROJECT, locale);
  } catch (err) {
    console.error("Couldn't read the lesson plans; counting the stages shown.", err);
    return null;
  }
}

/**
 * Aggregate counts for the admin dashboard (anonymised), for the viewer's
 * scope: zeros for no scope, without a query. `users` is the Learners
 * figure: the statistics filter without a date (spec 7.4, D83), so staff,
 * anyone who ever held a staff role and marked test accounts are left out.
 * Published courses are counted project-wide (a number, not people).
 */
export async function getAdminCounts(scope: Scope) {
  const none = { users: 0, cohorts: 0, organisations: 0, courses: 0 };
  if (scope.kind === "none") return none;
  try {
    const [users, cohorts, organisations, courses] = await Promise.all([
      prisma.membership.count({ where: statisticsMembershipsInScope(scope, null) }),
      prisma.cohort.count({ where: cohortsInScope(scope) }),
      prisma.organisation.count({ where: organisationsInScope(scope) }),
      prisma.course.count({
        where: { projectId: PROJECT, status: "published" },
      }),
    ]);
    return { users, cohorts, organisations, courses };
  } catch {
    return none;
  }
}

/** The name of the viewer's organisation (organisation scope), or null. */
export async function scopeOrganisationName(scope: Scope): Promise<string | null> {
  if (scope.kind !== "organisation") return null;
  try {
    const org = await prisma.organisation.findFirst({
      where: { AND: [{ id: scope.organisationId }, organisationsInScope(scope)] },
      select: { name: true },
    });
    return org?.name ?? null;
  } catch {
    return null;
  }
}
