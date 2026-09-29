import { getTranslations } from "next-intl/server";
import { Check, Circle, CircleDashed, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CONTENT_LOCALES,
  type LanguageCoverage,
  type LanguageState,
} from "@/lib/cms/course-admin-types";
import type { Locale } from "@/lib/cms/types";

// The state is carried by the icon's SHAPE and the screen-reader text, never
// by colour alone (WCAG 1.4.1). The tints are only a second cue.
const ICON: Record<LanguageState, LucideIcon> = {
  complete: Check,
  partial: CircleDashed,
  missing: Circle,
};

const STYLE: Record<LanguageState, string> = {
  complete:
    "border-[var(--success)]/30 bg-[var(--success)]/10 text-[var(--success)]",
  partial:
    "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]",
  missing:
    "border-dashed border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted-foreground)]",
};

/**
 * One chip per content language — "EN ✓", "DE 3/7", "EL ○" — saying how far
 * a course is written in it. Screen readers hear "German: 3 of 7 lessons".
 */
export async function LanguageChips({
  languages,
}: {
  languages: Record<Locale, LanguageCoverage>;
}) {
  const t = await getTranslations("courseManager");

  return (
    <ul className="flex flex-wrap gap-1.5">
      {CONTENT_LOCALES.map((locale) => {
        const { state, covered, total } = languages[locale];
        const Icon = ICON[state];
        const stateText =
          state === "partial"
            ? t("grid.lang.partial", { covered, total })
            : t(`grid.lang.${state}`);
        return (
          <li
            key={locale}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
              STYLE[state]
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span aria-hidden>{locale.toUpperCase()}</span>
            {state === "partial" ? (
              <span aria-hidden className="tabular-nums">
                {covered}/{total}
              </span>
            ) : null}
            <span className="sr-only">
              {t("grid.lang.label", {
                language: t(`languageName.${locale}`),
                state: stateText,
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
