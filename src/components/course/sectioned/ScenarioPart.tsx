"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OutcomeQuality, ScenarioChoice } from "@/lib/cms/types";
import { FormattedText } from "../FormattedText";
import { scenarioContinueHint } from "../continue-hint";
import type { PartProps } from "./part-props";
import { focusThen } from "./focus";

/**
 * A branching scenario, as the learner player's applied scenario shows it:
 * a first choice and its outcome, then the follow-up question when that
 * choice has one. Answered into the preview's own state.
 *
 * Focus never drops to the page when a pressed button goes: after a
 * follow-up choice it moves to that choice's outcome (shown where the
 * follow-up buttons were); "Try different choices" moves it to the part's
 * heading first.
 */
export function ScenarioPart({ part, answer, onAnswer, headingId }: PartProps<"scenario">) {
  const t = useTranslations("coursePlayer");
  const tHint = useTranslations("continueHint");
  const sc = part.scenario;
  const picked = answer?.type === "scenario" ? answer : undefined;
  const rootChoice = sc.choices.find((c) => c.id === picked?.rootId);
  const followups = rootChoice?.followups ?? [];
  const followupChoice = followups.find((c) => c.id === picked?.followupId);
  const hint = scenarioContinueHint({
    rootChosen: !!rootChoice,
    followups: followups.length,
    followupChosen: !!followupChoice,
  });

  const followupOutcomeId = useId();
  // Set by a follow-up choice; the outcome takes focus once it's there.
  const focusFollowupOutcome = useRef(false);
  useEffect(() => {
    if (!focusFollowupOutcome.current || !followupChoice) return;
    focusFollowupOutcome.current = false;
    document.getElementById(followupOutcomeId)?.focus();
  }, [followupChoice, followupOutcomeId]);

  const pickRoot = (c: ScenarioChoice) => onAnswer({ type: "scenario", rootId: c.id });
  const pickFollowup = (c: ScenarioChoice) => {
    if (!rootChoice) return;
    focusFollowupOutcome.current = true;
    onAnswer({ type: "scenario", rootId: rootChoice.id, followupId: c.id });
  };

  return (
    <div>
      <FormattedText text={sc.setup} className="text-base leading-relaxed" />

      <div className="mt-4">
        <p className="font-medium mb-3">{sc.question}</p>
        <div className="space-y-2">
          {sc.choices.map((c) => {
            const isPicked = rootChoice?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={isPicked}
                disabled={!!rootChoice && !isPicked}
                onClick={() => {
                  if (!rootChoice) pickRoot(c);
                }}
                className={cn(
                  "w-full text-left rounded-lg border p-4 transition-colors text-sm sm:text-base",
                  !rootChoice &&
                    "border-[var(--border)] hover:bg-[var(--surface-muted)] hover:border-[var(--accent)]/40",
                  isPicked && "border-[var(--accent)] bg-[var(--accent)]/5",
                  !!rootChoice && !isPicked && "opacity-40"
                )}
              >
                {c.text}
              </button>
            );
          })}
        </div>
      </div>

      {rootChoice ? <Outcome quality={rootChoice.quality} text={rootChoice.outcome} /> : null}

      {rootChoice && followups.length > 0 && !followupChoice ? (
        <div className="mt-4">
          <p className="font-medium mb-3">{sc.followupQuestion}</p>
          <div className="space-y-2">
            {followups.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pickFollowup(c)}
                className="w-full text-left rounded-lg border border-[var(--border)] p-4 hover:bg-[var(--surface-muted)] hover:border-[var(--accent)]/40 transition-colors text-sm sm:text-base"
              >
                {c.text}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {followupChoice ? (
        // Not a live region: it takes focus when chosen, which reads it.
        <Outcome
          id={followupOutcomeId}
          focusable
          quality={followupChoice.quality}
          text={followupChoice.outcome}
        />
      ) : null}

      {hint && sc.choices.length > 0 ? (
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">{tHint(hint)}</p>
      ) : null}
      {rootChoice ? (
        <div className="mt-4">
          <Button variant="outline" size="md" onClick={() => focusThen(headingId, () => onAnswer(undefined))}>
            <RotateCcw aria-hidden className="h-4 w-4" />
            {t("tryDifferent")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Outcome({
  quality,
  text,
  id,
  focusable = false,
}: {
  quality: OutcomeQuality;
  text: string;
  id?: string;
  /** Takes focus instead of announcing itself as a live region. */
  focusable?: boolean;
}) {
  const t = useTranslations("coursePlayer");
  const variant = quality === "best" ? "success" : quality === "okay" ? "muted" : "accent";
  const label =
    quality === "best" ? t("qualityBest") : quality === "okay" ? t("qualityOkay") : t("qualityPoor");
  return (
    <div
      id={id}
      {...(focusable ? { tabIndex: -1 } : { role: "status", "aria-live": "polite" as const })}
      className={cn(
        "mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4",
        focusable && "outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
          {t("whatJustHappened")}
        </span>
        <Badge variant={variant}>{label}</Badge>
      </div>
      <FormattedText text={text} className="text-sm leading-relaxed" />
    </div>
  );
}
