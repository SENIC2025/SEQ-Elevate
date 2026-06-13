"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ASSESSMENT } from "@/data/course";
import { useDemoState } from "@/store/demo-state";
import { CheckCircle2, XCircle, ArrowRight, Award } from "lucide-react";
import { cn } from "@/lib/utils";

export function AssessmentStage({ onContinue }: { onContinue: () => void }) {
  const t = useTranslations("course.workplaceConflict.assessment");
  const { state, dispatch } = useDemoState();
  const [checked, setChecked] = useState(false);

  const a = state.course.assessment;

  const setAnswer = (q: "q1" | "q2" | "q3", value: string) => {
    if (checked) return;
    dispatch({ type: "updateAssessment", patch: { [q]: value } });
  };

  const allAnswered = a.q1 && a.q2 && a.q3;
  const correctCount = ASSESSMENT.reduce(
    (acc, q) => (a[q.id as keyof typeof a] === q.correct ? acc + 1 : acc),
    0
  );

  const encouragementKey =
    correctCount === 3
      ? "all"
      : correctCount === 2
        ? "most"
        : correctCount === 1
          ? "some"
          : "none";

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-2">
          <Award className="h-3.5 w-3.5" />
          Quick check
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{t("title")}</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {t("intro")}
        </p>

        <div className="mt-6 space-y-6">
          {ASSESSMENT.map((q, idx) => {
            const answer = a[q.id as keyof typeof a];
            return (
              <div key={q.id}>
                <p className="font-medium mb-3">
                  <span className="text-[var(--muted-foreground)] mr-2">
                    {idx + 1}.
                  </span>
                  {t(`${q.id}.question`)}
                </p>
                <div className="space-y-1.5">
                  {q.options.map((opt) => {
                    const isSelected = answer === opt;
                    const isCorrect = opt === q.correct;
                    const showResult = checked && isSelected;
                    const showCorrectAfterWrong =
                      checked && !isSelected && isCorrect && answer !== q.correct;

                    return (
                      <button
                        key={opt}
                        type="button"
                        disabled={checked}
                        onClick={() =>
                          setAnswer(q.id as "q1" | "q2" | "q3", opt)
                        }
                        className={cn(
                          "w-full text-left rounded-lg border px-4 py-3 transition-colors text-sm sm:text-base flex items-start gap-3",
                          !checked &&
                            isSelected &&
                            "border-[var(--primary)] bg-[var(--accent)]/5",
                          !checked &&
                            !isSelected &&
                            "border-[var(--border)] hover:bg-[var(--surface-muted)]",
                          showResult &&
                            isCorrect &&
                            "border-[var(--success)] bg-[var(--success)]/10",
                          showResult &&
                            !isCorrect &&
                            "border-[var(--warning)] bg-[var(--warning)]/10",
                          showCorrectAfterWrong &&
                            "border-[var(--success)]/60 bg-[var(--success)]/5"
                        )}
                      >
                        {showResult ? (
                          isCorrect ? (
                            <CheckCircle2 className="h-5 w-5 mt-0.5 text-[var(--success)] flex-shrink-0" />
                          ) : (
                            <XCircle className="h-5 w-5 mt-0.5 text-[var(--warning)] flex-shrink-0" />
                          )
                        ) : (
                          <span
                            className={cn(
                              "mt-0.5 h-5 w-5 rounded-full border flex items-center justify-center flex-shrink-0 text-[10px] font-semibold uppercase",
                              isSelected
                                ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                                : "border-[var(--border)] text-[var(--muted-foreground)]"
                            )}
                          >
                            {opt}
                          </span>
                        )}
                        <span>{t(`${q.id}.${opt}`)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {checked ? (
          <div className="mt-6 rounded-lg bg-[var(--accent)]/5 border border-[var(--accent)]/20 p-4">
            <p className="font-semibold text-[var(--accent)]">
              {t("score", { correct: correctCount, total: ASSESSMENT.length })}
            </p>
            <p className="mt-1 text-sm">
              {t(`scoreEncouragement.${encouragementKey}`)}
            </p>
          </div>
        ) : null}

        <div className="mt-6 flex justify-end">
          {checked ? (
            <Button size="md" onClick={onContinue}>
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="md"
              disabled={!allAnswered}
              onClick={() => setChecked(true)}
            >
              {t("submit")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
