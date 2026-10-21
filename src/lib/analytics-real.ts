import "server-only";

/**
 * Computes the analytics dashboard from REAL captured data, for the
 * viewer's scope (src/lib/scope.ts, D74: an ADMIN the project, partner
 * staff their organisation, no scope nothing):
 *   - learners' memberships + CourseEnrollment (funnel, position, progress,
 *     assessment scoring against the CMS answers), by the statistics filter
 *     (statisticsMembershipsInScope, D83): staff who still hold the LEARNER
 *     role an older release gave them, anyone who ever held a staff role
 *     (StaffHistory) and marked test accounts are left out, so their test
 *     runs don't count. Enrolments are selected field by field: never a
 *     reflection or the answers in `responses`,
 *   - `stage.time` AuditLog events (time per stage / total; time in a
 *     course's own lessons is in the total, as secondsOther),
 *   - `course.opened` AuditLog events (activity over time + when-they-open),
 *   - UserBadge (badges earned).
 * Everything counts from `from` (STATS_FROM, stats-from.ts, spec 7.3): only
 * learners who started a course since then, only their enrolments made since
 * then, and only the events and badges recorded since then, so trials before
 * launch don't count. A learner's position, progress and last activity come
 * from what is counted. (A running total, stage.time or video.cue_answered,
 * keeps its first event's time: one started before `from` is left out whole.)
 * Returns null when no learner has started yet (and for no scope), so the
 * page can fall back to the representative sample for the showcase, and
 * "unreadable" when the read fails, which is logged without learner data:
 * the page then says so, rather than that no one has started (spec 7.3).
 * Same AnalyticsData shape as the sample, so the dashboard renders either
 * identically.
 */

import { prisma } from "@/lib/prisma";
import { getCourse } from "@/lib/cms";
import { readAssessment, scoreAssessment } from "@/lib/assessment-progress";
import { statisticsMembershipsInScope, type Scope } from "@/lib/scope";
import { statsFrom } from "@/lib/stats-from";
import { STAGES } from "@/data/course";
import { courseProgress, nextStage } from "@/lib/course-progress";
import { getLessonPlans } from "@/lib/cms/lesson-plans";
import { completedLessonIds } from "@/lib/learner-progress/enrolment-read";
import type { Locale } from "@/lib/cms/types";
import {
  STAGE_LABELS,
  HEATMAP_BUCKETS,
  HEATMAP_DAYS,
  type AnalyticsData,
  type LearnerRow,
} from "./analytics-sample";

const PROJECT = "seq-elevate";

export async function buildRealAnalytics(
  scope: Scope,
  locale: Locale,
  /** The moment the statistics count from; null counts everything (STATS_FROM=off). */
  from: Date | null = statsFrom()
): Promise<AnalyticsData | null | "unreadable"> {
  if (scope.kind === "none") return null;
  try {
    const memberships = await prisma.membership.findMany({
      where: statisticsMembershipsInScope(scope, from),
      select: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            enrollments: {
              ...(from ? { where: { enrolledAt: { gte: from } } } : {}),
              select: {
                course: { select: { slug: true } },
                stagesCompleted: true,
                sectionsCompleted: true,
                completedAt: true,
                updatedAt: true,
                assessment: true,
              },
            },
          },
        },
        cohort: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // The cohort = learners who have actually started (≥1 enrollment).
    const started = memberships.filter((m) => m.user.enrollments.length > 0);
    if (started.length === 0) return null;
    const ids = started.map((m) => m.user.id);

    const [events, badges] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          projectId: PROJECT,
          actorId: { in: ids },
          action: { in: ["stage.time", "video.cue_answered", "course.opened"] },
          ...(from ? { createdAt: { gte: from } } : {}),
        },
        select: { actorId: true, action: true, metadata: true, createdAt: true },
      }),
      prisma.userBadge.count({
        where: { userId: { in: ids }, ...(from ? { awardedAt: { gte: from } } : {}) },
      }),
    ]);

    // Resolve CMS content once per slug (for assessment scoring).
    const slugs = new Set<string>();
    for (const m of started)
      for (const e of m.user.enrollments) slugs.add(e.course.slug);
    const contentBySlug = new Map<string, Awaited<ReturnType<typeof getCourse>>>();
    for (const slug of slugs) {
      const c = await getCourse(PROJECT, slug, locale as Locale);
      if (c) contentBySlug.set(slug, c);
    }
    // The lessons learners get in each course created in the CMS (D64),
    // which progress and position are counted against. Plans that can't be
    // read leave each course counted by the stages it shows, as before.
    let plans: Awaited<ReturnType<typeof getLessonPlans>> | null = null;
    try {
      plans = await getLessonPlans(PROJECT, locale);
    } catch (err) {
      console.error("Couldn't read the lesson plans; counting the stages shown.", err);
    }

    // Aggregate events.
    const timeByUser = new Map<string, number[]>(); // userId -> [7] seconds
    // Time in lessons not on the seven steps: a course's own (D70: one
    // figure, statistics per lesson come after launch).
    const otherByUser = new Map<string, number>();
    const lastEventMs = new Map<string, number>();
    const opens: Date[] = [];
    for (const ev of events) {
      if (!ev.actorId) continue;
      const ms = ev.createdAt.getTime();
      lastEventMs.set(ev.actorId, Math.max(lastEventMs.get(ev.actorId) ?? 0, ms));
      if (ev.action === "stage.time") {
        const md = ev.metadata as { stage?: string; seconds?: number } | null;
        const idx = md?.stage ? STAGES.indexOf(md.stage as (typeof STAGES)[number]) : -1;
        if (idx >= 0) {
          const arr = timeByUser.get(ev.actorId) ?? new Array(7).fill(0);
          arr[idx] += md?.seconds ?? 0;
          timeByUser.set(ev.actorId, arr);
        } else {
          // As the facilitator's view counts it: every event in the total.
          otherByUser.set(ev.actorId, (otherByUser.get(ev.actorId) ?? 0) + (md?.seconds ?? 0));
        }
      } else if (ev.action === "course.opened") {
        opens.push(ev.createdAt);
      }
    }

    const now = Date.now();
    // How far along the seven steps each learner got, for the funnel.
    const furthestStep = new Map<string, number>();
    const learners: LearnerRow[] = started.map((m) => {
      const u = m.user;
      const recent = [...u.enrollments].sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
      )[0];
      const completed = !!recent.completedAt;
      // Counted against the course's own lessons: a course created in the
      // CMS by its lesson plan (its own lessons included; a finished lesson
      // it no longer shows still counts), else by the stages it shows; a
      // course that no longer resolves counts as the full seven.
      const plan = plans?.get(recent.course.slug);
      const ownKeys =
        plan?.lessons.map((l) => l.id) ??
        contentBySlug.get(recent.course.slug)?.stages.map((s) => s.key);
      const done = completedLessonIds(recent);
      const progress = courseProgress(ownKeys, done, completed, plan?.unseen ?? []);
      // Where they are, on the seven-step funnel: the course's next lesson
      // (-1, beside the funnel, for one of the course's own — or for a
      // course with no lessons left, "empty", which only completing it
      // would take past the last step).
      const next = nextStage(ownKeys, done, completed);
      const currentStageIndex =
        next === "complete" ? 7 : (STAGES as readonly string[]).indexOf(next);
      // The funnel's furthest step: the next lesson's, or a step finished
      // further on — the learner on a lesson of the course's own (-1) still
      // reached the steps they finished, as does one whose course puts a
      // step they finished after the next.
      furthestStep.set(
        u.id,
        Math.max(
          currentStageIndex,
          ...done.map((k) => (STAGES as readonly string[]).indexOf(k))
        )
      );
      const secondsByStage = timeByUser.get(u.id) ?? new Array(7).fill(0);
      const secondsOther = otherByUser.get(u.id) ?? 0;
      const secondsTotal = secondsByStage.reduce((a, b) => a + b, 0) + secondsOther;
      const lastMs = Math.max(
        recent.updatedAt.getTime(),
        lastEventMs.get(u.id) ?? 0
      );
      const lastActiveHoursAgo = Math.max(0, Math.round((now - lastMs) / 3_600_000));

      const qs =
        contentBySlug.get(recent.course.slug)?.stages.find(
          (s) => s.key === "assessment"
        )?.assessment?.questions ?? [];
      // By question id: a quiz made in the course editor has its own ids,
      // and any number of questions (see assessment-progress.ts).
      const { correct: assessmentCorrect, total: assessmentTotal } =
        scoreAssessment(qs, readAssessment(recent.assessment));

      const status: LearnerRow["status"] = completed
        ? "done"
        : lastActiveHoursAgo > 72
          ? "stuck"
          : "active";

      return {
        id: u.id,
        name: u.name ?? u.email ?? "Learner",
        cohort: m.cohort?.name ?? "—",
        currentStageIndex,
        completed,
        progressPct: progress.pct,
        secondsByStage,
        secondsOther,
        secondsTotal,
        lastActiveHoursAgo,
        assessmentCorrect,
        assessmentTotal,
        status,
      };
    });

    const N = learners.length;
    const reachedVal = (l: LearnerRow) =>
      l.completed ? 7 : (furthestStep.get(l.id) ?? l.currentStageIndex);

    const funnel: { label: string; reached: number; pct: number }[] =
      STAGE_LABELS.map((label, idx) => {
        const reached = learners.filter((l) => reachedVal(l) >= idx).length;
        return { label, reached, pct: Math.round((reached / N) * 100) };
      });
    const completedCount = learners.filter((l) => l.completed).length;
    funnel.push({
      label: "Completed",
      reached: completedCount,
      pct: Math.round((completedCount / N) * 100),
    });
    // Learners on a lesson of their course's own: on none of the steps.
    const onOther = learners.filter((l) => !l.completed && l.currentStageIndex < 0).length;
    const funnelOther = { reached: onOther, pct: Math.round((onOther / N) * 100) };

    let stuckStageIndex = 0;
    let maxDrop = -1;
    for (let i = 1; i < funnel.length; i++) {
      const drop = funnel[i - 1].reached - funnel[i].reached;
      if (drop > maxDrop) {
        maxDrop = drop;
        stuckStageIndex = i;
      }
    }

    const timePerStage = STAGE_LABELS.map((label, idx) => {
      const vals = learners
        .map((l) => l.secondsByStage[idx])
        .filter((v) => v > 0);
      const avg = vals.length
        ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
        : 0;
      return { label, avgSeconds: avg };
    });
    const slowestStageIndex = timePerStage.reduce(
      (best, cur, idx, arr) =>
        cur.avgSeconds > arr[best].avgSeconds ? idx : best,
      0
    );

    // Activity over the last 14 days + when-they-open heatmap.
    const dayOpens = new Array(14).fill(0);
    const heatmap: number[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 6 }, () => 0)
    );
    for (const d of opens) {
      const dayBack = Math.floor((now - d.getTime()) / 86_400_000);
      if (dayBack >= 0 && dayBack < 14) dayOpens[13 - dayBack] += 1;
      const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
      const bucket = Math.min(5, Math.floor(d.getUTCHours() / 4));
      heatmap[dow][bucket] += 1;
    }
    const activityByDay = dayOpens.map((o, i) => ({
      label: i === 13 ? "today" : `${13 - i}d`,
      opens: o,
    }));

    let peakDay = 0;
    let peakBucket = 0;
    let peakVal = -1;
    for (let d = 0; d < 7; d++)
      for (let b = 0; b < 6; b++)
        if (heatmap[d][b] > peakVal) {
          peakVal = heatmap[d][b];
          peakDay = d;
          peakBucket = b;
        }
    const peakLabel =
      peakVal > 0
        ? `${HEATMAP_DAYS[peakDay]} ${HEATMAP_BUCKETS[peakBucket]}h`
        : "—";

    return {
      cohortSize: N,
      kpis: {
        learners: N,
        activeThisWeek: learners.filter((l) => l.lastActiveHoursAgo <= 168)
          .length,
        completed: completedCount,
        avgCompletionPct: Math.round(
          learners.reduce((a, l) => a + l.progressPct, 0) / N
        ),
        avgMinutes: Math.round(
          learners.reduce((a, l) => a + l.secondsTotal, 0) / N / 60
        ),
        badges,
      },
      funnel,
      funnelOther,
      timePerStage,
      stuckStageIndex,
      slowestStageIndex,
      activityByDay,
      heatmap,
      peakLabel,
      learners,
      stuckLearners: learners
        .filter((l) => l.status === "stuck")
        .sort((a, b) => b.lastActiveHoursAgo - a.lastActiveHoursAgo),
    };
  } catch (e) {
    // Said in the log and on the page, so a broken filter doesn't pass for
    // "no statistics yet"; how it failed, never a learner's data.
    console.error(`[statistics] failed: ${e instanceof Error ? e.name : "error"}`);
    return "unreadable";
  }
}
