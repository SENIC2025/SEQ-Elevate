"use client";

import { useTranslations } from "next-intl";
import { PART_LIMITS, type StoredReflection } from "@/lib/cms/sections/contract";
import { partFieldKey } from "@/lib/cms/sections/part-kinds";
import type { Locale } from "@/lib/cms/types";
import { LocField, newId } from "./fields";
import { AddItemButton, ItemControls, useListMoves } from "./ItemControls";

type Prompt = StoredReflection["prompts"][number];

/**
 * A lesson's own reflection questions (extra content): an optional title
 * and intro, then the questions learners answer in their own words — each
 * with an optional example shown in the empty answer box. A new one starts
 * from the platform's three standard questions, which the author may change,
 * reorder or remove (at least one stays).
 */
export function ReflectionPromptsEditor({
  value,
  locale,
  onChange,
}: {
  value: StoredReflection;
  locale: Locale;
  onChange: (next: StoredReflection) => void;
}) {
  const t = useTranslations("exerciseEditor");
  const tBlocks = useTranslations("lessonBlocks");
  const set = (patch: Partial<StoredReflection>) => onChange({ ...value, ...patch });
  const setPrompt = (id: string, patch: Partial<Prompt>) =>
    set({ prompts: value.prompts.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const { move, remove, add, buttonId, captionId, limitId } = useListMoves(value.prompts, (prompts) =>
    set({ prompts })
  );

  return (
    <div className="space-y-3">
      <LocField
        label={t("reflection.title")}
        map={value.title ?? {}}
        locale={locale}
        onChange={(m) => set({ title: m })}
        placeholder={t("reflection.titlePlaceholder")}
        maxLength={PART_LIMITS.titleChars}
        field={partFieldKey("partTitle")}
      />
      <LocField
        label={t("reflection.intro")}
        map={value.intro ?? {}}
        locale={locale}
        onChange={(m) => set({ intro: m })}
        textarea
        maxLength={PART_LIMITS.introChars}
        field={partFieldKey("partIntro")}
      />

      <p className="text-xs font-medium text-[var(--foreground)] pt-1">
        {t("reflection.promptsHint")}
      </p>
      <p className="text-xs text-[var(--muted-foreground)]">{t("reflection.standardNote")}</p>
      <ol className="space-y-2">
        {value.prompts.map((p, i) => {
          const caption = captionId(p.id);
          const n = i + 1;
          return (
            <li key={p.id} className="rounded-lg border border-[var(--border)] p-3">
              <div role="group" aria-labelledby={caption} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span id={caption} tabIndex={-1} className="text-[11px] text-[var(--muted-foreground)]">
                    {t("reflection.prompt", { n })}
                  </span>
                  <ItemControls
                    index={i}
                    length={value.prompts.length}
                    upId={buttonId(p.id, "up")}
                    downId={buttonId(p.id, "down")}
                    labels={{
                      up: t("reflection.movePromptUp", { n }),
                      down: t("reflection.movePromptDown", { n }),
                      remove: t("reflection.removePrompt", { n }),
                    }}
                    canRemove={value.prompts.length > 1}
                    onMove={(dir) => move(i, dir)}
                    onRemove={() => remove(i)}
                  />
                </div>
                <LocField
                  label={t("reflection.promptLabel")}
                  field={partFieldKey("reflectionPromptLabel", { prompt: n })}
                  context={caption}
                  map={p.label}
                  locale={locale}
                  maxLength={PART_LIMITS.promptChars}
                  onChange={(m) => setPrompt(p.id, { label: m })}
                />
                <LocField
                  label={t("reflection.promptPlaceholder")}
                  field={partFieldKey("reflectionPromptPlaceholder", { prompt: n })}
                  context={caption}
                  map={p.placeholder ?? {}}
                  locale={locale}
                  maxLength={PART_LIMITS.placeholderChars}
                  onChange={(m) => setPrompt(p.id, { placeholder: m })}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <AddItemButton
        label={t("reflection.addPrompt")}
        full={value.prompts.length >= PART_LIMITS.reflectionPrompts}
        limitId={limitId}
        limitNote={tBlocks("maxPrompts", { max: PART_LIMITS.reflectionPrompts })}
        onAdd={() => add({ id: newId("q"), label: {} })}
      />
    </div>
  );
}
