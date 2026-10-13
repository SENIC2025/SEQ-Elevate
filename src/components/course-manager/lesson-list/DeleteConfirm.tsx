"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeleteSummary } from "@/lib/cms/sections/contract";

/** The lines of "This removes:", from what the server counted (deleteSummary). */
export function deleteLines(
  summary: DeleteSummary,
  t: (key: string, values?: Record<string, string | number>) => string,
  languageNames: string[],
  listFormat: (items: string[]) => string
): string[] {
  const lines: string[] = [];
  if (summary.languages.length) {
    lines.push(t("delete.textIn", { languages: listFormat(languageNames) }));
  }
  if (summary.textBlocks) lines.push(t("delete.textItems", { count: summary.textBlocks }));
  if (summary.questionBlocks) lines.push(t("delete.questions", { count: summary.questionBlocks }));
  if (summary.video) lines.push(t("delete.video"));
  if (summary.documents) lines.push(t("delete.documents", { count: summary.documents }));
  return lines;
}

/**
 * "Delete “Wrap-up” in all languages?" inline in the lesson's row (the
 * pattern of PublishControls' unpublish confirm): its heading takes focus,
 * it lists everything that goes with the lesson, and "Keep it" is one Tab
 * away from "Delete lesson".
 */
export function DeleteConfirm({
  name,
  summary,
  busy,
  error,
  onConfirm,
  onKeep,
}: {
  name: string;
  summary: DeleteSummary;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const t = useTranslations("lessonList");
  const tLang = useTranslations("courseManager.languageName");
  const locale = useLocale();
  const ids = React.useId();
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const listFormat = (items: string[]) => {
    try {
      return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
    } catch {
      return items.join(", ");
    }
  };
  const lines = deleteLines(
    summary,
    (k, v) => t(k, v),
    summary.languages.map((l) => tLang(l)),
    listFormat
  );

  return (
    <div
      role="group"
      aria-labelledby={`${ids}-h`}
      className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onKeep();
        }
      }}
    >
      <h3 id={`${ids}-h`} ref={headingRef} tabIndex={-1} className="text-sm font-semibold">
        {t("delete.title", { name })}
      </h3>
      {lines.length ? (
        <>
          <p className="mt-1 text-xs">{t("delete.removes")}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-xs">{t("delete.nothing")}</p>
      )}
      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="danger"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onConfirm();
          }}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="h-4 w-4" aria-hidden />
          )}
          {t("delete.confirm")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onKeep}>
          {t("delete.keep")}
        </Button>
      </div>
    </div>
  );
}
