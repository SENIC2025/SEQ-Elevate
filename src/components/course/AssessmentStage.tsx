"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { CourseStage } from "@/lib/cms/types";
import { CheckCircle2, XCircle, ArrowRight, Award } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Micro-assessment. Renders authored questions; answers keyed by question
 * id (local state), so any number of questions render generically.
 */
export function AssessmentStage({
  stage,
  onContinue,
}: {
  stage: CourseStage;
  onContinue: () => void;
}) {
  const t = useTranslations("coursePlayer");
  const tCommon = useTranslations("common");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);

  const a = stage.assessment;
  if (!a) return null;

  const questions = a.questions;
  const allAnswered = questions.every((q) => answers[q.id]);
  const correctCount = questions.reduce(
    (acc, q) => (answers[q.id] === q.correctOptionId ? acc + 1 : acc),
    0
  );

  const ratio = correctCount / questions.length;
  const encouragement =
    ratio === 1
      ? t("encouragementAll")
      : ratio >= 0.6
        ? t("encouragementMost")
        : ratio > 0
          ? t("encouragementSome")
          : t("encouragementNone");

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-2">
          <Award className="h-3.5 w-3.5" />
          {t("quickCheck")}
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{stage.title}</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">{a.intro}</p>

        <div className="mt-6 space-y-6">
          {questions.map((q, idx) => (
            <div key={q.id}>
              <p className="font-medium mb-3">
                <span className="text-[var(--muted-foreground)] mr-2">
                  {idx + 1}.
                </span>
                {q.question}
              </p>
              <div className="space-y-1.5">
                {q.options.map((opt) => {
                  const isSelected = answers[q.id] === opt.id;
                  const isCorrect = opt.id === q.correctOptionId;
                  const showResult = checked && isSelected;
                  const showCorrectAfterWrong =
                    checked &&
                    !isSelected &&
                    isCorrect &&
                    answers[q.id] !== q.correctOptionId;

                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={checked}
                      onClick={() =>
                        setAnswers((prev) => ({ ...prev, [q.id]: opt.id }))
                      }
                      className={cn(
                        "w-full text-left rounded-lg border px-4 py-3 transition-colors text-sm sm:text-base flex items-start gap-3",
                        !checked &&
                          isSelected &&
                          "border-[var(--accent)] bg-[var(--accent)]/5",
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
                              ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                              : "border-[var(--border)] text-[var(--muted-foreground)]"
                          )}
                        >
                          {opt.id}
                        </span>
                      )}
                      <span>{opt.text}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {checked ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-6 rounded-lg bg-[var(--accent)]/5 border border-[var(--accent)]/20 p-4"
          >
            <p className="font-semibold text-[var(--accent)]">
              {t("score", { correct: correctCount, total: questions.length })}
            </p>
            <p className="mt-1 text-sm">{encouragement}</p>
          </div>
        ) : null}

        <div className="mt-6 flex justify-end">
          {checked ? (
            <Button size="md" onClick={onContinue}>
              {tCommon("continue")}
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="md"
              disabled={!allAnswered}
              onClick={() => setChecked(true)}
            >
              {t("checkAnswers")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
