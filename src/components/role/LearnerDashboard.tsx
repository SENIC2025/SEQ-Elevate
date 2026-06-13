"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useDemoState } from "@/store/demo-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SKILL_CLUSTERS, STAGES, COURSE_META } from "@/data/course";
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

export function LearnerDashboard() {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const tClusters = useTranslations("skillClusters");
  const tMission = useTranslations("mission");
  const tCourse = useTranslations("course.workplaceConflict");
  const tCompletion = useTranslations("course.workplaceConflict.completion");

  const { state } = useDemoState();
  const stagesDone = state.course.stagesCompleted.length;
  const totalStages = STAGES.length;
  const progressPct = Math.round((stagesDone / totalStages) * 100);
  const isInProgress = stagesDone > 0 && !state.course.completedAt;
  const isCompleted = !!state.course.completedAt;

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

      {/* Hero mission */}
      <Card className="mt-4 overflow-hidden border-[var(--accent)]/30">
        <CardContent className="p-0">
          <div className="grid sm:grid-cols-[1fr_auto] gap-0">
            <div className="p-6">
              <Badge variant="primary" className="mb-3">
                {t("currentMission")}
              </Badge>
              <h2 className="text-xl sm:text-2xl font-bold leading-snug">
                {tCourse("title")}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {tCourse("cluster")} · {tCourse("tagline")}
              </p>
              <p className="mt-3 text-sm">{tMission("workplaceConflictHint")}</p>

              {isInProgress ? (
                <div className="mt-4 max-w-sm">
                  <Progress
                    value={progressPct}
                    label={`${stagesDone}/${totalStages} ${t("yourJourney").toLowerCase()}`}
                  />
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-3">
                <Link href={`/learner/course/${COURSE_META.id}`}>
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
                  {COURSE_META.durationMinutes}
                </p>
                <p className="text-xs opacity-80 uppercase tracking-wider">
                  {tCommon("minutes", { count: COURSE_META.durationMinutes })}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Two-column lower section */}
      <div className="mt-8 grid lg:grid-cols-[2fr_1fr] gap-6">
        {/* Skill map */}
        <section>
          <h2 className="text-lg font-semibold mb-1">{t("skillMap")}</h2>
          <p className="text-sm text-[var(--muted-foreground)] mb-4">
            {t("skillMapHint")}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {SKILL_CLUSTERS.map((cluster) => {
              const Icon = CLUSTER_ICONS[cluster] ?? MessageCircle;
              const isActive = cluster === COURSE_META.cluster;
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

        {/* Right column: badges + progress */}
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
                    {state.badges.map((b) => (
                      <div
                        key={b}
                        className="flex items-center gap-2 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-2"
                      >
                        <Award className="h-5 w-5 text-[var(--accent)]" />
                        <div>
                          <p className="text-xs font-semibold">
                            {tCompletion("badgeName")}
                          </p>
                          <p className="text-[10px] text-[var(--muted-foreground)]">
                            {tCompletion("badgeMeaning")}
                          </p>
                        </div>
                      </div>
                    ))}
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
                    const done = state.course.stagesCompleted.includes(stage);
                    return (
                      <li
                        key={stage}
                        className="flex items-center gap-2 text-sm"
                      >
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
