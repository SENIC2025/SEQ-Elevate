"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useDemoState } from "@/store/demo-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SKILL_CLUSTERS, STAGES } from "@/data/course";
import type { CourseSummary } from "@/lib/cms/types";
import {
  MessageCircle,
  Shield,
  Users as UsersIcon,
  Lightbulb,
  Repeat,
  Star,
  Rocket,
  Trophy,
  PlayCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Award,
  FileText,
  Lock,
} from "lucide-react";

const CLUSTER_ICONS: Record<string, typeof MessageCircle> = {
  communicationEi: MessageCircle,
  resilience: Shield,
  teamwork: UsersIcon,
  problemSolving: Lightbulb,
  adaptability: Repeat,
  leadership: Star,
  initiative: Rocket,
};

export interface EnrollmentSummary {
  slug: string;
  /** Lowercased stage keys completed in this course (real DB data). */
  stages: string[];
  stagesCompleted: number;
  totalStages: number;
  completed: boolean;
}

export function LearnerDashboard({
  courses,
  enrollments,
}: {
  courses: CourseSummary[];
  enrollments?: EnrollmentSummary[] | null;
}) {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const tClusters = useTranslations("skillClusters");

  const { state } = useDemoState();
  const totalStages = STAGES.length;

  const published = courses.filter((c) => !c.comingSoon);
  const hero = published[0];
  const activeClusters = new Set(published.map((c) => c.cluster));

  // Per-course status: real enrollments for authed users, demo-state for guests.
  const enrollMap = new Map((enrollments ?? []).map((e) => [e.slug, e]));
  const courseStatus = (slug: string) => {
    if (enrollments) {
      const e = enrollMap.get(slug);
      if (!e) return { stagesDone: 0, completed: false, inProgress: false };
      return {
        stagesDone: e.stagesCompleted,
        completed: e.completed,
        inProgress: e.stagesCompleted > 0 && !e.completed,
      };
    }
    const isActive =
      state.course.courseSlug === slug ||
      (!state.course.courseSlug && slug === hero?.slug);
    if (isActive) {
      const sd = state.course.stagesCompleted.length;
      return {
        stagesDone: sd,
        completed: !!state.course.completedAt,
        inProgress: sd > 0 && !state.course.completedAt,
      };
    }
    return { stagesDone: 0, completed: false, inProgress: false };
  };

  const heroStatus = hero
    ? courseStatus(hero.slug)
    : { stagesDone: 0, completed: false, inProgress: false };
  const stagesDone = heroStatus.stagesDone;
  const progressPct = Math.round((stagesDone / totalStages) * 100);
  const isInProgress = heroStatus.inProgress;
  const isCompleted = heroStatus.completed;

  // Which specific stages of the hero course are done, for the journey
  // checklist: real per-course DB data for authed users, demo-state for guests.
  const heroStages: string[] = enrollments
    ? (hero ? (enrollMap.get(hero.slug)?.stages ?? []) : [])
    : state.course.stagesCompleted;

  // Overall completion across all published courses (the whole programme).
  const overallTotalStages = published.length * totalStages;
  const overallDone = published.reduce(
    (sum, c) => sum + courseStatus(c.slug).stagesDone,
    0
  );
  const overallPct = overallTotalStages
    ? Math.round((overallDone / overallTotalStages) * 100)
    : 0;
  const coursesDone = published.filter((c) => courseStatus(c.slug).completed)
    .length;

  // Badge slug → display info, from the course list.
  const badgeInfo = new Map<string, { name: string; meaning: string }>();
  for (const c of courses) {
    if (c.badgeSlug && c.badgeName) {
      badgeInfo.set(c.badgeSlug, {
        name: c.badgeName,
        meaning: c.badgeMeaning ?? "",
      });
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {t("greeting")}
        </h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {tCommon("demoBannerLine1")}
        </p>
      </div>

      {/* Overall completion across the whole programme */}
      {published.length ? (
        <Card className="mt-3">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <p className="text-sm font-semibold">{t("overallCompletion")}</p>
              <p className="text-xl font-bold text-[var(--accent)] tabular-nums">
                {overallPct}%
              </p>
            </div>
            <Progress value={overallPct} label={`${overallPct}%`} />
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              {t("coursesCompletedOf", {
                done: coursesDone,
                total: published.length,
              })}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Hero mission — first published course */}
      {hero ? (
        <Card className="mt-4 overflow-hidden border-[var(--accent)]/30">
          <CardContent className="p-0">
            <div className="grid sm:grid-cols-[1fr_auto] gap-0">
              <div className="p-6">
                <Badge variant="primary" className="mb-3">
                  {t("currentMission")}
                </Badge>
                <h2 className="text-xl sm:text-2xl font-bold leading-snug">
                  {hero.title}
                </h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {hero.clusterLabel} · {hero.tagline}
                </p>

                {isInProgress ? (
                  <div className="mt-4 max-w-sm">
                    <Progress
                      value={progressPct}
                      label={`${stagesDone}/${totalStages} ${t("yourJourney").toLowerCase()}`}
                    />
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap gap-3">
                  <Link href={`/learner/course/${hero.slug}`}>
                    <Button size="lg">
                      {isCompleted ? (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          {t("completed")}
                        </>
                      ) : isInProgress ? (
                        <>
                          <PlayCircle className="h-4 w-4" />
                          {t("resumeCourse")}
                        </>
                      ) : (
                        <>
                          <PlayCircle className="h-4 w-4" />
                          {t("openCourse")}
                        </>
                      )}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Link href="/learner/comp-card">
                    <Button size="lg" variant="outline">
                      <FileText className="h-4 w-4" />
                      {t("openCompCard")}
                    </Button>
                  </Link>
                </div>
              </div>
              <div className="hidden sm:flex items-center justify-center bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] p-8 text-white min-w-[220px]">
                <div className="text-center">
                  <Clock className="h-8 w-8 mx-auto opacity-80" />
                  <p className="mt-2 text-3xl font-bold">
                    {hero.durationMinutes}
                  </p>
                  <p className="text-xs opacity-80 uppercase tracking-wider">
                    {tCommon("minutes", { count: hero.durationMinutes })}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Course list — proves the dashboard renders from the CMS */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-3">{t("coursesTitle")}</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {courses.map((c) => {
            const Icon = CLUSTER_ICONS[c.cluster] ?? MessageCircle;
            const status = c.comingSoon
              ? null
              : courseStatus(c.slug);
            const inner = (
              <CardContent className="p-4 flex flex-col h-full">
                <div className="flex items-start justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                    <Icon className="h-4 w-4" />
                  </div>
                  {c.comingSoon ? (
                    <Badge variant="muted" className="text-[10px]">
                      <Lock className="h-3 w-3" />
                      {t("comingSoon")}
                    </Badge>
                  ) : status?.completed ? (
                    <Badge variant="success" className="text-[10px]">
                      <CheckCircle2 className="h-3 w-3" />
                      {t("completed")}
                    </Badge>
                  ) : status?.inProgress ? (
                    <Badge variant="accent" className="text-[10px]">
                      {t("inProgress")}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-3 text-sm font-semibold leading-tight">
                  {c.title}
                </p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)] flex-1">
                  {c.clusterLabel} · {c.durationMinutes} min
                </p>
                {!c.comingSoon ? (
                  <span className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent)] font-medium">
                    <PlayCircle className="h-3.5 w-3.5" />
                    {status?.completed
                      ? t("completed")
                      : status?.inProgress
                        ? t("resumeCourse")
                        : t("openCourse")}
                  </span>
                ) : null}
              </CardContent>
            );
            return c.comingSoon ? (
              <Card key={c.slug} className="p-0 opacity-70">
                {inner}
              </Card>
            ) : (
              <Link key={c.slug} href={`/learner/course/${c.slug}`}>
                <Card className="p-0 h-full transition-shadow hover:shadow-md">
                  {inner}
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Skill map + badges + journey */}
      <div className="mt-8 grid lg:grid-cols-[2fr_1fr] gap-6">
        <section>
          <h2 className="text-lg font-semibold mb-1">{t("skillMap")}</h2>
          <p className="text-sm text-[var(--muted-foreground)] mb-4">
            {t("skillMapHint")}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {SKILL_CLUSTERS.map((cluster) => {
              const Icon = CLUSTER_ICONS[cluster] ?? MessageCircle;
              const isActive = activeClusters.has(cluster);
              return (
                <Card
                  key={cluster}
                  className={`p-0 ${isActive ? "border-[var(--primary)]/40" : ""}`}
                >
                  <CardContent className="p-4">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                        isActive
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : "bg-[var(--surface-muted)] text-[var(--muted-foreground)]"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className="mt-3 text-sm font-medium leading-tight">
                      {tClusters(`${cluster}Short`)}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 text-[var(--accent)]">
                          <PlayCircle className="h-3 w-3" />
                          {t("inProgress")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <aside className="space-y-6">
          <section>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Trophy className="h-5 w-5 text-[var(--accent)]" />
              {t("badges")}
            </h2>
            <Card>
              <CardContent className="p-4">
                {state.badges.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {t("badgesNone")}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {state.badges.map((slug) => {
                      const info = badgeInfo.get(slug);
                      return (
                        <div
                          key={slug}
                          className="flex items-center gap-2 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-2"
                        >
                          <Award className="h-5 w-5 text-[var(--accent)]" />
                          <div>
                            <p className="text-xs font-semibold">
                              {info?.name ?? slug}
                            </p>
                            {info?.meaning ? (
                              <p className="text-[10px] text-[var(--muted-foreground)]">
                                {info.meaning}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">{t("yourJourney")}</h2>
            <Card>
              <CardContent className="p-4">
                <Progress
                  value={progressPct}
                  label={`${stagesDone}/${totalStages}`}
                />
                <ul className="mt-3 space-y-1.5">
                  {STAGES.map((stage) => {
                    const done = heroStages.includes(stage);
                    return (
                      <li key={stage} className="flex items-center gap-2 text-sm">
                        {done ? (
                          <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                        ) : (
                          <span className="h-4 w-4 rounded-full border border-[var(--border)]" />
                        )}
                        <span
                          className={
                            done
                              ? "text-[var(--foreground)]"
                              : "text-[var(--muted-foreground)]"
                          }
                        >
                          <StageLabel stage={stage} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          </section>
        </aside>
      </div>
    </div>
  );
}

function StageLabel({ stage }: { stage: string }) {
  const t = useTranslations("course.stageLabel");
  return <>{t(stage)}</>;
}
