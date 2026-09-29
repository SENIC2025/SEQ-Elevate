"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { NewCourseForm } from "./NewCourseForm";
import type { Locale } from "@/lib/cms/types";

/**
 * The first card on the course grid: "New course". Closed, the whole card is
 * one button (the stretched-button version of the course cards' link); open,
 * it widens to the full row and shows the create form, which goes straight
 * to the new course's page once it is created.
 *
 * The form mounts only when opened. Its container is always in the DOM
 * (hidden while closed) so aria-controls never points at nothing.
 */
export function NewCourseCard({ locale }: { locale: Locale }) {
  const t = useTranslations("courseManager.grid");
  const [open, setOpen] = React.useState(false);
  const formId = React.useId();

  return (
    <li className={cn(open && "sm:col-span-2 lg:col-span-3")}>
      <div
        className={cn(
          "relative flex h-full flex-col rounded-xl border-2 border-dashed bg-[var(--surface)] p-5 transition-colors",
          open
            ? "border-[var(--accent)]/40"
            : "border-[var(--border)] hover:border-[var(--accent)]/60 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-[var(--ring)]"
        )}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
            <Plus className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={formId}
                onClick={() => setOpen((o) => !o)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md text-left",
                  !open && "after:absolute after:inset-0 after:rounded-xl"
                )}
              >
                {t("newCourse")}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    open && "rotate-180"
                  )}
                  aria-hidden
                />
              </button>
            </h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t("newCourseIntro")}
            </p>
          </div>
        </div>
        <div id={formId} hidden={!open} className="mt-4">
          {open ? <NewCourseForm locale={locale} /> : null}
        </div>
      </div>
    </li>
  );
}
