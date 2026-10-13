"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Info, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AddSectionChoice, NarrativeKey } from "@/lib/cms/sections/contract";
import type { Locale } from "@/lib/cms/types";
import {
  addChoices,
  addControl,
  choiceState,
  reusesStandard,
  type Control,
  type ListContext,
} from "./live-controls";
import {
  choiceKey,
  defaultWhere,
  parseWhere,
  whereToAt,
  whereValue,
  type Where,
} from "./list-model";
import { Named } from "./Named";

/**
 * "Add a lesson": what kind (one choice of several, so a group of native
 * radio buttons — the dot shows the choice without colour, also in forced
 * colours; the first takes focus when it opens, Escape closes it), where it
 * goes, and "Add this lesson" (which says to choose first until then).
 *
 * Before anything is added it says whether the choice makes the course one
 * that can only be published from Release 2 (a lesson of the course's own, or
 * a standard one out of its usual place), warns above 12 lessons, and on a
 * published course keeps the choices it would refuse aria-disabled with the
 * reason (G3). A practice, scenario or quick check that is free reuses the
 * standard lesson, in its usual place by default.
 */
export function AddLessonPicker({
  ctx,
  from,
  busy,
  lessonLabel,
  restoreName,
  nameLang,
  descriptions,
  error,
  onAdd,
  onClose,
  onHint,
}: {
  ctx: ListContext;
  /** The index of the lesson "Add lesson after" was opened from (null: the list's own button). */
  from: number | null;
  busy: boolean;
  /** "n. Name" for a lesson id. */
  lessonLabel: (id: string) => string;
  /** A deleted standard lesson's name in the content language. */
  restoreName: (key: NarrativeKey) => string;
  /** The content language of those names. */
  nameLang?: Locale;
  /** Ids of the shared reason texts, for aria-describedby. */
  descriptions: (c: Control) => string | undefined;
  error: string | null;
  onAdd: (choice: AddSectionChoice, at: number | null) => void;
  onClose: () => void;
  /** Called with the non-standard hint whenever it appears, for the page's live region. */
  onHint: (text: string) => void;
}) {
  const t = useTranslations("lessonList");
  const ids = React.useId();
  const firstRef = React.useRef<HTMLInputElement>(null);
  const sections = ctx.sections.resolved.sections;
  const count = sections.length;

  const [choice, setChoice] = React.useState<AddSectionChoice | null>(null);
  // Follows the choice until the editor picks a place themselves.
  const [where, setWhere] = React.useState<Where | null>(null);
  const reuses = choice !== null && reusesStandard(choice, ctx.sections);
  const place: Where = where ?? defaultWhere(reuses, from, count);
  const at = whereToAt(place);
  const state = choice ? choiceState(ctx, choice, at) : null;
  const nonStandard = state?.nonStandard === true && state.control.kind === "enabled";
  const addState: Control = state ? state.control : addControl(ctx);

  React.useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const hint = t("nonStandardHint");
  React.useEffect(() => {
    if (nonStandard) onHint(hint);
  }, [nonStandard, hint, onHint]);

  function pick(next: AddSectionChoice) {
    setChoice(next);
    // "Its usual place" exists only for a standard lesson.
    if (where === "auto" && !reusesStandard(next, ctx.sections)) setWhere(null);
  }

  const options: { value: Where; label: string }[] = [
    ...(reuses ? [{ value: "auto" as const, label: t("picker.whereAuto") }] : []),
    { value: 0, label: t("picker.whereStart") },
    ...sections.map((s, i) => ({
      value: i + 1,
      label: t("picker.whereAfter", { label: lessonLabel(s.id) }),
    })),
  ];

  const addLocked = addState.kind !== "enabled" || choice === null;
  const hintId = `${ids}-hint`;
  const chooseFirstId = `${ids}-choose-first`;
  const addDescribedBy =
    [choice ? null : chooseFirstId, nonStandard ? hintId : null, choice ? descriptions(addState) : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div
      role="group"
      aria-labelledby={`${ids}-title`}
      className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <h3 id={`${ids}-title`} className="text-sm font-semibold">
        {t("picker.title")}
      </h3>
      <fieldset className="mt-1">
        <legend className="text-xs text-[var(--muted-foreground)]">{t("picker.choose")}</legend>
        <ul className="mt-1.5 space-y-1.5">
          {addChoices(ctx.sections).map((c, i) => {
            const keys = choiceKey(c);
            const name = c.startsWith("restore:") ? (
              <Named
                format={(n) => t(keys.label, { name: n })}
                name={restoreName(c.slice("restore:".length) as NarrativeKey)}
                lang={nameLang}
              />
            ) : (
              t(keys.label)
            );
            const own = choiceState(ctx, c, null).control;
            const locked = own.kind !== "enabled";
            const selected = choice === c;
            return (
              <li key={c}>
                <label
                  className={`flex min-h-11 items-start gap-2 rounded-md border px-3 py-2 ${
                    selected
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/50"
                  } ${locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                >
                  <input
                    ref={i === 0 ? firstRef : undefined}
                    type="radio"
                    name={`${ids}-kind`}
                    value={c}
                    checked={selected}
                    aria-disabled={locked || undefined}
                    // Named by the label alone; the hint (and why it's refused) is the description.
                    aria-labelledby={`${ids}-${i}-label`}
                    aria-describedby={[`${ids}-${i}-hint`, locked ? descriptions(own) : null]
                      .filter(Boolean)
                      .join(" ")}
                    onChange={() => {
                      if (!locked) pick(c);
                    }}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0">
                    <span id={`${ids}-${i}-label`} className="block text-sm font-medium">
                      {name}
                    </span>
                    <span id={`${ids}-${i}-hint`} className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                      {t(keys.hint)}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <label className="mt-3 block text-xs text-[var(--muted-foreground)]">
        <span className="mb-1 block font-medium text-[var(--foreground)]">{t("where")}</span>
        <select
          value={whereValue(place)}
          onChange={(e) => setWhere(parseWhere(e.target.value))}
          className="h-9 w-full max-w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--foreground)]"
        >
          {options.map((o) => (
            <option key={String(o.value)} value={whereValue(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {nonStandard ? (
        <p id={hintId} className="mt-2 flex items-start gap-1.5 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)]" aria-hidden />
          {hint}
        </p>
      ) : null}
      {count > ctx.sections.warnAbove ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--warning)]" aria-hidden />
          {t("many", { count: ctx.sections.warnAbove })}
        </p>
      ) : null}

      <p id={chooseFirstId} hidden>
        {t("picker.chooseFirst")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          aria-disabled={addLocked || busy || undefined}
          aria-describedby={addDescribedBy}
          className={addLocked ? "opacity-60" : undefined}
          onClick={() => {
            if (busy) return;
            if (choice === null) {
              firstRef.current?.focus();
              return;
            }
            if (addState.kind === "enabled") onAdd(choice, at);
          }}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" aria-hidden />
          )}
          {t("picker.add")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          {t("picker.close")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
