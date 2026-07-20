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
import type { CompCardTemplate } from "@/lib/cms/types";

export function CompCard({
  template,
}: {
  /**
   * Field wording resolved server-side (bundled copy + the editor's CMS
   * override). Absent = fall back to the message catalogue, which keeps the
   * component usable in isolation (storybook, tests).
   */
  template?: CompCardTemplate;
}) {
  const t = useTranslations("compCard");
  const locale = useLocale();

  const { state, dispatch } = useDemoState();
  const c = state.compCard;
  const set = (patch: Partial<typeof c>) =>
    dispatch({ type: "updateCompCard", patch });

  // Template-driven wording, with the bundled copy as the fallback.
  const tpl = template?.fields;
  const field = (key: string) => tpl?.find((f) => f.key === key);
  const shown = (key: string) => (tpl ? Boolean(field(key)) : true);
  const labelFor = (key: string, fallback: string) =>
    field(key)?.label ?? fallback;
  const placeholderFor = (key: string, fallback: string) =>
    field(key)?.placeholder ?? fallback;
  // Editors may reorder; without a template keep the canonical order.
  const textKeys = tpl
    ? tpl.filter((f) => f.kind !== "confidence").map((f) => f.key)
    : ["wentWell", "difficult", "improve", "behaviour"];

  // Evidence + course title come from what the learner actually did
  // (stored when they played), so the Comp Card is course-agnostic.
  const sc = state.course.scenario;
  const hasScenarioEvidence = sc.rootLabel && sc.followupLabel;

  const courseTitle = state.course.courseTitle ?? "—";
  const scenarioSummary = hasScenarioEvidence
    ? `${sc.rootLabel} → ${sc.followupLabel}`
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
              {textKeys.map((key) => {
                // Each key maps to a real CompCard column — the template can
                // reword and reorder these, never invent new ones.
                const defaults: Record<
                  string,
                  { label: string; placeholder: string; value: string }
                > = {
                  wentWell: {
                    label: t("fieldWentWell"),
                    placeholder: t("placeholder.wentWell"),
                    value: c.wentWell,
                  },
                  difficult: {
                    label: t("fieldDifficult"),
                    placeholder: t("placeholder.difficult"),
                    value: c.difficult,
                  },
                  improve: {
                    label: t("fieldImprove"),
                    placeholder: t("placeholder.improve"),
                    value: c.improve,
                  },
                  behaviour: {
                    label: t("fieldBehaviour"),
                    placeholder: t("placeholder.behaviour"),
                    value: c.behaviour,
                  },
                };
                const d = defaults[key];
                if (!d) return null;
                return (
                  <Field
                    key={key}
                    label={labelFor(key, d.label)}
                    value={d.value}
                    placeholder={placeholderFor(key, d.placeholder)}
                    onChange={(v) => set({ [key]: v } as Partial<typeof c>)}
                  />
                );
              })}

              {/* Confidence */}
              <div hidden={!shown("confidence")}>
                <label className="block text-sm font-medium mb-2">
                  {labelFor("confidence", t("fieldConfidence"))}
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
        template={template}
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
