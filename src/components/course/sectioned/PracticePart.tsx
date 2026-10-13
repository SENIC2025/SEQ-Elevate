"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { LinkedText } from "@/components/rich-text/RichTextView";
import { FormattedText } from "../FormattedText";
import type { PartProps } from "./part-props";
import { focusThen } from "./focus";

/**
 * A practice question (choose a response), as the learner player's guided
 * practice shows it, but answered into the preview's own state: picking an
 * option shows its feedback, "Try another" clears it (focus goes to the
 * heading first: the button goes). No Continue here —
 * the lesson has one for all its content.
 */
export function PracticePart({ part, answer, onAnswer, headingId }: PartProps<"practice">) {
  const t = useTranslations("coursePlayer");
  const tHint = useTranslations("continueHint");
  const sim = part.simulation;
  const selected =
    answer?.type === "practice" && sim.options.some((o) => o.id === answer.optionId)
      ? answer.optionId
      : null;
  const selectedOpt = sim.options.find((o) => o.id === selected);
  const showFeedback = selected !== null;
  const isCorrect = !!selectedOpt?.isBest;

  return (
    <div>
      <FormattedText text={sim.prompt} className="text-base leading-relaxed" />
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        <LinkedText text={sim.instruction} />
      </p>

      <div className="mt-4 space-y-2">
        {sim.options.map((opt) => {
          const isSelected = selected === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={isSelected}
              disabled={showFeedback && !isSelected}
              onClick={() => {
                if (!showFeedback) onAnswer({ type: "practice", optionId: opt.id });
              }}
              className={cn(
                "w-full text-left rounded-lg border p-4 transition-colors",
                !showFeedback &&
                  "border-[var(--border)] hover:bg-[var(--surface-muted)] hover:border-[var(--accent)]/40",
                isSelected && opt.isBest && "border-[var(--success)] bg-[var(--success)]/5",
                isSelected && !opt.isBest && "border-[var(--warning)] bg-[var(--warning)]/5",
                showFeedback && !isSelected && "opacity-50"
              )}
            >
              <span className="flex items-start gap-3">
                {isSelected ? (
                  opt.isBest ? (
                    <CheckCircle2 aria-hidden className="h-5 w-5 mt-0.5 text-[var(--success)] flex-shrink-0" />
                  ) : (
                    <XCircle aria-hidden className="h-5 w-5 mt-0.5 text-[var(--warning)] flex-shrink-0" />
                  )
                ) : (
                  <span aria-hidden className="mt-0.5 h-5 w-5 rounded-full border border-[var(--border)] flex-shrink-0" />
                )}
                <span className="text-sm sm:text-base leading-relaxed">{opt.text}</span>
              </span>
            </button>
          );
        })}
      </div>

      {showFeedback && selectedOpt ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "mt-4 rounded-lg p-4 border-l-4",
            isCorrect
              ? "border-l-[var(--success)] bg-[var(--success)]/5"
              : "border-l-[var(--warning)] bg-[var(--warning)]/5"
          )}
        >
          <p className="text-sm leading-relaxed">{selectedOpt.feedback}</p>
        </div>
      ) : null}

      {showFeedback ? (
        <div className="mt-4">
          <Button variant="outline" size="md" onClick={() => focusThen(headingId, () => onAnswer(undefined))}>
            <RotateCcw aria-hidden className="h-4 w-4" />
            {t("tryAnother")}
          </Button>
        </div>
      ) : sim.options.length > 0 ? (
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">{tHint("simulation")}</p>
      ) : null}
    </div>
  );
}
