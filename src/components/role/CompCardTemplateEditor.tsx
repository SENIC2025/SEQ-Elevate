"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getCompCardEditorState,
  saveCompCardTemplate,
  clearCompCardTemplate,
  type CompCardEditorField,
} from "@/app/actions/comp-card-template";
import type { Locale } from "@/lib/cms/types";
import {
  IdCard,
  Save,
  RotateCcw,
  Loader2,
  AlertTriangle,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  Info,
  CheckCircle2,
} from "lucide-react";

const LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "el", label: "Ελληνικά" },
];

const inputCls =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm w-full";

/**
 * Comp Card template editor — reword, reorder and hide the Comp Card fields
 * per language. Field keys are fixed (each maps to a stored column), which the
 * panel states plainly rather than offering an "add field" button that would
 * silently fail to save anything.
 */
export function CompCardTemplateEditor() {
  const [locale, setLocale] = React.useState<Locale>("en");
  const [fields, setFields] = React.useState<CompCardEditorField[] | null>(null);
  const [customised, setCustomised] = React.useState(false);
  const [denied, setDenied] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    getCompCardEditorState(locale).then((res) => {
      if (cancelled) return;
      if (res === null) setDenied(true);
      else {
        setFields(res.fields);
        setCustomised(res.customised);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [locale, reloadKey]);

  React.useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(id);
  }, [saved]);

  function patch(key: string, next: Partial<CompCardEditorField>) {
    setFields((fs) =>
      fs ? fs.map((f) => (f.key === key ? { ...f, ...next } : f)) : fs
    );
  }

  function move(index: number, delta: number) {
    setFields((fs) => {
      if (!fs) return fs;
      const to = index + delta;
      if (to < 0 || to >= fs.length) return fs;
      const next = [...fs];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  async function onSave() {
    if (!fields) return;
    setPending("save");
    const res = await saveCompCardTemplate(
      locale,
      fields.map((f) => ({
        key: f.key,
        label: f.label,
        placeholder: f.placeholder,
      })),
      fields.filter((f) => f.hidden).map((f) => f.key)
    );
    if (res.ok) {
      setError(null);
      setSaved(true);
      setReloadKey((k) => k + 1);
    } else {
      setError(
        res.error === "forbidden"
          ? "Editors and admins only."
          : res.error === "all-hidden"
            ? "At least one field has to stay visible."
            : "Something went wrong."
      );
    }
    setPending(null);
  }

  async function onRevert() {
    setPending("revert");
    const res = await clearCompCardTemplate(locale);
    if (res.ok) {
      setError(null);
      setReloadKey((k) => k + 1);
    } else {
      setError("Something went wrong.");
    }
    setPending(null);
  }

  if (denied) return null;

  return (
    <Card>
      <CardContent className="p-4" role="region" aria-label="Comp Card wording">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <IdCard className="h-4 w-4 text-[var(--accent)]" />
            Comp Card wording
          </p>
          <Badge variant={customised ? "accent" : "muted"} className="text-[10px]">
            {customised ? "Customised" : "Default copy"}
          </Badge>
          <label className="ml-auto text-xs text-[var(--muted-foreground)]">
            <span className="sr-only">Language</span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              aria-label="Comp Card language"
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
            >
              {LOCALES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">
          What learners are asked on their Comp Card, in this language.
        </p>

        {error ? (
          <p
            className="mb-3 text-sm text-[var(--danger)] flex items-center gap-1.5"
            role="alert"
          >
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        ) : null}

        {fields === null ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
        ) : (
          <ul className="space-y-2">
            {fields.map((f, i) => (
              <li
                key={f.key}
                className={`rounded-lg border border-[var(--border)] p-3 ${
                  f.hidden ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] font-mono text-[var(--muted-foreground)]">
                    {f.key}
                  </span>
                  {f.kind === "confidence" ? (
                    <Badge variant="muted" className="text-[10px]">
                      1–5 scale
                    </Badge>
                  ) : null}
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${f.key} up`}
                      className="rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-30"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === fields.length - 1}
                      aria-label={`Move ${f.key} down`}
                      className="rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-30"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => patch(f.key, { hidden: !f.hidden })}
                      aria-pressed={!f.hidden}
                      aria-label={`${f.hidden ? "Show" : "Hide"} ${f.key}`}
                      className="rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    >
                      {f.hidden ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
                <label className="block text-xs text-[var(--muted-foreground)] mb-2">
                  <span className="block mb-1">Question</span>
                  <input
                    value={f.label}
                    onChange={(e) => patch(f.key, { label: e.target.value })}
                    className={inputCls}
                  />
                </label>
                {f.kind !== "confidence" ? (
                  <label className="block text-xs text-[var(--muted-foreground)]">
                    <span className="block mb-1">Hint shown in the box</span>
                    <input
                      value={f.placeholder ?? ""}
                      onChange={(e) =>
                        patch(f.key, { placeholder: e.target.value })
                      }
                      className={inputCls}
                    />
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={onSave}
            disabled={!fields || pending === "save"}
          >
            {pending === "save" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save wording
          </Button>
          {customised ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onRevert}
              disabled={pending === "revert"}
            >
              {pending === "revert" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Revert to default
            </Button>
          ) : null}
          {saved ? (
            <span
              role="status"
              className="text-xs text-[var(--success)] inline-flex items-center gap-1"
            >
              <CheckCircle2 className="h-4 w-4" />
              Saved
            </span>
          ) : null}
        </div>

        <p className="mt-3 text-xs text-[var(--muted-foreground)] flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 text-[var(--accent)] flex-shrink-0 mt-0.5" />
          You can reword, reorder and hide these questions per language.
          Adding a genuinely new question needs a schema change (each question
          maps to a stored field), so it is a developer task rather than a
          content one — and existing learner answers are never touched by
          anything on this panel.
        </p>
      </CardContent>
    </Card>
  );
}
