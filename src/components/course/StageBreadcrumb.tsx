"use client";

import { useTranslations } from "next-intl";
import { STAGES, type Stage } from "@/data/course";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function StageBreadcrumb({
  current,
  completed,
  onJump,
}: {
  current: Stage;
  completed: string[];
  onJump?: (stage: Stage) => void;
}) {
  const t = useTranslations("course.stageLabel");
  const currentIndex = STAGES.indexOf(current);

  return (
    <nav aria-label="Course stages" className="w-full overflow-x-auto">
      <ol className="flex items-center gap-1 min-w-max">
        {STAGES.map((stage, i) => {
          const isCurrent = stage === current;
          const isDone = completed.includes(stage);
          const isPast = i < currentIndex;
          const reachable = isDone || isPast || isCurrent;

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
                  !reachable &&
                    "text-[var(--muted-foreground)] cursor-not-allowed opacity-60"
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                    isCurrent
                      ? "bg-white/20 text-white"
                      : isDone
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "bg-[var(--surface)] border border-[var(--border)] text-[var(--muted-foreground)]"
                  )}
                >
                  {isDone ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{t(stage)}</span>
              </button>
              {i < STAGES.length - 1 ? (
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
