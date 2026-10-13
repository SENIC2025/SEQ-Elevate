"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PART_LIMITS, type StoredRating } from "@/lib/cms/sections/contract";
import { partFieldKey } from "@/lib/cms/sections/part-kinds";
import type { Locale } from "@/lib/cms/types";
import { LocField, newId } from "./fields";
import { ItemControls, useListMoves } from "./ItemControls";

/**
 * A 1–5 self-assessment (extra content): an optional title and intro, what
 * 1 and 5 mean, and the statements learners rate. The scale itself is
 * fixed; a new one starts with the platform's labels for both ends.
 */
export function RatingEditor({
  value,
  locale,
  onChange,
}: {
  value: StoredRating;
  locale: Locale;
  onChange: (next: StoredRating) => void;
}) {
  const t = useTranslations("exerciseEditor");
  const captions = React.useId();
  const set = (patch: Partial<StoredRating>) => onChange({ ...value, ...patch });
  const { move, buttonId } = useListMoves(value.statements, (statements) => set({ statements }));

  return (
    <div className="space-y-3">
      <LocField
        label={t("rating.title")}
        map={value.title ?? {}}
        locale={locale}
        onChange={(m) => set({ title: m })}
        placeholder={t("rating.titlePlaceholder")}
        maxLength={PART_LIMITS.titleChars}
        field={partFieldKey("partTitle")}
      />
      <LocField
        label={t("rating.intro")}
        map={value.intro ?? {}}
        locale={locale}
        onChange={(m) => set({ intro: m })}
        textarea
        maxLength={PART_LIMITS.introChars}
        field={partFieldKey("partIntro")}
      />

      <p className="text-xs font-medium text-[var(--foreground)] pt-1">{t("rating.scaleHint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <LocField
          label={t("rating.minLabel")}
          map={value.minLabel}
          locale={locale}
          onChange={(m) => set({ minLabel: m })}
          maxLength={PART_LIMITS.endLabelChars}
          field={partFieldKey("ratingMinLabel")}
        />
        <LocField
          label={t("rating.maxLabel")}
          map={value.maxLabel}
          locale={locale}
          onChange={(m) => set({ maxLabel: m })}
          maxLength={PART_LIMITS.endLabelChars}
          field={partFieldKey("ratingMaxLabel")}
        />
      </div>

      <p className="text-xs font-medium text-[var(--foreground)] pt-1">
        {t("rating.statementsHint")}
      </p>
      <ol className="space-y-2">
        {value.statements.map((s, i) => {
          const caption = `${captions}-statement-${i}`;
          const n = i + 1;
          return (
            <li key={s.id} className="rounded-lg border border-[var(--border)] p-3">
              <div role="group" aria-labelledby={caption} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span id={caption} className="text-[11px] text-[var(--muted-foreground)]">
                    {t("rating.statement", { n })}
                  </span>
                  <ItemControls
                    index={i}
                    length={value.statements.length}
                    upId={buttonId(s.id, "up")}
                    downId={buttonId(s.id, "down")}
                    labels={{
                      up: t("rating.moveStatementUp", { n }),
                      down: t("rating.moveStatementDown", { n }),
                      remove: t("rating.removeStatement", { n }),
                    }}
                    canRemove={value.statements.length > 1}
                    onMove={(dir) => move(i, dir)}
                    onRemove={() =>
                      set({ statements: value.statements.filter((x) => x.id !== s.id) })
                    }
                  />
                </div>
                <LocField
                  label={t("rating.statementText")}
                  field={partFieldKey("ratingStatementText", { statement: n })}
                  context={caption}
                  map={s.text}
                  locale={locale}
                  maxLength={PART_LIMITS.statementChars}
                  onChange={(m) =>
                    set({
                      statements: value.statements.map((x) =>
                        x.id === s.id ? { ...x, text: m } : x
                      ),
                    })
                  }
                />
              </div>
            </li>
          );
        })}
      </ol>
      {value.statements.length < PART_LIMITS.ratingStatements ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            set({ statements: [...value.statements, { id: newId("s"), text: {} }] })
          }
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t("rating.addStatement")}
        </Button>
      ) : null}
    </div>
  );
}
