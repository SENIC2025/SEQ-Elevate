"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  SCENARIO_ROOT_CHOICES,
  SCENARIO_FOLLOWUP,
  SCENARIO_OUTCOME_QUALITY,
  type ScenarioRootChoice,
} from "@/data/course";
import { useDemoState } from "@/store/demo-state";
import { ArrowRight, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function ScenarioStage({ onContinue }: { onContinue: () => void }) {
  const t = useTranslations("course.workplaceConflict.scenario");
  const { dispatch } = useDemoState();
  const [rootChoice, setRootChoice] = useState<ScenarioRootChoice | null>(null);
  const [followupChoice, setFollowupChoice] = useState<string | null>(null);

  const pickRoot = (c: ScenarioRootChoice) => {
    setRootChoice(c);
    dispatch({ type: "recordScenarioRoot", choice: c });
  };

  const pickFollowup = (c: string) => {
    setFollowupChoice(c);
    dispatch({ type: "recordScenarioFollowup", choice: c });
  };

  const reset = () => {
    setRootChoice(null);
    setFollowupChoice(null);
  };

  const followupOptions = rootChoice ? SCENARIO_FOLLOWUP[rootChoice] : [];

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-2">
          <Sparkles className="h-3.5 w-3.5" />
          Branching scenario
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{t("title")}</h2>
        <p className="mt-3 text-base leading-relaxed">{t("setup")}</p>

        {/* Root choice */}
        <div className="mt-6">
          <p className="font-medium mb-3">{t("question")}</p>
          <div className="space-y-2">
            {SCENARIO_ROOT_CHOICES.map((c) => {
              const isPicked = rootChoice === c;
              return (
                <button
                  key={c}
                  type="button"
                  disabled={rootChoice !== null && !isPicked}
                  onClick={() => pickRoot(c)}
                  className={cn(
                    "w-full text-left rounded-lg border p-4 transition-colors",
                    rootChoice === null &&
                      "border-[var(--border)] hover:bg-[var(--surface-muted)] hover:border-[var(--primary)]/40",
                    isPicked &&
                      "border-[var(--primary)] bg-[var(--accent)]/5",
                    rootChoice !== null && !isPicked && "opacity-40"
                  )}
                >
                  <span className="text-sm sm:text-base">
                    {t(`choices.${c}`)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Outcome of root choice */}
        {rootChoice ? (
          <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
                {t("summaryLabel")}
              </span>
              <QualityBadge quality={SCENARIO_OUTCOME_QUALITY[rootChoice]} />
            </div>
            <p className="text-sm leading-relaxed">
              {t(`outcomes.${rootChoice}`)}
            </p>
          </div>
        ) : null}

        {/* Follow-up choice */}
        {rootChoice && !followupChoice ? (
          <div className="mt-6">
            <p className="font-medium mb-3">{t("followupQ")}</p>
            <div className="space-y-2">
              {followupOptions.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => pickFollowup(c)}
                  className="w-full text-left rounded-lg border border-[var(--border)] p-4 hover:bg-[var(--surface-muted)] hover:border-[var(--primary)]/40 transition-colors text-sm sm:text-base"
                >
                  {t(`followup.${c}`)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Follow-up outcome */}
        {followupChoice ? (
          <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
                {t("summaryLabel")}
              </span>
              <QualityBadge
                quality={SCENARIO_OUTCOME_QUALITY[followupChoice]}
              />
            </div>
            <p className="text-sm leading-relaxed">
              {t(`followupOutcomes.${followupChoice}`)}
            </p>
          </div>
        ) : null}

        {followupChoice ? (
          <div className="mt-6 flex flex-wrap gap-3 justify-between">
            <Button variant="outline" size="md" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              Try different choices
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

function QualityBadge({ quality }: { quality: "best" | "okay" | "poor" }) {
  const t = useTranslations("course.workplaceConflict.scenario");
  const variant =
    quality === "best" ? "success" : quality === "okay" ? "muted" : "accent";
  const labelKey =
    quality === "best"
      ? "qualityBest"
      : quality === "okay"
        ? "qualityOkay"
        : "qualityPoor";
  return <Badge variant={variant}>{t(labelKey)}</Badge>;
}
