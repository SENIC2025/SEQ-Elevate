"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { STAGES, type Stage } from "@/data/course";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The course's steps, in order. A learner can go back to any step they've
 * reached but not skip ahead; an editor's preview (`allReachable`) can jump
 * anywhere. `stages` is the steps this course actually has — a course without
 * the interactive steps shows only its own, numbered 1..n.
 *
 * Generic over the step key, so the player can list a course's own lessons
 * with their step names (`labelOf`, D58). The defaults are Release 0's:
 * the standard steps, named by course.stageLabel, with exactly the markup
 * they always had.
 *
 * Release 2 (Q4, spec 5.6): the player passes `frontier`, the index of the
 * first lesson the learner hasn't done — the bar reaches up to it and no
 * further, even to a lesson done before an editor moved it there, which
 * shows ticked but can't be opened. `doneLabel` says a done step is done
 * (", done", in its name), where the eye sees only a tick. `langOf` marks a
 * step name written in another language than the page's (WCAG 3.1.2): a
 * lesson of the course's own named only in English, on a Greek page. On a phone the bar scrolls
 * sideways: the current step is kept in view by moving the bar itself,
 * never the page (scrollIntoView would), at once for a learner who asked
 * for less motion.
 */
export function StageBreadcrumb<K extends string = Stage>({
  current,
  completed,
  onJump,
  stages = STAGES as readonly string[] as readonly K[],
  labelOf,
  allReachable = false,
  frontier,
  doneLabel,
  langOf,
}: {
  current: K;
  completed: string[];
  onJump?: (stage: K) => void;
  stages?: readonly K[];
  /** The step's name. Default: its standard name (course.stageLabel). */
  labelOf?: (stage: K) => string;
  allReachable?: boolean;
  /** The last step the bar reaches (the first not done); the current one always. */
  frontier?: number;
  /** Said after a done step's name, for screen readers (", done"). */
  doneLabel?: string;
  /** The language of a step's name when it isn't the page's; nothing otherwise. */
  langOf?: (stage: K) => string | undefined;
}) {
  const t = useTranslations("course.stageLabel");
  const tCourse = useTranslations("course");
  const currentIndex = stages.indexOf(current);
  const nameOf = labelOf ?? ((stage: K) => t(stage as string as Stage));

  // The current step in view when the bar is wider than the screen.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const button = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!nav || !button) return;
    const left = button.offsetLeft;
    const right = left + button.offsetWidth;
    if (left >= nav.scrollLeft && right <= nav.scrollLeft + nav.clientWidth) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollTo({
      left: Math.max(0, left - (nav.clientWidth - button.offsetWidth) / 2),
      behavior: reduce ? "auto" : "smooth",
    });
  }, [current]);

  return (
    // relative: on a phone the step names are visually hidden, and
    // positioned; without it they escape this scroll box and widen the page.
    <nav
      ref={navRef}
      aria-label={tCourse("stepsNav")}
      className="relative w-full overflow-x-auto"
    >
      <ol className="flex items-center gap-1 min-w-max">
        {stages.map((stage, i) => {
          const isCurrent = stage === current;
          const lang = langOf?.(stage);
          const isDone = completed.includes(stage);
          const isPast = i < currentIndex;
          const reachable =
            frontier === undefined
              ? allReachable || isDone || isPast || isCurrent
              : allReachable || i <= frontier || isCurrent;

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
                {isDone && doneLabel ? (
                  // A done step shows a tick: its name says it's done. The
                  // whole name in one hidden span — a hidden suffix next to
                  // the shown name would be read with a space before it
                  // ("Context , done") — and the shown name, on wider
                  // screens, left out of it.
                  <>
                    <span aria-hidden="true" className="hidden sm:inline" lang={lang}>
                      {nameOf(stage)}
                    </span>
                    <span className="sr-only">
                      {lang ? (
                        // The name in its language, ", done" in the page's.
                        <>
                          <span lang={lang}>{nameOf(stage)}</span>
                          {doneLabel}
                        </>
                      ) : (
                        `${nameOf(stage)}${doneLabel}`
                      )}
                    </span>
                  </>
                ) : (
                  // Hidden on a phone but still the button's name: a
                  // finished step shows only a tick.
                  <span className="sr-only sm:not-sr-only" lang={lang}>
                    {nameOf(stage)}
                  </span>
                )}
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
