"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SECTION_LIMITS } from "@/lib/cms/sections/contract";
import type { Locale } from "@/lib/cms/types";
import { useDirty } from "../dirty-registry";

const MAX = SECTION_LIMITS.labelChars;
/** The counter is read out from here on (it is always visible). */
const ANNOUNCE_FROM = 35;

/**
 * A lesson's name in the content language only, inline in its row: at most
 * 40 characters (a longer one is refused, not cut), blank = the standard or
 * fallback name, which the box shows as its placeholder. Escape or Cancel
 * puts focus back on Rename. Unsaved text counts as unsaved work in this
 * language (a language switch asks first).
 */
export function RenameForm({
  dirtyId,
  dirtyLabel,
  lang,
  initial,
  placeholder,
  laterNote,
  busy,
  error,
  onSave,
  onCancel,
  announce,
}: {
  dirtyId: string;
  /** The lesson's "n. Name", for the unsaved-changes prompts. */
  dirtyLabel: string;
  lang: Locale;
  /** The lesson's own name in this language ("" when none). */
  initial: string;
  placeholder: string;
  /** On a published course: what learners keep seeing until Release 2. */
  laterNote: string | null;
  busy: boolean;
  error: string | null;
  onSave: (label: string) => void;
  onCancel: () => void;
  announce: (text: string) => void;
}) {
  const t = useTranslations("lessonList");
  const tLang = useTranslations("courseManager.languageName");
  const ids = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [value, setValue] = React.useState(initial);
  const report = useDirty(dirtyId, dirtyLabel, true);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  React.useEffect(() => {
    report(value !== initial);
  }, [report, value, initial]);
  // (Leaving — saved or cancelled — unmounts the form, which clears it: useDirty.)

  const length = value.trim().length;
  const tooLong = length > MAX;
  const counter = t("rename.counter", { count: length, max: MAX });

  function change(next: string) {
    setValue(next);
    const n = next.trim().length;
    if (n >= ANNOUNCE_FROM) {
      announce(n > MAX ? t("rename.tooLong", { max: MAX }) : t("rename.counter", { count: n, max: MAX }));
    }
  }

  const describedBy = [
    `${ids}-counter`,
    tooLong ? `${ids}-long` : null,
    error ? `${ids}-error` : null,
    laterNote ? `${ids}-later` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        if (tooLong) {
          inputRef.current?.focus();
          return;
        }
        onSave(value.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <label htmlFor={`${ids}-input`} className="block text-xs font-medium">
        {t("rename.label", { language: tLang(lang) })}
      </label>
      <input
        id={`${ids}-input`}
        ref={inputRef}
        lang={lang}
        value={value}
        placeholder={placeholder}
        onChange={(e) => change(e.target.value)}
        aria-invalid={tooLong || error ? true : undefined}
        aria-describedby={describedBy}
        className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--foreground)] aria-[invalid=true]:border-[var(--danger)]"
      />
      <p
        id={`${ids}-counter`}
        className={`text-right text-xs tabular-nums ${tooLong ? "text-[var(--danger)]" : "text-[var(--muted-foreground)]"}`}
      >
        {counter}
      </p>
      {tooLong ? (
        <p id={`${ids}-long`} className="flex items-start gap-1.5 text-xs text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          {t("rename.tooLong", { max: MAX })}
        </p>
      ) : null}
      {laterNote ? (
        <p id={`${ids}-later`} className="flex items-start gap-1.5 text-xs text-[var(--muted-foreground)]">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)]" aria-hidden />
          {laterNote}
        </p>
      ) : null}
      {error ? (
        <p id={`${ids}-error`} role="alert" className="flex items-start gap-1.5 text-xs text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" aria-disabled={busy || tooLong || undefined}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {t("rename.save")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {t("rename.cancel")}
        </Button>
      </div>
    </form>
  );
}
