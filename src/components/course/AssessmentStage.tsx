"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDemoState } from "@/store/demo-state";
import { checkedQuiz } from "@/lib/assessment-progress";
import type { CourseStage } from "@/lib/cms/types";
import { CheckCircle2, XCircle, ArrowRight, Award } from "lucide-react";
import { cn } from "@/lib/utils";
import { LinkedText } from "@/components/rich-text/RichTextView";

/**
 * Micro-assessment. Renders authored questions; answers keyed by question
 * id, so any number of questions render generically. The answers, and
 * whether the learner checked them, live in the learner store, which saves
 * them with the course (the account's, or this browser's for a guest): a
 * learner who comes back finds their checked answers locked, their score
 * and Continue. In an editor's preview the store is the preview's own,
 * which saves nothing.
 */
export function AssessmentStage({
  stage,
  onContinue,
}: {
  stage: CourseStage;
  onContinue: () => void;
}) {
  const t = useTranslations("coursePlayer");
  const tHint = useTranslations("continueHint");
  const tCommon = useTranslations("common");
  const hintId = useId();
  const { state, dispatch } = useDemoState();
  const progress = state.course.assessment;
  const answers = progress.answers;

  const a = stage.assessment;
  if (!a) return null;

  const questions = a.questions;
  const { allAnswered, checked } = checkedQuiz(questions, progress);
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
        {/* Addresses in the intro are links, as the course page's read
            view shows them to editors (quick links). */}
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          <LinkedText text={a.intro} />
        </p>

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
                      aria-pressed={isSelected}
                      disabled={checked}
                      onClick={() =>
                        dispatch({
                          type: "answerAssessment",
                          questionId: q.id,
                          optionId: opt.id,
                        })
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

        {checked ? (
          <div className="mt-6 flex justify-end">
            <Button size="md" onClick={onContinue}>
              {tCommon("continue")}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          // Until the answers are checked, what Continue waits for, next to
          // the button that stands in its place. Plain text, read in page
          // order, not a live region.
          <div className="mt-6 flex flex-wrap items-center justify-end gap-x-4 gap-y-3">
            <p id={hintId} className="min-w-0 flex-1 basis-64 text-sm text-[var(--muted-foreground)] sm:text-right">
              {tHint("assessment", { button: t("checkAnswers") })}
            </p>
            <Button
              size="md"
              disabled={!allAnswered}
              aria-describedby={hintId}
              onClick={() => dispatch({ type: "checkAssessment" })}
            >
              {t("checkAnswers")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
