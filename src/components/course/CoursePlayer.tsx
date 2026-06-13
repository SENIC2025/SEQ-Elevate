"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { STAGES, type Stage, COURSE_META } from "@/data/course";
import { useDemoState } from "@/store/demo-state";
import { StageBreadcrumb } from "./StageBreadcrumb";
import { NarrativeStage } from "./NarrativeStage";
import { SimulationStage } from "./SimulationStage";
import { ScenarioStage } from "./ScenarioStage";
import { ReflectionStage } from "./ReflectionStage";
import { AssessmentStage } from "./AssessmentStage";
import { CompletionStage } from "./CompletionStage";
import { ChevronLeft } from "lucide-react";

export function CoursePlayer() {
  const t = useTranslations("course.workplaceConflict");
  const tStage = useTranslations("course.stageLabel");

  const { state, dispatch } = useDemoState();
  const [current, setCurrent] = useState<Stage | "complete">("context");

  const resumeFromProgress = state.course.stagesCompleted.length;

  useEffect(() => {
    if (state.course.completedAt) {
      setCurrent("complete");
    } else if (resumeFromProgress > 0 && resumeFromProgress < STAGES.length) {
      setCurrent(STAGES[resumeFromProgress]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goNext = useCallback(() => {
    if (current === "complete") return;
    dispatch({ type: "completeStage", stage: current });
    const idx = STAGES.indexOf(current);
    if (idx === STAGES.length - 1) {
      setCurrent("complete");
    } else {
      setCurrent(STAGES[idx + 1]);
    }
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [current, dispatch]);

  const goBack = useCallback(() => {
    if (current === "complete") {
      setCurrent("assessment");
      return;
    }
    const idx = STAGES.indexOf(current);
    if (idx === 0) return;
    setCurrent(STAGES[idx - 1]);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [current]);

  const jumpTo = useCallback((stage: Stage) => {
    setCurrent(stage);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const breadcrumbCurrent: Stage =
    current === "complete" ? "assessment" : current;
  const completedStages =
    current === "complete"
      ? [...STAGES]
      : state.course.stagesCompleted;

  const progressPct =
    current === "complete"
      ? 100
      : Math.round(
          ((STAGES.indexOf(current) + 1) / STAGES.length) * 100
        );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      {/* Top bar: back + title + progress */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <Link
          href="/learner"
          className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Dashboard
        </Link>
        <div className="text-right">
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider">
            {t("cluster")}
          </p>
          <h1 className="text-sm sm:text-base font-semibold">{t("title")}</h1>
        </div>
      </div>

      {/* Stage breadcrumb — enforces visible sequence */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 mb-2">
        <StageBreadcrumb
          current={breadcrumbCurrent}
          completed={completedStages}
          onJump={jumpTo}
        />
      </div>
      <Progress value={progressPct} className="mb-6" />

      {/* Current stage content */}
      <div key={current}>
        {current === "context" ? (
          <NarrativeStage stage="context" onContinue={goNext} />
        ) : current === "concept" ? (
          <NarrativeStage stage="concept" onContinue={goNext} />
        ) : current === "behaviour" ? (
          <NarrativeStage stage="behaviour" onContinue={goNext} />
        ) : current === "simulation" ? (
          <SimulationStage onContinue={goNext} />
        ) : current === "scenario" ? (
          <ScenarioStage onContinue={goNext} />
        ) : current === "reflection" ? (
          <ReflectionStage onContinue={goNext} />
        ) : current === "assessment" ? (
          <AssessmentStage onContinue={goNext} />
        ) : (
          <CompletionStage />
        )}
      </div>

      {/* Sequence enforcement note */}
      {current !== "complete" ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={goBack}
            disabled={current === "context"}
          >
            <ChevronLeft className="h-4 w-4" />
            {tStage(STAGES[Math.max(0, STAGES.indexOf(current) - 1)])}
          </Button>
          <p className="text-xs text-[var(--muted-foreground)] hidden sm:block">
            Step {STAGES.indexOf(current) + 1} of {STAGES.length} ·{" "}
            {tStage(current)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
