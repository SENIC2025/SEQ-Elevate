"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { answerQuestion, checkedQuiz } from "@/lib/assessment-progress";
import { LinkedText } from "@/components/rich-text/RichTextView";
import type { PartProps } from "./part-props";

/**
 * A quick check, as the learner player shows one: choose an answer per
 * question, "Check answers", see the score, "Try again". The answers are
 * this part's own (keyed by partKey in the player), so two quick checks
 * in one lesson never share them, even with the same question ids. A
 * quick check with no questions yet shows its intro and nothing to check
 * — no score of 0 out of 0.
 */
export function QuizPart({ part, answer, onAnswer, headingId }: PartProps<"quiz">) {
  const t = useTranslations("coursePlayer");
  const tHint = useTranslations("continueHint");
  const hintId = useId();
  const groupId = useId();
  const a = part.assessment;
  const questions = a.questions;
  const progress =
    answer?.type === "quiz"
      ? { answers: answer.answers, checked: answer.checked }
      : { answers: {} as Record<string, string>, checked: false };
  const { allAnswered, checked } = checkedQuiz(questions, progress);
  const total = questions.length;
  const correct = questions.reduce(
    (n, q) => (progress.answers[q.id] === q.correctOptionId ? n + 1 : n),
    0
  );
  const ratio = total > 0 ? correct / total : 0;
  const encouragement =
    ratio === 1
      ? t("encouragementAll")
      : ratio >= 0.6
        ? t("encouragementMost")
        : ratio > 0
          ? t("encouragementSome")
          : t("encouragementNone");

  const choose = (questionId: string, optionId: string) => {
    const next = answerQuestion(progress, questionId, optionId);
    onAnswer({ type: "quiz", answers: next.answers, checked: false });
  };

  return (
    <div>
      {a.intro ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          <LinkedText text={a.intro} />
        </p>
      ) : null}

      {total > 0 ? (
        <div className="mt-4 space-y-6">
          {questions.map((q, idx) => {
            const qId = `${groupId}-q${idx}`;
            return (
              <div key={q.id} role="group" aria-labelledby={qId}>
                <p id={qId} className="font-medium mb-3">
                  <span className="text-[var(--muted-foreground)] mr-2">{idx + 1}.</span>
                  {q.question}
                </p>
                <div className="space-y-1.5">
                  {q.options.map((opt, i) => {
                    const isSelected = progress.answers[q.id] === opt.id;
                    const isCorrect = opt.id === q.correctOptionId;
                    const showResult = checked && isSelected;
                    const showCorrectAfterWrong =
                      checked && !isSelected && isCorrect && progress.answers[q.id] !== q.correctOptionId;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={isSelected}
                        disabled={checked}
                        onClick={() => choose(q.id, opt.id)}
                        className={cn(
                          "w-full text-left rounded-lg border px-4 py-3 transition-colors text-sm sm:text-base flex items-start gap-3",
                          !checked && isSelected && "border-[var(--accent)] bg-[var(--accent)]/5",
                          !checked && !isSelected && "border-[var(--border)] hover:bg-[var(--surface-muted)]",
                          showResult && isCorrect && "border-[var(--success)] bg-[var(--success)]/10",
                          showResult && !isCorrect && "border-[var(--warning)] bg-[var(--warning)]/10",
                          showCorrectAfterWrong && "border-[var(--success)]/60 bg-[var(--success)]/5"
                        )}
                      >
                        {showResult ? (
                          isCorrect ? (
                            <CheckCircle2 aria-hidden className="h-5 w-5 mt-0.5 text-[var(--success)] flex-shrink-0" />
                          ) : (
                            <XCircle aria-hidden className="h-5 w-5 mt-0.5 text-[var(--warning)] flex-shrink-0" />
                          )
                        ) : (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "mt-0.5 h-5 w-5 rounded-full border flex items-center justify-center flex-shrink-0 text-[10px] font-semibold uppercase",
                              isSelected
                                ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                                : "border-[var(--border)] text-[var(--muted-foreground)]"
                            )}
                          >
                            {String.fromCharCode(65 + i)}
                          </span>
                        )}
                        <span>{opt.text}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {checked && total > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 rounded-lg bg-[var(--accent)]/5 border border-[var(--accent)]/20 p-4"
        >
          <p className="font-semibold text-[var(--accent)]">{t("score", { correct, total })}</p>
          <p className="mt-1 text-sm">{encouragement}</p>
        </div>
      ) : null}

      {total === 0 ? null : checked ? (
        <div className="mt-4">
          <Button
            variant="outline"
            size="md"
            onClick={() => {
              // Focus first, while this button still has it: it goes once
              // the quiz reopens. The editor starts again from the top.
              document.getElementById(headingId)?.focus();
              onAnswer({ type: "quiz", answers: {}, checked: false });
            }}
          >
            <RotateCcw aria-hidden className="h-4 w-4" />
            {t("tryAgain")}
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <Button
            size="md"
            variant="outline"
            disabled={!allAnswered}
            aria-describedby={hintId}
            onClick={() => onAnswer({ type: "quiz", answers: progress.answers, checked: true })}
          >
            {t("checkAnswers")}
          </Button>
          <p id={hintId} className="min-w-0 flex-1 basis-64 text-sm text-[var(--muted-foreground)]">
            {tHint("assessment", { button: t("checkAnswers") })}
          </p>
        </div>
      )}
    </div>
  );
}
