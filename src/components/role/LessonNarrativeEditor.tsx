"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getLessonContent,
  saveLessonNarrative,
  clearLessonNarrative,
} from "@/app/actions/lesson";
import type { NarrativeBlock, Locale } from "@/lib/cms/types";
import {
  PenSquare,
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  RotateCcw,
} from "lucide-react";

const NARRATIVE_STAGES = ["context", "concept", "behaviour"] as const;
const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "el", label: "Ελληνικά" },
];

type EditableBlock = NarrativeBlock & { _key: string };
let blockSeq = 0;
const withKeys = (blocks: NarrativeBlock[]): EditableBlock[] =>
  blocks.map((b) => ({ ...b, _key: `b-${blockSeq++}` }));
function stripKey({ _key, ...rest }: EditableBlock): NarrativeBlock {
  void _key;
  return rest;
}

const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

export function LessonNarrativeEditor({
  courses,
}: {
  courses: { slug: string; title: string }[];
}) {
  const [courseSlug, setCourseSlug] = React.useState(courses[0]?.slug ?? "");
  const [stageKey, setStageKey] = React.useState<string>("context");
  const [locale, setLocale] = React.useState<Locale>("en");
  const [title, setTitle] = React.useState("");
  const [subtitle, setSubtitle] = React.useState("");
  const [blocks, setBlocks] = React.useState<EditableBlock[]>([]);
  const [hasOverride, setHasOverride] = React.useState(false);
  const [status, setStatus] = React.useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [reloadKey, setReloadKey] = React.useState(0);

  // Load the current effective narrative whenever the lesson/locale changes.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await getLessonContent(courseSlug, stageKey, locale);
      if (cancelled) return;
      setTitle(c?.title ?? "");
      setSubtitle(c?.subtitle ?? "");
      setBlocks(withKeys(c?.blocks ?? []));
      setHasOverride(!!c?.hasOverride);
      setStatus("idle");
    })();
    return () => {
      cancelled = true;
    };
  }, [courseSlug, stageKey, locale, reloadKey]);

  function patchBlock(key: string, patch: Partial<NarrativeBlock>) {
    setBlocks((bs) =>
      bs.map((b) => (b._key === key ? { ...b, ...patch } : b))
    );
    setStatus("idle");
  }
  function removeBlock(key: string) {
    setBlocks((bs) => bs.filter((b) => b._key !== key));
    setStatus("idle");
  }
  function moveBlock(index: number, dir: "up" | "down") {
    const j = dir === "up" ? index - 1 : index + 1;
    setBlocks((bs) => {
      if (j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
    setStatus("idle");
  }
  function addBlock(kind: NarrativeBlock["kind"]) {
    const base: NarrativeBlock =
      kind === "list"
        ? { kind, items: [""] }
        : kind === "compare"
          ? {
              kind,
              compare: [
                { label: "", text: "", tone: "negative" },
                { label: "", text: "", tone: "positive" },
              ],
            }
          : { kind, text: "" };
    setBlocks((bs) => [...bs, { ...base, _key: `b-${blockSeq++}` }]);
    setStatus("idle");
  }

  async function handleSave() {
    setStatus("saving");
    const res = await saveLessonNarrative(courseSlug, stageKey, locale, {
      title,
      subtitle: subtitle || undefined,
      blocks: blocks.map(stripKey),
    });
    if (res.ok) {
      setStatus("saved");
      setHasOverride(true);
    } else {
      setStatus("error");
    }
  }

  async function handleRevert() {
    await clearLessonNarrative(courseSlug, stageKey, locale);
    setReloadKey((k) => k + 1);
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
            <PenSquare className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold">Lesson narrative</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              Edit the teaching text for a lesson, per language.
            </p>
          </div>
          {hasOverride ? (
            <Badge variant="accent" className="text-[10px]">
              Customised
            </Badge>
          ) : (
            <Badge variant="muted" className="text-[10px]">
              Default copy
            </Badge>
          )}
        </div>

        {/* Selectors */}
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--muted-foreground)]">
            <span className="block mb-1">Course</span>
            <select
              value={courseSlug}
              onChange={(e) => setCourseSlug(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            >
              {courses.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted-foreground)]">
            <span className="block mb-1">Lesson</span>
            <select
              value={stageKey}
              onChange={(e) => setStageKey(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm capitalize"
            >
              {NARRATIVE_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5 text-sm">
            {LOCALES.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setLocale(l.code)}
                className={`rounded-md px-2.5 py-1.5 ${
                  locale === l.code
                    ? "bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
                    : "text-[var(--muted-foreground)]"
                }`}
                aria-pressed={locale === l.code}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {/* Title + subtitle */}
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">
              Title
            </label>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setStatus("idle");
              }}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">
              Eyebrow / subtitle
            </label>
            <input
              value={subtitle}
              onChange={(e) => {
                setSubtitle(e.target.value);
                setStatus("idle");
              }}
              className={inputCls}
            />
          </div>
        </div>

        {/* Blocks */}
        <div className="mt-4">
          <p className="text-sm font-semibold mb-2">Content blocks</p>
          <div className="space-y-3">
            {blocks.map((block, i) => (
              <BlockEditor
                key={block._key}
                index={i}
                total={blocks.length}
                block={block}
                onChange={(patch) => patchBlock(block._key, patch)}
                onRemove={() => removeBlock(block._key)}
                onMove={(dir) => moveBlock(i, dir)}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["paragraph", "list", "callout", "compare"] as const).map((k) => (
              <Button
                key={k}
                variant="outline"
                size="sm"
                onClick={() => addBlock(k)}
              >
                <Plus className="h-3.5 w-3.5" />
                {k}
              </Button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={status === "saving"} onClick={handleSave}>
            {status === "saving" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save {LOCALES.find((l) => l.code === locale)?.label}
              </>
            )}
          </Button>
          {hasOverride ? (
            <Button variant="ghost" size="sm" onClick={handleRevert}>
              <RotateCcw className="h-4 w-4" />
              Revert to default
            </Button>
          ) : null}
          {status === "saved" ? (
            <span className="text-xs text-[var(--success)] inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved — learners see it on this lesson.
            </span>
          ) : status === "error" ? (
            <span className="text-xs text-[var(--danger)] inline-flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Sign in as a content editor to save.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function BlockEditor({
  index,
  total,
  block,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  total: number;
  block: EditableBlock;
  onChange: (patch: Partial<NarrativeBlock>) => void;
  onRemove: () => void;
  onMove: (dir: "up" | "down") => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="flex items-center gap-2 mb-2">
        <Badge variant="muted" className="text-[10px] capitalize">
          {block.kind}
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove("up")}
            disabled={index === 0}
            aria-label="Move block up"
            className="rounded p-1 text-[var(--muted-foreground)] hover:text-[var(--accent)] disabled:opacity-30"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove("down")}
            disabled={index === total - 1}
            aria-label="Move block down"
            className="rounded p-1 text-[var(--muted-foreground)] hover:text-[var(--accent)] disabled:opacity-30"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove block"
            className="rounded p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {block.kind === "paragraph" || block.kind === "callout" ? (
        <textarea
          value={block.text ?? ""}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={block.kind === "callout" ? 2 : 3}
          placeholder={block.kind === "callout" ? "Highlighted line" : "Paragraph text"}
          className={inputCls}
        />
      ) : null}

      {block.kind === "list" ? (
        <div className="space-y-1.5">
          {(block.items ?? []).map((item, ii) => (
            <div key={ii} className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted-foreground)] tabular-nums w-5">
                {ii + 1}.
              </span>
              <input
                value={item}
                onChange={(e) => {
                  const items = [...(block.items ?? [])];
                  items[ii] = e.target.value;
                  onChange({ items });
                }}
                className={inputCls}
              />
              <button
                type="button"
                onClick={() =>
                  onChange({
                    items: (block.items ?? []).filter((_, x) => x !== ii),
                  })
                }
                aria-label={`Remove item ${ii + 1}`}
                className="rounded p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ items: [...(block.items ?? []), ""] })}
            className="text-xs text-[var(--accent)] font-medium inline-flex items-center gap-1"
          >
            <Plus className="h-3 w-3" />
            Add item
          </button>
        </div>
      ) : null}

      {block.kind === "compare" ? (
        <div className="grid sm:grid-cols-2 gap-2">
          {(block.compare ?? []).map((side, si) => (
            <div key={si} className="rounded-md border border-[var(--border)] p-2 space-y-1.5">
              <input
                value={side.label}
                onChange={(e) => {
                  const compare = [...(block.compare ?? [])];
                  compare[si] = { ...compare[si], label: e.target.value };
                  onChange({ compare });
                }}
                placeholder="Label"
                className={inputCls}
              />
              <textarea
                value={side.text}
                onChange={(e) => {
                  const compare = [...(block.compare ?? [])];
                  compare[si] = { ...compare[si], text: e.target.value };
                  onChange({ compare });
                }}
                rows={2}
                placeholder="Text"
                className={inputCls}
              />
              <select
                value={side.tone}
                onChange={(e) => {
                  const compare = [...(block.compare ?? [])];
                  compare[si] = {
                    ...compare[si],
                    tone: e.target.value as "negative" | "positive",
                  };
                  onChange({ compare });
                }}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
              >
                <option value="negative">negative</option>
                <option value="positive">positive</option>
              </select>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
