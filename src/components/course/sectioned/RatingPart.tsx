"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { PartProps } from "./part-props";

const SCALE = [1, 2, 3, 4, 5] as const;
type Value = (typeof SCALE)[number];

/**
 * A self-assessment: each statement rated 1 to 5. One fieldset per
 * statement, its legend the statement, with five native radio buttons
 * named "n of 5" — so arrow keys move within a statement and Tab moves to
 * the next, with no script of our own. What the ends mean ("1 = … · 5 =
 * …") is shown once, above, and is each fieldset's description. The
 * targets are at least 24 px and wrap on a 320 px screen.
 */
export function RatingPart({ part, answer, onAnswer }: PartProps<"rating">) {
  const t = useTranslations("sectionPreview");
  const uid = useId();
  const scaleId = `${uid}-scale`;
  const values = answer?.type === "rating" ? answer.values : {};

  const rate = (statementId: string, value: Value) =>
    onAnswer({ type: "rating", values: { ...values, [statementId]: value } });

  return (
    <div>
      {part.intro ? (
        <p className="text-sm text-[var(--muted-foreground)] mb-3">{part.intro}</p>
      ) : null}
      <p id={scaleId} className="text-sm font-medium">
        {t("ratingScale", { min: part.minLabel, max: part.maxLabel })}
      </p>
      <div className="mt-3 space-y-4">
        {part.statements.map((s, i) => (
          <fieldset
            key={s.id}
            aria-describedby={scaleId}
            className="min-w-0 rounded-lg border border-[var(--border)] p-3"
          >
            <legend className="px-1 text-sm sm:text-base font-medium">{s.text}</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {SCALE.map((n) => {
                const checked = values[s.id] === n;
                return (
                  <label
                    key={n}
                    className={cn(
                      "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--ring)]",
                      checked
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 font-semibold"
                        : "border-[var(--border)] hover:bg-[var(--surface-muted)]"
                    )}
                  >
                    <input
                      type="radio"
                      name={`${uid}-${i}`}
                      value={n}
                      checked={checked}
                      onChange={() => rate(s.id, n)}
                      aria-label={t("ratingOption", { n })}
                      className="h-6 w-6 accent-[var(--accent)]"
                    />
                    <span aria-hidden="true">{n}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}
