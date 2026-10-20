"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDemoState } from "@/store/demo-state";
import type { CourseStage, ScenarioChoice, OutcomeQuality } from "@/lib/cms/types";
import type { PartKey } from "@/lib/cms/sections/contract";
import { answersOf } from "@/lib/learner-progress/answers";
import { ArrowRight, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { FormattedText } from "./FormattedText";
import { scenarioContinueHint } from "./continue-hint";
import { mainPartOf } from "./continue-gate";
import { ContinueNote, FLAGGED_CLASS, useContinue } from "./useContinue";
import { focusThen } from "./sectioned/focus";

const RETRYING: ReadonlySet<PartKey> = new Set(["scenario/main"]);

/**
 * Branching scenario. Renders an authored tree: root choices → outcome
 * (quality-tagged) → follow-up choices → follow-up outcome. The tree comes
 * entirely from stage.scenario.choices, so any authored scenario renders.
 *
 * Release 2: the path shown is the learner's saved one (the store's
 * scenario answer) while its choices are still the scenario's, so it is
 * there again on Back and after a reload. "Try different choices" starts
 * again on this screen only — the saved path stays until a new first
 * choice replaces it — and focus goes to the heading first, as the button
 * goes. A follow-up chosen takes focus to its outcome, where the follow-up
 * buttons were. Continue is always there, with the hint above it until the path is
 * complete (useContinue); pressed early, it takes the learner to the first
 * choice or to the follow-up question.
 */
export function ScenarioStage({
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
    lessonId: "scenario",
    parts: [part],
    answers: answersOf(state.course),
    retrying: retrying ? RETRYING : undefined,
    onContinue,
  });

  // The follow-up button pressed goes once the follow-up is chosen: focus
  // goes to its outcome, where the buttons were (WCAG 2.4.3), as
  // ScenarioPart does — never to the page.
  const followupOutcomeId = useId();
  const focusFollowupOutcome = useRef(false);
  const savedFollowup = state.course.scenario.followup;
  useEffect(() => {
    if (!focusFollowupOutcome.current || !savedFollowup) return;
    focusFollowupOutcome.current = false;
    document.getElementById(followupOutcomeId)?.focus();
  }, [savedFollowup, followupOutcomeId]);

  const sc = stage.scenario;
  if (!sc) return null;

  const saved = state.course.scenario;
  const rootChoice = retrying ? undefined : sc.choices.find((c) => c.id === saved.root);
  const rootId = rootChoice?.id ?? null;
  const followups = rootChoice?.followups ?? [];
  const followupChoice = followups.find((c) => c.id === saved.followup);
  const followupId = followupChoice?.id ?? null;
  const hint = scenarioContinueHint({
    rootChosen: !!rootChoice,
    followups: followups.length,
    followupChosen: !!followupChoice,
  });

  const pickRoot = (c: ScenarioChoice) => {
    setRetrying(false);
    dispatch({ type: "recordScenarioRoot", choice: c.id, label: c.text });
  };
  const pickFollowup = (c: ScenarioChoice) => {
    focusFollowupOutcome.current = true;
    dispatch({ type: "recordScenarioFollowup", choice: c.id, label: c.text });
  };
  const headingId = cont.ids.heading("main");
  const followupQuestionId = cont.ids.followup("main");
  // The button goes once pressed: focus the heading first.
  const reset = () => focusThen(headingId, () => setRetrying(true));
  const flagged = cont.flagged !== null;

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-2">
          <Sparkles className="h-3.5 w-3.5" />
          {t("branchingScenario")}
        </div>
        <h2
          id={headingId}
          tabIndex={-1}
          aria-describedby={cont.describedBy(headingId)}
          className="text-2xl font-bold tracking-tight outline-none"
        >
          {stage.title}
        </h2>
        <ContinueNote api={cont} partId="main" />
        <div className={cn(flagged && FLAGGED_CLASS)}>
          {/* Authors type the setup and outcomes in textareas — keep their
              paragraphs and lists, like narrative text. */}
          <FormattedText
            text={sc.setup}
            className="mt-3 text-base leading-relaxed"
          />

          {/* Root choices */}
          <div className="mt-6">
            <p className="font-medium mb-3">{sc.question}</p>
            <div className="space-y-2">
              {sc.choices.map((c) => {
                const isPicked = rootId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={rootId !== null && !isPicked}
                    onClick={() => pickRoot(c)}
                    className={cn(
                      "w-full text-left rounded-lg border p-4 transition-colors text-sm sm:text-base",
                      rootId === null &&
                        "border-[var(--border)] hover:bg-[var(--surface-muted)] hover:border-[var(--accent)]/40",
                      isPicked && "border-[var(--accent)] bg-[var(--accent)]/5",
                      rootId !== null && !isPicked && "opacity-40"
                    )}
                  >
                    {c.text}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Root outcome */}
          {rootChoice ? (
            <Outcome quality={rootChoice.quality} text={rootChoice.outcome} />
          ) : null}

          {/* Follow-up choices */}
          {rootChoice && followups.length > 0 && !followupId ? (
            <div className="mt-6">
              <p
                id={followupQuestionId}
                tabIndex={-1}
                aria-describedby={cont.describedBy(followupQuestionId)}
                className="font-medium mb-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded-sm"
              >
                {sc.followupQuestion}
              </p>
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

          {/* Follow-up outcome */}
          {followupChoice ? (
            <Outcome
              id={followupOutcomeId}
              focusable
              quality={followupChoice.quality}
              text={followupChoice.outcome}
            />
          ) : null}
        </div>

        {/* Until the branch is resolved (follow-up done, or no follow-ups),
            what Continue waits for, above it: plain text, read in page
            order, not a live region. */}
        {hint ? (
          <div className="mt-6 space-y-3">
            <p id={cont.hintId} className="text-sm text-[var(--muted-foreground)] sm:text-right">
              {tHint(hint)}
            </p>
            <div className="flex justify-end">
              <Button size="md" aria-describedby={cont.hintId} onClick={cont.press}>
                {tCommon("continue")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap gap-3 justify-between">
            <Button variant="outline" size="md" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              {t("tryDifferent")}
            </Button>
            <Button size="md" onClick={cont.press}>
              {tCommon("continue")}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
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
  /** Takes focus once chosen (the follow-up's). Still a status, as the recorded walk has it. */
  focusable?: boolean;
}) {
  const t = useTranslations("coursePlayer");
  const variant =
    quality === "best" ? "success" : quality === "okay" ? "muted" : "accent";
  const label =
    quality === "best"
      ? t("qualityBest")
      : quality === "okay"
        ? t("qualityOkay")
        : t("qualityPoor");

  return (
    <div
      id={id}
      role="status"
      aria-live="polite"
      tabIndex={focusable ? -1 : undefined}
      className={cn(
        "mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4",
        focusable && "outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
          {t("whatJustHappened")}
        </span>
        <Badge variant={variant}>{label}</Badge>
      </div>
      <FormattedText text={text} className="text-sm leading-relaxed" />
    </div>
  );
}
