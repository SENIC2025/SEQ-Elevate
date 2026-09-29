"use client";

import * as React from "react";
import { BLOCK_TEMPLATES, type BlockTemplate } from "./block-templates";

/**
 * The block templates to choose from, as a plain list of buttons (not an
 * ARIA menu — Tab and Enter work as everywhere else). Focus moves to the
 * first template when it opens; Escape closes it and the opener takes focus
 * back (the parent does that in `onClose`).
 */
export function BlockTemplatePicker({
  id,
  onPick,
  onClose,
}: {
  id: string;
  onPick: (template: BlockTemplate) => void;
  onClose: () => void;
}) {
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
      <p className="px-2 pb-1.5 text-xs text-[var(--muted-foreground)]">
        Choose what to add:
      </p>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {BLOCK_TEMPLATES.map((t, i) => (
          <li key={t.id}>
            <button
              ref={i === 0 ? firstRef : undefined}
              type="button"
              onClick={() => onPick(t)}
              // Named by the label alone; the hint is read as its description.
              aria-labelledby={`${ids}-${t.id}-label`}
              aria-describedby={`${ids}-${t.id}-hint`}
              className="h-full w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/5"
            >
              <span
                id={`${ids}-${t.id}-label`}
                className="block text-sm font-medium"
              >
                {t.label}
              </span>
              <span
                id={`${ids}-${t.id}-hint`}
                className="mt-0.5 block text-xs text-[var(--muted-foreground)]"
              >
                {t.hint}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
