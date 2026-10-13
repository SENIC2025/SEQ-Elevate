"use client";

import { useTranslations } from "next-intl";
import { STAGES, type Stage } from "@/data/course";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The course's steps, in order. A learner can go back to any step they've
 * reached but not skip ahead; an editor's preview (`allReachable`) can jump
 * anywhere. `stages` is the steps this course actually has — a course without
 * the interactive steps shows only its own, numbered 1..n.
 */
export function StageBreadcrumb({
  current,
  completed,
  onJump,
  stages = STAGES,
  allReachable = false,
}: {
  current: Stage;
  completed: string[];
  onJump?: (stage: Stage) => void;
  stages?: readonly Stage[];
  allReachable?: boolean;
}) {
  const t = useTranslations("course.stageLabel");
  const tCourse = useTranslations("course");
  const currentIndex = stages.indexOf(current);

  return (
    // relative: on a phone the step names are visually hidden, and
    // positioned; without it they escape this scroll box and widen the page.
    <nav
      aria-label={tCourse("stepsNav")}
      className="relative w-full overflow-x-auto"
    >
      <ol className="flex items-center gap-1 min-w-max">
        {stages.map((stage, i) => {
          const isCurrent = stage === current;
          const isDone = completed.includes(stage);
          const isPast = i < currentIndex;
          const reachable = allReachable || isDone || isPast || isCurrent;

          return (
            <li key={stage} className="flex items-center">
              <button
                type="button"
                onClick={() => reachable && onJump?.(stage)}
                disabled={!reachable}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  isCurrent &&
                    "bg-[var(--primary)] text-[var(--primary-foreground)]",
                  !isCurrent &&
                    isDone &&
                    "bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--primary)]/15",
                  !isCurrent &&
                    !isDone &&
                    isPast &&
                    "bg-[var(--surface-muted)] text-[var(--foreground)] hover:bg-[var(--surface)]",
                  // A step ahead that preview lets the editor jump to.
                  reachable &&
                    !isCurrent &&
                    !isDone &&
                    !isPast &&
                    "text-[var(--foreground)] hover:bg-[var(--surface-muted)]",
                  !reachable &&
                    "text-[var(--muted-foreground)] cursor-not-allowed opacity-60"
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                    // The step's own text colour: white on the lime was
                    // 1.5:1 (dark text on it reads at 6.3:1, white on the
                    // high-contrast olive at 5.1:1).
                    isCurrent
                      ? "bg-[var(--primary-foreground)]/15 text-[var(--primary-foreground)]"
                      : isDone
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "bg-[var(--surface)] border border-[var(--border)] text-[var(--muted-foreground)]"
                  )}
                >
                  {isDone ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                {/* Hidden on a phone but still the button's name: a
                    finished step shows only a tick. */}
                <span className="sr-only sm:not-sr-only">{t(stage)}</span>
              </button>
              {i < stages.length - 1 ? (
                <span
                  className={cn(
                    "mx-0.5 h-px w-3 sm:w-4",
                    i < currentIndex
                      ? "bg-[var(--primary)]/40"
                      : "bg-[var(--border)]"
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
