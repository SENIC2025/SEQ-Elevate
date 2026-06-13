"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Accessibility, Type, Eye, X } from "lucide-react";
import { useA11y } from "./AccessibilityProvider";
import { cn } from "@/lib/utils";

export function AccessibilityToolbar() {
  const t = useTranslations("a11y");
  const { fontSize, dyslexia, contrast, setFontSize, setDyslexia, setContrast } =
    useA11y();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? t("close") : t("open")}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
      >
        <Accessibility className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t("title")}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={t("title")}
          className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">{t("title")}</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("close")}
              className="rounded-md p-1 hover:bg-[var(--surface-muted)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)] mb-1.5">
              <Type className="h-3.5 w-3.5" />
              {t("fontSize")}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(["normal", "lg", "xl"] as const).map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setFontSize(size)}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-xs",
                    fontSize === size
                      ? "border-[var(--primary)] bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
                      : "border-[var(--border)] hover:bg-[var(--surface-muted)]"
                  )}
                  aria-pressed={fontSize === size}
                >
                  {size === "normal"
                    ? t("sizeNormal")
                    : size === "lg"
                      ? t("sizeLarge")
                      : t("sizeExtraLarge")}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between py-2 cursor-pointer">
            <span className="text-sm flex items-center gap-1.5">
              <span aria-hidden="true">Aa</span>
              {t("dyslexia")}
            </span>
            <input
              type="checkbox"
              checked={dyslexia}
              onChange={(e) => setDyslexia(e.target.checked)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
          </label>

          <label className="flex items-center justify-between py-2 cursor-pointer">
            <span className="text-sm flex items-center gap-1.5">
              <Eye className="h-4 w-4" />
              {t("contrast")}
            </span>
            <input
              type="checkbox"
              checked={contrast}
              onChange={(e) => setContrast(e.target.checked)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
