"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDemoState } from "@/store/demo-state";
import type { CourseStage } from "@/lib/cms/types";
import type { PartKey } from "@/lib/cms/sections/contract";
import { answersOf } from "@/lib/learner-progress/answers";
import { CheckCircle2, XCircle, ArrowRight, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { LinkedText } from "@/components/rich-text/RichTextView";
import { FormattedText } from "./FormattedText";
import { useContentLang } from "./CourseText";
import { mainPartOf } from "./continue-gate";
import { ContinueNote, FLAGGED_CLASS, useContinue } from "./useContinue";
import { focusThen } from "./sectioned/focus";

const KEY: PartKey = "simulation/main";
const RETRYING: ReadonlySet<PartKey> = new Set([KEY]);

/**
 * Choose-response simulation. Renders any authored options from
 * stage.simulation. The "best" option is flagged in content (isBest), so
 * the engine stays content-agnostic.
 *
 * Release 2: the choice is the learner's saved one (the store's simulation
 * answer), so it is there again on Back and after a reload, and the chosen
 * option says it is chosen (aria-pressed). "Try another" asks again on
 * this screen only: the saved answer — and the facilitator's result —
 * stay until another option is chosen (owner default 8); focus goes to the
 * heading first, as the button goes. Continue is always there, with the
 * hint above it until the learner has chosen (useContinue).
 */
export function SimulationStage({
  stage,
  onContinue,
}: {
  stage: CourseStage;
  onContinue: () => void;
}) {
  const t = useTranslations("coursePlayer");
  const tHint = useTranslations("continueHint");
  const tCommon = useTranslations("common");
  const { state, dispatch } = useDemoState();
  const [retrying, setRetrying] = useState(false);
  const part = useMemo(() => mainPartOf(stage), [stage]);
  const cont = useContinue({
    lessonId: "simulation",
    parts: [part],
    answers: answersOf(state.course),
    retrying: retrying ? RETRYING : undefined,
    onContinue,
  });
  // Course text carries the course's language when it isn't the page's.
  const lang = useContentLang();

  const sim = stage.simulation;
  if (!sim) return null;

  const saved = state.course.simulation?.choice;
  const selected = !retrying && sim.options.some((o) => o.id === saved) ? (saved ?? null) : null;

  const pick = (optId: string) => {
    if (selected) return;
    const opt = sim.options.find((o) => o.id === optId);
    setRetrying(false);
    dispatch({
      type: "recordSimulation",
      attempt: { choice: optId, correct: !!opt?.isBest },
    });
  };

  const selectedOpt = sim.options.find((o) => o.id === selected);
  const showFeedback = selected !== null;
  const isCorrect = !!selectedOpt?.isBest;
  const headingId = cont.ids.heading("main");
  const flagged = cont.flagged !== null;

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        <h2
          id={headingId}
          tabIndex={-1}
          aria-describedby={cont.describedBy(headingId)}
          className="text-2xl font-bold tracking-tight outline-none"
          lang={lang}
        >
          {stage.title}
        </h2>
        <ContinueNote api={cont} partId="main" />
        <div className={cn(flagged && FLAGGED_CLASS)}>
          {/* Authors type the situation in a textarea — keep its paragraphs and
              lists, like narrative text. */}
          <FormattedText
            text={sim.prompt}
            className="mt-3 text-base leading-relaxed"
          />
          {/* Addresses in the instruction are links, as the course page's
              read view shows them to editors (quick links). */}
          <p lang={lang} className="mt-2 text-sm text-[var(--muted-foreground)]">
            <LinkedText text={sim.instruction} />
          </p>

          <div className="mt-6 space-y-2">
            {sim.options.map((opt) => {
              const isSelected = selected === opt.id;
              const showCorrectness = showFeedback && isSelected;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={showFeedback && !isSelected}
                  onClick={() => pick(opt.id)}
                  className={cn(
                    "w-full text-left rounded-lg border p-4 transition-colors",
                    !showFeedback &&
                      "border-[var(--border)] hover:bg-[var(--surface-muted)] hover:border-[var(--accent)]/40",
                    showCorrectness && opt.isBest &&
                      "border-[var(--success)] bg-[var(--success)]/5",
                    showCorrectness && !opt.isBest &&
                      "border-[var(--warning)] bg-[var(--warning)]/5",
                    showFeedback && !isSelected && "opacity-50"
                  )}
                >
                  <div className="flex items-start gap-3">
                    {showCorrectness ? (
                      opt.isBest ? (
                        <CheckCircle2 className="h-5 w-5 mt-0.5 text-[var(--success)] flex-shrink-0" />
                      ) : (
                        <XCircle className="h-5 w-5 mt-0.5 text-[var(--warning)] flex-shrink-0" />
                      )
                    ) : (
                      <span className="mt-0.5 h-5 w-5 rounded-full border border-[var(--border)] flex-shrink-0" />
                    )}
                    <span lang={lang} className="text-sm sm:text-base leading-relaxed">
                      {opt.text}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {showFeedback && selectedOpt ? (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "mt-5 rounded-lg p-4 border-l-4",
              isCorrect
                ? "border-l-[var(--success)] bg-[var(--success)]/5"
                : "border-l-[var(--warning)] bg-[var(--warning)]/5"
            )}
          >
            <p lang={lang} className="text-sm leading-relaxed">{selectedOpt.feedback}</p>
          </div>
        ) : null}

        {showFeedback ? (
          <div className="mt-6 flex flex-wrap gap-3 justify-between">
            <Button
              variant="outline"
              size="md"
              // The button goes once pressed: focus the heading first.
              onClick={() => focusThen(headingId, () => setRetrying(true))}
            >
              <RotateCcw className="h-4 w-4" />
              {t("tryAnother")}
            </Button>
            <Button size="md" onClick={cont.press}>
              {tCommon("continue")}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          // What Continue waits for, above it. Plain text, read in page
          // order, not a live region: it's there from the start.
          <div className="mt-6 space-y-3">
            <p id={cont.hintId} className="text-sm text-[var(--muted-foreground)] sm:text-right">
              {tHint("simulation")}
            </p>
            <div className="flex justify-end">
              <Button size="md" aria-describedby={cont.hintId} onClick={cont.press}>
                {tCommon("continue")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
