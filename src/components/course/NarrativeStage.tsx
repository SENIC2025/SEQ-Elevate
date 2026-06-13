"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Quote } from "lucide-react";

export function NarrativeStage({
  stage,
  onContinue,
}: {
  stage: "context" | "concept" | "behaviour";
  onContinue: () => void;
}) {
  const t = useTranslations(`course.workplaceConflict.${stage}`);
  const tStage = useTranslations("course.stageSubtitle");

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        <p className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-1">
          {tStage(stage)}
        </p>
        <h2 className="text-2xl font-bold tracking-tight">{t("title")}</h2>

        {stage === "context" ? (
          <>
            <p className="mt-4 text-base leading-relaxed">{t("narrative")}</p>
            <p className="mt-4 text-sm text-[var(--muted-foreground)] italic">
              {t("anchor")}
            </p>
          </>
        ) : null}

        {stage === "concept" ? (
          <>
            <p className="mt-4 text-base leading-relaxed">{t("body1")}</p>
            <p className="mt-3 text-base leading-relaxed">{t("body2")}</p>
            <ol className="mt-3 space-y-2 list-decimal pl-5 marker:text-[var(--accent)] marker:font-semibold">
              <li className="text-base">{t("point1")}</li>
              <li className="text-base">{t("point2")}</li>
            </ol>
            <p className="mt-3 text-base leading-relaxed">{t("body3")}</p>
          </>
        ) : null}

        {stage === "behaviour" ? (
          <>
            <p className="mt-4 text-base leading-relaxed">{t("intro")}</p>
            <p className="mt-3 inline-block rounded-lg bg-[var(--primary)]/10 border border-[var(--accent)]/20 px-4 py-3 font-medium text-[var(--accent)]">
              {t("formula")}
            </p>
            <p className="mt-5 text-sm font-medium text-[var(--muted-foreground)]">
              {t("compareLabel")}
            </p>
            <div className="mt-3 grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 p-4">
                <p className="text-xs uppercase tracking-wider font-semibold text-[var(--warning)] mb-1.5 flex items-center gap-1">
                  <Quote className="h-3 w-3" />
                  {t("blamingLabel")}
                </p>
                <p className="text-sm leading-relaxed">{t("blaming")}</p>
              </div>
              <div className="rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/5 p-4">
                <p className="text-xs uppercase tracking-wider font-semibold text-[var(--success)] mb-1.5 flex items-center gap-1">
                  <Quote className="h-3 w-3" />
                  {t("iStatementLabel")}
                </p>
                <p className="text-sm leading-relaxed">{t("iStatement")}</p>
              </div>
            </div>
            <p className="mt-5 text-base leading-relaxed">{t("closing")}</p>
          </>
        ) : null}

        <div className="mt-6 flex justify-end">
          <Button size="md" onClick={onContinue}>
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
