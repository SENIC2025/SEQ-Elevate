"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { STAGES, type Stage } from "@/data/course";
import { useDemoState } from "@/store/demo-state";
import { StageBreadcrumb } from "./StageBreadcrumb";
import { NarrativeStage } from "./NarrativeStage";
import { SimulationStage } from "./SimulationStage";
import { ScenarioStage } from "./ScenarioStage";
import { ReflectionStage } from "./ReflectionStage";
import { AssessmentStage } from "./AssessmentStage";
import { CompletionStage } from "./CompletionStage";
import type { CourseContent, CourseStage } from "@/lib/cms/types";
import { ChevronLeft } from "lucide-react";

/**
 * Generic course player. Renders ANY course passed as a CourseContent
 * object — content comes from props (CMS), only UI chrome is i18n. The
 * WP3 7-stage sequence is enforced via the STAGES order; the player walks
 * the stages present in course.stages in that canonical order.
 */
export function CoursePlayer({ course }: { course: CourseContent }) {
  const tStage = useTranslations("course.stageLabel");

  const { state, dispatch } = useDemoState();
  const [current, setCurrent] = useState<Stage | "complete">("context");

  // Stage data lookup by key
  const stageByKey = new Map<string, CourseStage>(
    course.stages.map((s) => [s.key, s])
  );
  // The ordered list of stage keys this course actually contains,
  // in the enforced WP3 order.
  const orderedKeys = STAGES.filter((k) => stageByKey.has(k));

  const resumeFromProgress = state.course.stagesCompleted.length;

  // Record which course is being played, so Comp Card / facilitator views
  // can show the course title + evidence without re-resolving content.
  useEffect(() => {
    dispatch({
      type: "setCourseContext",
      slug: course.slug,
      title: course.title,
    });
  }, [dispatch, course.slug, course.title]);

  useEffect(() => {
    // Resume at the learner's last position on mount, from persisted
    // progress. Intentional one-time setState after hydration.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (state.course.completedAt) {
      setCurrent("complete");
    } else if (
      resumeFromProgress > 0 &&
      resumeFromProgress < orderedKeys.length
    ) {
      setCurrent(orderedKeys[resumeFromProgress]);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const indexOf = (key: Stage) => orderedKeys.indexOf(key);

  const goNext = useCallback(() => {
    if (current === "complete") return;
    dispatch({ type: "completeStage", stage: current });
    const idx = orderedKeys.indexOf(current);
    if (idx === orderedKeys.length - 1) {
      setCurrent("complete");
    } else {
      setCurrent(orderedKeys[idx + 1]);
    }
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, dispatch]);

  const goBack = useCallback(() => {
    if (current === "complete") {
      setCurrent(orderedKeys[orderedKeys.length - 1]);
      return;
    }
    const idx = orderedKeys.indexOf(current);
    if (idx === 0) return;
    setCurrent(orderedKeys[idx - 1]);
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const jumpTo = useCallback((stage: Stage) => {
    setCurrent(stage);
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const breadcrumbCurrent: Stage =
    current === "complete" ? orderedKeys[orderedKeys.length - 1] : current;
  const completedStages =
    current === "complete" ? [...orderedKeys] : state.course.stagesCompleted;

  const progressPct =
    current === "complete"
      ? 100
      : Math.round(((indexOf(current) + 1) / orderedKeys.length) * 100);

  const currentStage =
    current === "complete" ? null : stageByKey.get(current) ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      {/* Top bar */}
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
            {course.clusterLabel}
          </p>
          <h1 className="text-sm sm:text-base font-semibold">{course.title}</h1>
        </div>
      </div>

      {/* Breadcrumb — enforces visible sequence */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 mb-2">
        <StageBreadcrumb
          current={breadcrumbCurrent}
          completed={completedStages}
          onJump={jumpTo}
        />
      </div>
      <Progress value={progressPct} className="mb-6" />

      {/* Current stage */}
      <div key={current}>
        {currentStage?.key === "context" ||
        currentStage?.key === "concept" ||
        currentStage?.key === "behaviour" ? (
          <NarrativeStage stage={currentStage} onContinue={goNext} />
        ) : currentStage?.key === "simulation" ? (
          <SimulationStage stage={currentStage} onContinue={goNext} />
        ) : currentStage?.key === "scenario" ? (
          <ScenarioStage stage={currentStage} onContinue={goNext} />
        ) : currentStage?.key === "reflection" ? (
          <ReflectionStage stage={currentStage} onContinue={goNext} />
        ) : currentStage?.key === "assessment" ? (
          <AssessmentStage stage={currentStage} onContinue={goNext} />
        ) : (
          <CompletionStage course={course} />
        )}
      </div>

      {/* Nav */}
      {current !== "complete" ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={goBack}
            disabled={indexOf(current) === 0}
          >
            <ChevronLeft className="h-4 w-4" />
            {tStage(orderedKeys[Math.max(0, indexOf(current) - 1)])}
          </Button>
          <p className="text-xs text-[var(--muted-foreground)] hidden sm:block">
            {indexOf(current) + 1} / {orderedKeys.length} · {tStage(current)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
