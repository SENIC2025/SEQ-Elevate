"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  SIMULATION_OPTIONS,
  SIMULATION_CORRECT,
  type SimulationOption,
} from "@/data/course";
import { useDemoState } from "@/store/demo-state";
import { CheckCircle2, XCircle, ArrowRight, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export function SimulationStage({ onContinue }: { onContinue: () => void }) {
  const t = useTranslations("course.workplaceConflict.simulation");
  const { dispatch } = useDemoState();
  const [selected, setSelected] = useState<SimulationOption | null>(null);

  const pick = (opt: SimulationOption) => {
    if (selected) return;
    setSelected(opt);
    dispatch({
      type: "recordSimulation",
      attempt: { choice: opt, correct: opt === SIMULATION_CORRECT },
    });
  };

  const reset = () => setSelected(null);

  const showFeedback = selected !== null;
  const isCorrect = selected === SIMULATION_CORRECT;

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        <h2 className="text-2xl font-bold tracking-tight">{t("title")}</h2>
        <p className="mt-3 text-base leading-relaxed">{t("prompt")}</p>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {t("instruction")}
        </p>

        <div className="mt-6 space-y-2">
          {SIMULATION_OPTIONS.map((opt) => {
            const isSelected = selected === opt;
            const isCorrectAnswer = opt === SIMULATION_CORRECT;
            const showCorrectness = showFeedback && isSelected;

            return (
              <button
                key={opt}
                type="button"
                disabled={showFeedback && !isSelected}
                onClick={() => pick(opt)}
                className={cn(
                  "w-full text-left rounded-lg border p-4 transition-colors",
                  !showFeedback &&
                    "border-[var(--border)] hover:bg-[var(--surface-muted)] hover:border-[var(--primary)]/40",
                  showCorrectness && isCorrectAnswer &&
                    "border-[var(--success)] bg-[var(--success)]/5",
                  showCorrectness && !isCorrectAnswer &&
                    "border-[var(--warning)] bg-[var(--warning)]/5",
                  showFeedback && !isSelected && "opacity-50"
                )}
              >
                <div className="flex items-start gap-3">
                  {showCorrectness ? (
                    isCorrectAnswer ? (
                      <CheckCircle2 className="h-5 w-5 mt-0.5 text-[var(--success)] flex-shrink-0" />
                    ) : (
                      <XCircle className="h-5 w-5 mt-0.5 text-[var(--warning)] flex-shrink-0" />
                    )
                  ) : (
                    <span className="mt-0.5 h-5 w-5 rounded-full border border-[var(--border)] flex-shrink-0" />
                  )}
                  <span className="text-sm sm:text-base leading-relaxed">
                    {t(`options.${opt}`)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {showFeedback && selected ? (
          <div
            className={cn(
              "mt-5 rounded-lg p-4 border-l-4",
              isCorrect
                ? "border-l-[var(--success)] bg-[var(--success)]/5"
                : "border-l-[var(--warning)] bg-[var(--warning)]/5"
            )}
          >
            <p className="text-sm leading-relaxed">
              {t(`feedback.${selected}`)}
            </p>
          </div>
        ) : null}

        {showFeedback ? (
          <div className="mt-6 flex flex-wrap gap-3 justify-between">
            <Button variant="outline" size="md" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              {t("tryAgain")}
            </Button>
            <Button size="md" onClick={onContinue}>
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
