/**
 * Pure Comp Card template logic — no DB, unit-testable. The DB read lives in
 * comp-card-overlay.ts.
 *
 * IMPORTANT SCOPE: field keys are FIXED. Each one maps to a column on the
 * CompCard table (wentWell, difficult, improve, behaviour, confidence), so an
 * editor rewords, reorders and hides fields — they cannot invent a new one.
 * Adding a genuinely new field is a schema change, not a content change, and
 * the editor UI says so rather than offering a button that silently loses data.
 */

import type { CompCardTemplate } from "./types";

/** The only keys that exist. Anything else in an override is ignored. */
export const COMP_CARD_KEYS = [
  "wentWell",
  "difficult",
  "improve",
  "behaviour",
  "confidence",
] as const;
export type CompCardKey = (typeof COMP_CARD_KEYS)[number];

export interface CompCardOverrideEntry {
  label?: string;
  placeholder?: string;
}
export interface CompCardLocaleOverride {
  fields?: Partial<Record<CompCardKey, CompCardOverrideEntry>>;
  /** Keys hidden from the form. `confidence` may be hidden like any other. */
  hidden?: string[];
  /** Full or partial key order; unlisted keys keep their default position. */
  order?: string[];
}
export type CompCardTemplateOverride = Record<string, CompCardLocaleOverride>;

function isKey(k: string): k is CompCardKey {
  return (COMP_CARD_KEYS as readonly string[]).includes(k);
}

/**
 * Apply an editor's override to the bundled template.
 *
 * Unknown keys are dropped rather than trusted — the override is JSON in a
 * database column, so it must not be able to inject a field the form cannot
 * actually store.
 */
export function applyTemplateOverride(
  base: CompCardTemplate,
  override: CompCardLocaleOverride | null | undefined
): CompCardTemplate {
  if (!override) return base;

  const hidden = new Set((override.hidden ?? []).filter(isKey));
  let fields = base.fields
    .filter((f) => !hidden.has(f.key as CompCardKey))
    .map((f) => {
      const o = isKey(f.key) ? override.fields?.[f.key] : undefined;
      if (!o) return f;
      return {
        ...f,
        // An empty string is not a label — fall back rather than render a
        // form field with no visible name.
        label: o.label?.trim() ? o.label.trim() : f.label,
        placeholder: o.placeholder?.trim() ?? f.placeholder,
      };
    });

  const order = (override.order ?? []).filter(isKey);
  if (order.length) {
    const rank = new Map(order.map((k, i) => [k, i]));
    fields = [...fields].sort(
      (a, b) =>
        (rank.get(a.key as CompCardKey) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.key as CompCardKey) ?? Number.MAX_SAFE_INTEGER)
    );
  }

  // Never hand back an empty form — if an editor hides everything, fall back
  // to the bundled template rather than showing a Comp Card with no fields.
  return fields.length ? { fields } : base;
}

/** The override for a locale, falling back to English then nothing. */
export function pickOverride(
  all: CompCardTemplateOverride | null,
  locale: string
): CompCardLocaleOverride | null {
  if (!all) return null;
  return all[locale] ?? all.en ?? null;
}
