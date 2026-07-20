"use server";

/**
 * Comp Card template authoring — reword, reorder and hide the Comp Card fields
 * per language, without a developer.
 *
 * SCOPE, and the UI says so: field keys are fixed because each maps to a
 * column on the CompCard table. Editors change wording and layout; adding a
 * genuinely new field is a schema change, not a content change.
 */

import { getCurrentUser, hasRole } from "@/lib/auth-helpers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBaseCompCardTemplate } from "@/lib/cms";
import { readCompCardOverride } from "@/lib/cms/comp-card-overlay";
import {
  COMP_CARD_KEYS,
  pickOverride,
  type CompCardLocaleOverride,
  type CompCardTemplateOverride,
} from "@/lib/cms/comp-card-template";
import type { Locale } from "@/lib/cms/types";

const PROJECT = "seq-elevate";

async function requireEditor() {
  const user = await getCurrentUser();
  if (!user) return null;
  const ok =
    (await hasRole(PROJECT, "ADMIN")) ||
    (await hasRole(PROJECT, "CONTENT_EDITOR"));
  return ok ? user : null;
}

export interface CompCardEditorField {
  key: string;
  label: string;
  placeholder?: string;
  kind: string;
  hidden: boolean;
}
export interface CompCardEditorState {
  /** EVERY field, in save order, including hidden ones so they can return. */
  fields: CompCardEditorField[];
  /** Whether this language has been customised at all. */
  customised: boolean;
}

/**
 * What the editor UI loads. Built from the BUNDLED template (never the
 * effective one) so a hidden field still appears here and can be un-hidden —
 * editing from the effective template would make hiding a one-way door.
 */
export async function getCompCardEditorState(
  locale: Locale
): Promise<CompCardEditorState | null> {
  if (!(await requireEditor())) return null;
  try {
    const base = await getBaseCompCardTemplate(PROJECT, locale);
    const stored = await readCompCardOverride(PROJECT);
    const override = pickOverride(stored, locale);
    const hidden = new Set(override?.hidden ?? []);
    const order = override?.order ?? [];

    const fields: CompCardEditorField[] = base.fields.map((f) => {
      const o = override?.fields?.[f.key as (typeof COMP_CARD_KEYS)[number]];
      return {
        key: f.key,
        label: o?.label?.trim() || f.label,
        placeholder: o?.placeholder ?? f.placeholder,
        kind: f.kind,
        hidden: hidden.has(f.key),
      };
    });
    if (order.length) {
      const rank = new Map(order.map((k, i) => [k, i]));
      fields.sort(
        (a, b) =>
          (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER)
      );
    }
    return { fields, customised: Boolean(stored?.[locale]) };
  } catch {
    return null;
  }
}

/**
 * Save the wording for one language. Merges — other languages are preserved,
 * so customising EN never silently drops the DE/EL work.
 */
export async function saveCompCardTemplate(
  locale: Locale,
  fields: { key: string; label: string; placeholder?: string }[],
  hidden: string[]
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };

  const known = new Set<string>(COMP_CARD_KEYS);
  const clean: CompCardLocaleOverride = { fields: {}, hidden: [], order: [] };
  for (const f of fields) {
    if (!known.has(f.key)) continue; // never store a key the form can't save
    clean.order!.push(f.key);
    clean.fields![f.key as (typeof COMP_CARD_KEYS)[number]] = {
      label: f.label.trim().slice(0, 120),
      placeholder: f.placeholder?.trim().slice(0, 200),
    };
  }
  clean.hidden = hidden.filter((k) => known.has(k));

  if (clean.hidden.length >= COMP_CARD_KEYS.length) {
    return { ok: false as const, error: "all-hidden" };
  }

  const existing = (await readCompCardOverride(PROJECT)) ?? {};
  const next: CompCardTemplateOverride = { ...existing, [locale]: clean };

  await prisma.project.update({
    where: { id: PROJECT },
    // Our typed shape isn't structurally assignable to Prisma's InputJsonValue;
    // cast at this single write site rather than loosening the domain types.
    data: { compCardTemplate: next as unknown as Prisma.InputJsonValue },
  });
  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId: editor.id,
      action: "compcard.template_saved",
      entity: "Project",
      entityId: PROJECT,
      metadata: { locale },
    },
  });
  return { ok: true as const };
}

/** Revert one language to the bundled copy, leaving the others alone. */
export async function clearCompCardTemplate(locale: Locale) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };

  const existing = (await readCompCardOverride(PROJECT)) ?? {};
  const next = { ...existing };
  delete next[locale];

  await prisma.project.update({
    where: { id: PROJECT },
    data: {
      // Prisma treats `undefined` as "leave unchanged" — DbNull is what
      // actually clears the column when the last language is reverted.
      compCardTemplate: Object.keys(next).length
        ? (next as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
    },
  });
  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId: editor.id,
      action: "compcard.template_cleared",
      entity: "Project",
      entityId: PROJECT,
      metadata: { locale },
    },
  });
  return { ok: true as const };
}
