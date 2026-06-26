import "server-only";

/**
 * Computes the analytics dashboard from REAL captured data:
 *   - LEARNER memberships + CourseEnrollment (funnel, position, progress,
 *     assessment scoring against the CMS answers),
 *   - `stage.time` AuditLog events (time per stage / total),
 *   - `course.opened` AuditLog events (activity over time + when-they-open),
 *   - UserBadge (badges earned).
 * Returns null when no learner has started yet, so the page can fall back to
 * the representative sample for the showcase. Same AnalyticsData shape as the
 * sample, so the dashboard renders either identically.
 */

import { prisma } from "@/lib/prisma";
import { getCourse } from "@/lib/cms";
import { STAGES } from "@/data/course";
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
  locale: Locale
): Promise<AnalyticsData | null> {
  try {
    const memberships = await prisma.membership.findMany({
      where: { projectId: PROJECT, role: "LEARNER" },
      include: {
        user: { include: { enrollments: { include: { course: true } } } },
        cohort: true,
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
        },
        select: { actorId: true, action: true, metadata: true, createdAt: true },
      }),
      prisma.userBadge.count({ where: { userId: { in: ids } } }),
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

    // Aggregate events.
    const timeByUser = new Map<string, number[]>(); // userId -> [7] seconds
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
        }
      } else if (ev.action === "course.opened") {
        opens.push(ev.createdAt);
      }
    }

    const now = Date.now();
    const learners: LearnerRow[] = started.map((m) => {
      const u = m.user;
      const recent = [...u.enrollments].sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
      )[0];
      const completed = !!recent.completedAt;
      const reached = completed ? 7 : recent.stagesCompleted.length;
      const secondsByStage = timeByUser.get(u.id) ?? new Array(7).fill(0);
      const secondsTotal = secondsByStage.reduce((a, b) => a + b, 0);
      const lastMs = Math.max(
        recent.updatedAt.getTime(),
        lastEventMs.get(u.id) ?? 0
      );
      const lastActiveHoursAgo = Math.max(0, Math.round((now - lastMs) / 3_600_000));

      const qs =
        contentBySlug.get(recent.course.slug)?.stages.find(
          (s) => s.key === "assessment"
        )?.assessment?.questions ?? [];
      const ans = (recent.assessment as Record<string, string | null>) ?? {};
      let assessmentCorrect = 0;
      let assessmentTotal = 0;
      qs.forEach((q, idx) => {
        const a = ans[`q${idx + 1}`];
        if (a != null) {
          assessmentTotal += 1;
          if (a === q.correctOptionId) assessmentCorrect += 1;
        }
      });

      const status: LearnerRow["status"] = completed
        ? "done"
        : lastActiveHoursAgo > 72
          ? "stuck"
          : "active";

      return {
        id: u.id,
        name: u.name ?? u.email ?? "Learner",
        cohort: m.cohort?.name ?? "—",
        currentStageIndex: completed ? 7 : Math.min(reached, 6),
        completed,
        progressPct: Math.round((Math.min(reached, 7) / 7) * 100),
        secondsByStage,
        secondsTotal,
        lastActiveHoursAgo,
        assessmentCorrect,
        assessmentTotal,
        status,
      };
    });

    const N = learners.length;
    const reachedVal = (l: LearnerRow) =>
      l.completed ? 7 : l.currentStageIndex;

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
  } catch {
    return null;
  }
}
