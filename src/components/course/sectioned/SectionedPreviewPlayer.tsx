"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, Pencil } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type {
  PartAnswer,
  PartKey,
  SectionId,
  SectionedCourseContent,
} from "@/lib/cms/sections/contract";
import type { Locale } from "@/lib/cms/types";
import { StageBreadcrumb } from "../StageBreadcrumb";
import { CompletionStage } from "../CompletionStage";
import { openStepAtTop } from "../step-focus";
import { completionCourse } from "./completion-course";
import { SectionView, type PreviewAnswers } from "./SectionView";

/**
 * The editor's preview of a course built with lessons or content learners
 * don't get until Release 2 (spec 10). Only an editor ever gets here: the
 * route renders it for a preview of a draft course whose layout isn't the
 * standard one, and the learner player (frozen) for everything else.
 *
 * Shaped like the learner player — banner, "Back to editing", "Edit this
 * lesson", step bar, progress, Back and "n / N · name" — but it walks the
 * course's own lessons in the lesson list's order (hidden ones are left
 * out by the loader), with their step names.
 *
 * Nothing is recorded: no enrolment, progress, statistics, timer or
 * in-video answers. The answers given live here, in memory, keyed by
 * partKey: they survive going Back and coming again, and are gone with the
 * tab. Only the final screen is the learner player's own CompletionStage,
 * which writes into the in-memory preview store the route wraps this in,
 * as every preview does today.
 */
export function SectionedPreviewPlayer({
  course,
  draftPreview = false,
  canEdit = false,
  initialSection,
  editLocale,
}: {
  course: SectionedCourseContent;
  /** The course isn't published: say so in the banner. */
  draftPreview?: boolean;
  /** The viewer may edit content (checked on the server): "Edit this lesson". */
  canEdit?: boolean;
  /** The lesson to open first. Ignored if the preview hasn't got it. */
  initialSection?: SectionId;
  /** The editor's own menu language, for the links back to editing. */
  editLocale?: Locale;
}) {
  const tPlayer = useTranslations("coursePlayer");
  const t = useTranslations("sectionPreview");

  const stages = course.stages;
  const keys = stages.map((s) => s.key);
  const stageByKey = new Map(stages.map((s) => [s.key, s] as const));
  const labelOf = (k: SectionId) => stageByKey.get(k)?.label ?? "";

  const [current, setCurrent] = useState<SectionId | "complete">(() =>
    initialSection && stageByKey.has(initialSection) ? initialSection : (keys[0] ?? "complete")
  );
  const [answers, setAnswers] = useState<PreviewAnswers>({});
  const [done, setDone] = useState<SectionId[]>([]);

  const onAnswer = useCallback((key: PartKey, answer: PartAnswer | undefined) => {
    setAnswers((prev) => {
      const next = { ...prev };
      if (answer) next[key] = answer;
      else delete next[key];
      return next;
    });
  }, []);

  // A new step opens at its top, focused for screen readers (as the
  // learner player does, step-focus.ts).
  const stageRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    openStepAtTop(stageRef.current, window);
  }, [current]);

  const indexOf = (k: SectionId) => keys.indexOf(k);

  const goNext = () => {
    if (current === "complete") return;
    setDone((d) => (d.includes(current) ? d : [...d, current]));
    const idx = indexOf(current);
    setCurrent(idx >= keys.length - 1 ? "complete" : keys[idx + 1]);
  };
  const goBack = () => {
    if (current === "complete") {
      if (keys.length) setCurrent(keys[keys.length - 1]);
      return;
    }
    const idx = indexOf(current);
    if (idx > 0) setCurrent(keys[idx - 1]);
  };

  const currentStage = current === "complete" ? undefined : stageByKey.get(current);
  const breadcrumbCurrent = current === "complete" ? keys[keys.length - 1] : current;
  const progressPct =
    current === "complete" || keys.length === 0
      ? 100
      : Math.round(((indexOf(current) + 1) / keys.length) * 100);

  // This lesson on the course page, in the language being previewed.
  const editHref = `/content/courses/${course.slug}?${
    current === "complete" ? "" : `lesson=${current}&`
  }lang=${course.locale}`;
  // Opened from the course page in a new tab: go back to it rather than
  // open a second copy (as the learner player's preview does).
  const backToOpener = (e: MouseEvent) => {
    if (window.history.length !== 1) return;
    window.close();
    if (window.closed) e.preventDefault();
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <div
        role="status"
        className="mb-4 rounded-lg border border-[var(--warning)] bg-[var(--warning)]/10 px-3 py-2 text-sm text-[var(--foreground)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p>
            {tPlayer.rich(draftPreview ? "draftPreview" : "preview", {
              b: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          {canEdit ? (
            <Link
              href={editHref}
              locale={editLocale}
              onClick={editLocale ? backToOpener : undefined}
              className="font-medium text-[var(--accent)] underline underline-offset-2"
            >
              {tPlayer("backToEditing")}
            </Link>
          ) : null}
        </div>
        <p className="mt-1">{t("banner")}</p>
      </div>

      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <Link
            href="/learner"
            className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {tPlayer("dashboard")}
          </Link>
          {canEdit && current !== "complete" ? (
            <Link
              href={editHref}
              locale={editLocale}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-sm hover:bg-[var(--surface-muted)] transition-colors"
            >
              <Pencil className="h-4 w-4" aria-hidden />
              {t("editLesson")}
            </Link>
          ) : null}
        </div>
        <div className="min-w-0 text-right">
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider">
            {course.clusterLabel}
          </p>
          <h1 className="text-sm sm:text-base font-semibold">{course.title}</h1>
        </div>
      </div>

      {breadcrumbCurrent ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 mb-2">
          <StageBreadcrumb<SectionId>
            current={breadcrumbCurrent}
            completed={current === "complete" ? keys : done}
            onJump={setCurrent}
            stages={keys}
            labelOf={labelOf}
            allReachable
          />
        </div>
      ) : null}
      <Progress value={progressPct} className="mb-6" />

      <div key={current} ref={stageRef} tabIndex={-1} className="outline-none">
        {currentStage ? (
          <SectionView
            stage={currentStage}
            stageNumber={indexOf(currentStage.key) + 1}
            answers={answers}
            onAnswer={onAnswer}
            onContinue={goNext}
          />
        ) : (
          <CompletionStage course={completionCourse(course)} />
        )}
      </div>

      {current !== "complete" ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={goBack} disabled={indexOf(current) === 0}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {labelOf(keys[Math.max(0, indexOf(current) - 1)])}
          </Button>
          <p className="text-xs text-[var(--muted-foreground)] hidden sm:block">
            {indexOf(current) + 1} / {keys.length} · {labelOf(current)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
