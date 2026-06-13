"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDemoState } from "@/store/demo-state";
import type { CourseStage } from "@/lib/cms/types";
import { CheckCircle2, XCircle, ArrowRight, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Choose-response simulation. Renders any authored options from
 * stage.simulation. The "best" option is flagged in content (isBest), so
 * the engine stays content-agnostic.
 */
export function SimulationStage({
  stage,
  onContinue,
}: {
  stage: CourseStage;
  onContinue: () => void;
}) {
  const t = useTranslations("coursePlayer");
  const tCommon = useTranslations("common");
  const { dispatch } = useDemoState();
  const [selected, setSelected] = useState<string | null>(null);

  const sim = stage.simulation;
  if (!sim) return null;

  const pick = (optId: string) => {
    if (selected) return;
    const opt = sim.options.find((o) => o.id === optId);
    setSelected(optId);
    dispatch({
      type: "recordSimulation",
      attempt: { choice: optId, correct: !!opt?.isBest },
    });
  };

  const selectedOpt = sim.options.find((o) => o.id === selected);
  const showFeedback = selected !== null;
  const isCorrect = !!selectedOpt?.isBest;

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        <h2 className="text-2xl font-bold tracking-tight">{stage.title}</h2>
        <p className="mt-3 text-base leading-relaxed">{sim.prompt}</p>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {sim.instruction}
        </p>

        <div className="mt-6 space-y-2">
          {sim.options.map((opt) => {
            const isSelected = selected === opt.id;
            const showCorrectness = showFeedback && isSelected;
            return (
              <button
                key={opt.id}
                type="button"
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
                  <span className="text-sm sm:text-base leading-relaxed">
                    {opt.text}
                  </span>
                </div>
              </button>
            );
          })}
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
            <p className="text-sm leading-relaxed">{selectedOpt.feedback}</p>
          </div>
        ) : null}

        {showFeedback ? (
          <div className="mt-6 flex flex-wrap gap-3 justify-between">
            <Button variant="outline" size="md" onClick={() => setSelected(null)}>
              <RotateCcw className="h-4 w-4" />
              {t("tryAnother")}
            </Button>
            <Button size="md" onClick={onContinue}>
              {tCommon("continue")}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
