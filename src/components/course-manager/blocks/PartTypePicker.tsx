"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import type { PartType } from "@/lib/cms/sections/contract";
import { PART_TYPES } from "./part-list";

/**
 * The kinds of content "Add content" offers, as a plain list of buttons
 * (not an ARIA menu — Tab and Enter work as everywhere else; the pattern of
 * BlockTemplatePicker). Focus moves to the first one when it opens; Escape
 * closes it and the opener takes focus back (the parent does that in
 * `onClose`).
 */
export function PartTypePicker({
  id,
  onPick,
  onClose,
}: {
  id: string;
  onPick: (type: PartType) => void;
  onClose: () => void;
}) {
  const t = useTranslations("lessonBlocks");
  const ids = React.useId();
  const firstRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    firstRef.current?.focus();
  }, []);

  return (
    <div
      id={id}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-2"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="px-2 pb-1.5 text-xs text-[var(--muted-foreground)]">{t("picker")}</p>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {PART_TYPES.map((type, i) => (
          <li key={type}>
            <button
              ref={i === 0 ? firstRef : undefined}
              type="button"
              onClick={() => onPick(type)}
              // Named by the type alone; the hint is read as its description.
              aria-labelledby={`${ids}-${type}-label`}
              aria-describedby={`${ids}-${type}-hint`}
              className="h-full min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/5"
            >
              <span id={`${ids}-${type}-label`} className="block text-sm font-medium">
                {t(`types.${type}`)}
              </span>
              <span
                id={`${ids}-${type}-hint`}
                className="mt-0.5 block text-xs text-[var(--muted-foreground)]"
              >
                {t(`typeHints.${type}`)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
