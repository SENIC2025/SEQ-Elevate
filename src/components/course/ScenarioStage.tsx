"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDemoState } from "@/store/demo-state";
import type { CourseStage, ScenarioChoice, OutcomeQuality } from "@/lib/cms/types";
import { ArrowRight, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Branching scenario. Renders an authored tree: root choices → outcome
 * (quality-tagged) → follow-up choices → follow-up outcome. The tree comes
 * entirely from stage.scenario.choices, so any authored scenario renders.
 */
export function ScenarioStage({
  stage,
  onContinue,
}: {
  stage: CourseStage;
  onContinue: () => void;
}) {
  const t = useTranslations("coursePlayer");
  const tCommon = useTranslations("common");
  const { dispatch } = useDemoState();
  const [rootId, setRootId] = useState<string | null>(null);
  const [followupId, setFollowupId] = useState<string | null>(null);

  const sc = stage.scenario;
  if (!sc) return null;

  const rootChoice = sc.choices.find((c) => c.id === rootId);
  const followups = rootChoice?.followups ?? [];
  const followupChoice = followups.find((c) => c.id === followupId);

  const pickRoot = (c: ScenarioChoice) => {
    setRootId(c.id);
    setFollowupId(null);
    dispatch({ type: "recordScenarioRoot", choice: c.id, label: c.text });
  };
  const pickFollowup = (c: ScenarioChoice) => {
    setFollowupId(c.id);
    dispatch({ type: "recordScenarioFollowup", choice: c.id, label: c.text });
  };
  const reset = () => {
    setRootId(null);
    setFollowupId(null);
  };

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-2">
          <Sparkles className="h-3.5 w-3.5" />
          {t("branchingScenario")}
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{stage.title}</h2>
        <p className="mt-3 text-base leading-relaxed">{sc.setup}</p>

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

        {/* Follow-up outcome */}
        {followupChoice ? (
          <Outcome
            quality={followupChoice.quality}
            text={followupChoice.outcome}
          />
        ) : null}

        {/* Continue when the branch is resolved (followup done, or no followups) */}
        {followupChoice || (rootChoice && followups.length === 0) ? (
          <div className="mt-6 flex flex-wrap gap-3 justify-between">
            <Button variant="outline" size="md" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              {t("tryDifferent")}
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

function Outcome({
  quality,
  text,
}: {
  quality: OutcomeQuality;
  text: string;
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
    <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
          {t("whatJustHappened")}
        </span>
        <Badge variant={variant}>{label}</Badge>
      </div>
      <p className="text-sm leading-relaxed">{text}</p>
    </div>
  );
}
