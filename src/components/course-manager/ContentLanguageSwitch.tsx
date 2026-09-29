"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Circle, CircleDashed } from "lucide-react";
import {
  CONTENT_LOCALES,
  type LanguageCoverage,
} from "@/lib/cms/course-admin-types";
import type { Locale } from "@/lib/cms/types";

const ICON = { complete: Check, partial: CircleDashed, missing: Circle };

/**
 * The one "which language am I writing in" switch for the whole course page
 * (title, lesson texts, interactive stages). Each button also says how far
 * the course is written in that language — by icon and by text for screen
 * readers, never by colour alone.
 */
export function ContentLanguageSwitch({
  lang,
  languages,
  onChange,
  trailing,
}: {
  lang: Locale;
  languages: Record<Locale, LanguageCoverage>;
  onChange: (next: Locale) => void;
  /** Shown beside the buttons, e.g. the preview link. */
  trailing?: React.ReactNode;
}) {
  const t = useTranslations("courseManager");
  const ids = React.useId();

  const stateText = (c: LanguageCoverage) =>
    c.state === "partial"
      ? t("grid.lang.partial", { covered: c.covered, total: c.total })
      : t(`grid.lang.${c.state}`);

  return (
    <div>
      <p id={`${ids}-label`} className="mb-1 text-xs font-medium">
        {t("page.contentLanguage")}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-labelledby={`${ids}-label`}
          aria-describedby={`${ids}-hint`}
          className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5"
        >
          {CONTENT_LOCALES.map((l) => {
            const coverage = languages[l];
            const Icon = ICON[coverage.state];
            const active = l === lang;
            return (
              <button
                key={l}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(l)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                  active
                    ? "bg-[var(--accent)] font-medium text-[var(--accent-foreground)]"
                    : "text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
                }`}
              >
                <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                <span aria-hidden>{t(`languageName.${l}`)}</span>
                <span className="sr-only">
                  {t("grid.lang.label", {
                    language: t(`languageName.${l}`),
                    state: stateText(coverage),
                  })}
                </span>
              </button>
            );
          })}
        </div>
        {trailing}
      </div>
      <p
        id={`${ids}-hint`}
        className="mt-1 max-w-xs text-xs text-[var(--muted-foreground)]"
      >
        {t("page.contentLanguageHint")}
      </p>
    </div>
  );
}
