"use client";

import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { useDemoState } from "@/store/demo-state";
import { CompCardPrint } from "./CompCardPrint";
import {
  Printer,
  Save,
  Lock,
  Eye,
  Users as UsersIcon,
  CheckCircle2,
  ChevronLeft,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function CompCard() {
  const t = useTranslations("compCard");
  const tCourse = useTranslations("course.workplaceConflict");
  const tScenario = useTranslations("course.workplaceConflict.scenario");
  const locale = useLocale();

  const { state, dispatch } = useDemoState();
  const c = state.compCard;
  const set = (patch: Partial<typeof c>) =>
    dispatch({ type: "updateCompCard", patch });

  const hasScenarioEvidence =
    state.course.scenario.root && state.course.scenario.followup;

  const courseTitle = tCourse("title");
  const scenarioSummary = hasScenarioEvidence
    ? `${tScenario(`choices.${state.course.scenario.root}`)} → ${tScenario(`followup.${state.course.scenario.followup}`)}`
    : "—";

  const dateStr = c.updatedAt
    ? new Date(c.updatedAt).toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : new Date().toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

  return (
    <>
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <Link
          href="/learner"
          className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-3"
        >
          <ChevronLeft className="h-4 w-4" />
          Dashboard
        </Link>

        <Card>
          <CardContent className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  SEQ Comp Card
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  {t("title")}
                </h1>
                <p className="text-sm text-[var(--muted-foreground)] mt-1">
                  {t("subtitle")}
                </p>
              </div>
              {c.updatedAt ? (
                <Badge variant="success" className="text-xs">
                  <CheckCircle2 className="h-3 w-3" />
                  {t("saved")}
                </Badge>
              ) : null}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
                  {t("courseLabel")}
                </p>
                <p className="font-medium">{courseTitle}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
                  {t("dateLabel")}
                </p>
                <p className="font-medium">{dateStr}</p>
              </div>
            </div>

            {/* Evidence pulled from scenario */}
            {hasScenarioEvidence ? (
              <div className="mt-5 rounded-lg border border-[var(--accent)]/20 bg-[var(--accent)]/5 p-4">
                <p className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-1">
                  {t("evidencePulled")}
                </p>
                <p className="text-sm leading-snug font-medium">
                  {t("fieldScenario")}
                </p>
                <p className="text-sm mt-0.5">{scenarioSummary}</p>
              </div>
            ) : null}

            {/* Form fields */}
            <div className="mt-6 space-y-5">
              <Field
                label={t("fieldWentWell")}
                value={c.wentWell}
                placeholder={t("placeholder.wentWell")}
                onChange={(v) => set({ wentWell: v })}
              />
              <Field
                label={t("fieldDifficult")}
                value={c.difficult}
                placeholder={t("placeholder.difficult")}
                onChange={(v) => set({ difficult: v })}
              />
              <Field
                label={t("fieldImprove")}
                value={c.improve}
                placeholder={t("placeholder.improve")}
                onChange={(v) => set({ improve: v })}
              />
              <Field
                label={t("fieldBehaviour")}
                value={c.behaviour}
                placeholder={t("placeholder.behaviour")}
                onChange={(v) => set({ behaviour: v })}
              />

              {/* Confidence */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("fieldConfidence")}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => set({ confidence: n })}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm min-w-[3rem]",
                        c.confidence === n
                          ? "border-[var(--primary-hover)] bg-[var(--primary)] text-[var(--primary-foreground)] font-medium"
                          : "border-[var(--border)] hover:bg-[var(--surface-muted)]"
                      )}
                      aria-pressed={c.confidence === n}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">
                  {t(`confidenceLabels.${c.confidence}`)}
                </p>
              </div>

              {/* Privacy */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("privacyLabel")}
                </label>
                <div className="space-y-1.5">
                  {(["self", "facilitator", "facilitatorAndMentor"] as const).map(
                    (p) => {
                      const Icon =
                        p === "self"
                          ? Lock
                          : p === "facilitator"
                            ? Eye
                            : UsersIcon;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => set({ privacy: p })}
                          className={cn(
                            "w-full text-left rounded-lg border px-4 py-3 flex items-center gap-3 text-sm",
                            c.privacy === p
                              ? "border-[var(--primary)] bg-[var(--accent)]/5"
                              : "border-[var(--border)] hover:bg-[var(--surface-muted)]"
                          )}
                          aria-pressed={c.privacy === p}
                        >
                          <Icon
                            className={cn(
                              "h-4 w-4 flex-shrink-0",
                              c.privacy === p
                                ? "text-[var(--accent)]"
                                : "text-[var(--muted-foreground)]"
                            )}
                          />
                          <span>{t(`privacyChoice.${p}`)}</span>
                        </button>
                      );
                    }
                  )}
                </div>
              </div>
            </div>

            <div className="mt-7 flex flex-wrap gap-3 justify-between">
              <Button
                variant="primary"
                size="md"
                onClick={() => set({})}
              >
                <Save className="h-4 w-4" />
                {t("saved")}
              </Button>
              <Button
                variant="accent"
                size="md"
                onClick={() => window.print()}
              >
                <Printer className="h-4 w-4" />
                {t("printPdf")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Hidden, only visible in print */}
      <CompCardPrint
        courseTitle={courseTitle}
        dateStr={dateStr}
        scenarioSummary={scenarioSummary}
        compCard={c}
      />
    </>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
      />
    </div>
  );
}
