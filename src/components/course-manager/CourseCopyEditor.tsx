"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateCourseMeta } from "@/app/actions/course";
import type { CourseCopyState, CourseKind } from "@/lib/cms/course-admin-types";
import type { Locale } from "@/lib/cms/types";
import { useDirty } from "./dirty-registry";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Save,
} from "lucide-react";

const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

type Fields = { title: string; tagline: string; clusterLabel: string };

/**
 * The course's title and subtitle in the content language (the page keys it
 * by language). Learners see them on their dashboard and in the player.
 *
 * - Created here: this is the course's own copy for that language; a title
 *   is required. A language not written yet starts empty, showing what
 *   learners get instead as the placeholder.
 * - Built-in: rewording is stored beside the shipped wording (D34), which
 *   stays visible ("Built-in: …") and one click away ("Use built-in wording").
 */
export function CourseCopyEditor({
  slug,
  kind,
  lang,
  copy,
  onSaved,
}: {
  slug: string;
  kind: CourseKind;
  lang: Locale;
  copy: CourseCopyState;
  onSaved: (next: CourseCopyState) => void;
}) {
  const t = useTranslations("courseManager");
  const ids = React.useId();
  const fallback = copy.source === "fallback";

  const seed: Fields = fallback
    ? { title: "", tagline: "", clusterLabel: "" }
    : {
        title: copy.title,
        tagline: copy.tagline,
        clusterLabel: copy.clusterLabel,
      };
  const [fields, setFields] = React.useState<Fields>(seed);
  const [saved, setSaved] = React.useState<Fields>(seed);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const [error, setError] = React.useState<string | null>(null);

  const dirty =
    fields.title !== saved.title ||
    fields.tagline !== saved.tagline ||
    (kind === "cms" && fields.clusterLabel !== saved.clusterLabel);
  const reportDirty = useDirty("copy", t("page.copyRegion"), true);
  React.useEffect(() => reportDirty(dirty), [dirty, reportDirty]);

  const set = (patch: Partial<Fields>) => {
    setFields((f) => ({ ...f, ...patch }));
    setStatus("idle");
    setError(null);
  };

  async function save(input: Fields) {
    if (kind === "cms" && !input.title.trim()) {
      setError(t("page.errors.titleRequired"));
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const res = await updateCourseMeta(slug, lang, {
        title: input.title,
        tagline: input.tagline,
        ...(kind === "cms" ? { clusterLabel: input.clusterLabel } : {}),
      });
      if (res.ok) {
        const next: Fields = {
          title: res.copy.title,
          tagline: res.copy.tagline,
          clusterLabel: res.copy.clusterLabel,
        };
        setFields(next);
        setSaved(next);
        setStatus("saved");
        onSaved(
          kind === "cms"
            ? { ...next, source: "authored" }
            : {
                ...next,
                builtIn: copy.builtIn,
                source:
                  copy.builtIn &&
                  next.title === copy.builtIn.title &&
                  next.tagline === copy.builtIn.tagline
                    ? "built-in"
                    : "override",
              }
        );
        return;
      }
      setError(
        res.error === "forbidden"
          ? t("page.errors.forbidden")
          : res.error === "unknown-course"
            ? t("page.errors.unknownCourse")
            : res.error === "title-required"
              ? t("page.errors.titleRequired")
              : t("page.errors.generic")
      );
    } catch {
      setError(t("page.errors.generic"));
    }
    setStatus("idle");
  }

  // Customised = the course page shows a rewording of the shipped wording.
  const customised = kind === "bundled" && copy.source === "override" && !dirty;
  // "Built-in: …" beside a field that no longer shows the shipped wording.
  const showBuiltIn = {
    title: !!copy.builtIn && fields.title !== copy.builtIn.title,
    tagline: !!copy.builtIn && fields.tagline !== copy.builtIn.tagline,
  };
  const fallbackLanguage = copy.fallbackFrom
    ? t(`languageName.${copy.fallbackFrom}`)
    : null;

  return (
    <section
      aria-labelledby={`${ids}-h`}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${ids}-h`} className="text-base font-semibold">
          {t("page.copyRegion")}
        </h2>
        <Badge variant="muted" className="text-[10px]">
          {t(`languageName.${lang}`)}
        </Badge>
        {customised ? (
          <Badge variant="accent" className="text-[10px]">
            {t("page.customised")}
          </Badge>
        ) : null}
      </div>

      {fallback && fallbackLanguage ? (
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {t("page.notTranslated", { language: fallbackLanguage })}
        </p>
      ) : null}

      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save(fields);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`${ids}-title`}
              className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]"
            >
              {t("page.courseTitle")}
            </label>
            <input
              id={`${ids}-title`}
              value={fields.title}
              maxLength={120}
              aria-required={kind === "cms"}
              placeholder={fallback ? copy.title : undefined}
              aria-describedby={
                showBuiltIn.title ? `${ids}-title-hint` : undefined
              }
              onChange={(e) => set({ title: e.target.value })}
              className={inputCls}
            />
            {showBuiltIn.title ? (
              <p
                id={`${ids}-title-hint`}
                className="mt-1 text-xs text-[var(--muted-foreground)]"
              >
                {t("page.builtInHint", { title: copy.builtIn!.title })}
              </p>
            ) : null}
          </div>
          <div>
            <label
              htmlFor={`${ids}-tagline`}
              className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]"
            >
              {t("page.subtitle")}
            </label>
            <input
              id={`${ids}-tagline`}
              value={fields.tagline}
              maxLength={200}
              placeholder={fallback ? copy.tagline : undefined}
              aria-describedby={
                showBuiltIn.tagline ? `${ids}-tagline-hint` : undefined
              }
              onChange={(e) => set({ tagline: e.target.value })}
              className={inputCls}
            />
            {showBuiltIn.tagline ? (
              <p
                id={`${ids}-tagline-hint`}
                className="mt-1 text-xs text-[var(--muted-foreground)]"
              >
                {t("page.builtInHint", { title: copy.builtIn!.tagline })}
              </p>
            ) : null}
          </div>
          {kind === "cms" ? (
            <div>
              <label
                htmlFor={`${ids}-skill`}
                className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]"
              >
                {t("page.skillArea")}
              </label>
              <input
                id={`${ids}-skill`}
                value={fields.clusterLabel}
                maxLength={60}
                placeholder={fallback ? copy.clusterLabel : undefined}
                onChange={(e) => set({ clusterLabel: e.target.value })}
                className={inputCls}
              />
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={status === "saving"}>
            {status === "saving" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            {t("page.saveCopy")}
          </Button>
          {kind === "bundled" && copy.source === "override" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={status === "saving"}
              onClick={() =>
                void save({ title: "", tagline: "", clusterLabel: "" })
              }
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t("page.useBuiltIn")}
            </Button>
          ) : null}
          <span role="status" aria-live="polite" className="text-xs">
            {status === "saving" ? (
              <span className="text-[var(--muted-foreground)]">
                {t("page.saving")}
              </span>
            ) : status === "saved" ? (
              <span className="inline-flex items-center gap-1 text-[var(--success)]">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                {t("page.saved")}
              </span>
            ) : null}
          </span>
        </div>
        {error ? (
          <p
            role="alert"
            className="flex items-start gap-1.5 text-sm text-[var(--danger)]"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 flex-shrink-0"
              aria-hidden
            />
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
