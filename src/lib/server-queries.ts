/**
 * Server-side read queries for dashboards. Plain async functions called
 * from server components (not form actions). All project-scoped; learner
 * queries are for the *current* user, staff queries respect RBAC + Comp
 * Card privacy.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { getCourse } from "@/lib/cms";
import { STAGES } from "@/data/course";
import type { Locale, CourseContent } from "@/lib/cms/types";
import type { Role } from "@prisma/client";

const PROJECT = "seq-elevate";
const TOTAL_STAGES = STAGES.length;

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
  const user = await getCurrentUser();
  if (!user) return null;
  const rows = await prisma.courseEnrollment.findMany({
    where: { userId: user.id },
    include: { course: true },
  });
  return rows.map((e) => ({
    slug: e.course.slug,
    stagesCompleted: e.stagesCompleted.length,
    totalStages: TOTAL_STAGES,
    completed: !!e.completedAt,
  }));
}

/** The current user's roles in the project (for view gating). */
export async function getViewerRoles(): Promise<Role[]> {
  const memberships = await getProjectMemberships(PROJECT);
  return memberships.map((m) => m.role);
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

  return memberships.map((m): FacilitatorLearner => {
    const u = m.user;
    const enr = u.enrollments;
    const totalStages = enr.length * TOTAL_STAGES;
    const done = enr.reduce((a, e) => a + e.stagesCompleted.length, 0);
    const progressPct = totalStages
      ? Math.round((done / totalStages) * 100)
      : 0;
    const completed = enr.length > 0 && enr.every((e) => !!e.completedAt);
    const card = u.compCards[0] ?? null;
    const ev = enr.find((e) => e.scenarioRoot);
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
    };
  });
}

/** Aggregate counts for the admin dashboard (anonymised). */
export async function getAdminCounts() {
  const [users, cohorts, organisations, courses] = await Promise.all([
    prisma.membership.count({ where: { projectId: PROJECT, role: "LEARNER" } }),
    prisma.cohort.count({ where: { projectId: PROJECT } }),
    prisma.organisation.count({ where: { projectId: PROJECT } }),
    prisma.course.count({ where: { projectId: PROJECT, status: "published" } }),
  ]);
  return { users, cohorts, organisations, courses };
}
