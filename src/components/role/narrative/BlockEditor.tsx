"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import type { NarrativeBlock } from "@/lib/cms/types";
import type { Keyed } from "./block-ops";
import { BLOCK_KIND_LABEL } from "./block-templates";
import {
  ChevronUp,
  ChevronDown,
  Copy,
  ListPlus,
  Trash2,
  Plus,
  X,
} from "lucide-react";

export type EditableBlock = Keyed<NarrativeBlock>;

/**
 * Where keyboard focus should land after a list change, so it never falls
 * back to the page: the moved block's arrow, a new block's first field, or
 * the "Add block below" button when its template list closes. `n` makes a
 * repeated request (two moves in a row) count as new.
 */
export interface FocusRequest {
  key: string;
  target: "field" | "up" | "down" | "add";
  n: number;
}

export const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

const iconBtn =
  "rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--surface-muted)] hover:text-[var(--accent)] disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * One content block in the lesson editor: a header with its controls, then
 * the fields for its kind. Blocks are edited as plain text; the learner view
 * (NarrativeStage) turns "•" and "1." lines into real lists.
 */
export function BlockEditor({
  block,
  index,
  total,
  focus,
  addOpen,
  pickerId,
  onChange,
  onMove,
  onDuplicate,
  onAddBelow,
  onRemove,
}: {
  block: EditableBlock;
  index: number;
  total: number;
  focus: FocusRequest | null;
  /** The template list below this block is open ("Add block below"). */
  addOpen: boolean;
  pickerId: string;
  onChange: (patch: Partial<NarrativeBlock>) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onAddBelow: () => void;
  onRemove: () => void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const kindLabel = BLOCK_KIND_LABEL[block.kind];
  const groupLabel = `Block ${index + 1} of ${total}: ${kindLabel}`;

  React.useEffect(() => {
    if (!focus) return;
    const root = rootRef.current;
    if (!root) return;
    // The first of `selectors` that matches an enabled element.
    const pick = (...selectors: string[]) => {
      for (const sel of selectors) {
        const el = root.querySelector<HTMLElement>(`${sel}:not(:disabled)`);
        if (el) return el;
      }
      return null;
    };
    // A block moved to the top has no "up" any more: fall back to the other
    // arrow, then to its first field.
    const el =
      focus.target === "field"
        ? pick("[data-block-field]")
        : focus.target === "add"
          ? pick('[data-control="add"]')
          : pick(
              `[data-control="${focus.target}"]`,
              `[data-control="${focus.target === "up" ? "down" : "up"}"]`,
              "[data-block-field]"
            );
    el?.focus();
  }, [focus]);

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={groupLabel}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant="muted" className="text-[10px]">
          <span className="tabular-nums">{index + 1}</span>
          <span aria-hidden>·</span>
          {kindLabel}
        </Badge>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            data-control="up"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Move block up"
            title="Move up"
            className={iconBtn}
          >
            <ChevronUp className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            data-control="down"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label="Move block down"
            title="Move down"
            className={iconBtn}
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            aria-label="Duplicate block"
            title="Duplicate"
            className={iconBtn}
          >
            <Copy className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            data-control="add"
            onClick={onAddBelow}
            aria-label="Add block below"
            aria-expanded={addOpen}
            aria-controls={addOpen ? pickerId : undefined}
            title="Add block below"
            className={iconBtn}
          >
            <ListPlus className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove block"
            title="Remove"
            className={`${iconBtn} hover:text-[var(--danger)]`}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {block.kind === "paragraph" ? (
        <textarea
          data-block-field
          value={block.text ?? ""}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={4}
          aria-label="Paragraph text"
          placeholder="Write the paragraph. Start a line with • for a bullet point."
          className={`${inputCls} resize-y leading-relaxed`}
        />
      ) : null}

      {block.kind === "callout" ? (
        <textarea
          data-block-field
          value={block.text ?? ""}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={2}
          aria-label="Key message text"
          placeholder="The one point learners should remember"
          // Tinted like the highlighted box learners see.
          className={`${inputCls} resize-y border-[var(--accent)]/30 bg-[var(--primary)]/10 font-medium`}
        />
      ) : null}

      {block.kind === "list" ? (
        <ListItems block={block} onChange={onChange} />
      ) : null}

      {block.kind === "compare" ? (
        <CompareSides block={block} onChange={onChange} />
      ) : null}
    </div>
  );
}

/** A numbered list: one field per item; Enter adds the next item. */
function ListItems({
  block,
  onChange,
}: {
  block: EditableBlock;
  onChange: (patch: Partial<NarrativeBlock>) => void;
}) {
  const items = block.items ?? [];
  const listRef = React.useRef<HTMLOListElement>(null);
  // The item to focus after adding or removing one ({n} makes repeats count).
  const [focusItem, setFocusItem] = React.useState<{
    i: number;
    n: number;
  } | null>(null);

  React.useEffect(() => {
    if (!focusItem) return;
    listRef.current
      ?.querySelector<HTMLInputElement>(`[data-item="${focusItem.i}"]`)
      ?.focus();
  }, [focusItem]);

  function addAfter(i: number) {
    onChange({ items: [...items.slice(0, i + 1), "", ...items.slice(i + 1)] });
    setFocusItem((f) => ({ i: i + 1, n: (f?.n ?? 0) + 1 }));
  }

  function removeAt(i: number) {
    onChange({ items: items.filter((_, x) => x !== i) });
    setFocusItem((f) => ({ i: Math.max(0, i - 1), n: (f?.n ?? 0) + 1 }));
  }

  return (
    <div>
      <ol ref={listRef} className="space-y-1.5">
        {items.map((item, ii) => (
          <li key={ii} className="flex items-center gap-2">
            <span
              aria-hidden
              className="w-5 text-right text-xs tabular-nums text-[var(--muted-foreground)]"
            >
              {ii + 1}.
            </span>
            <input
              data-item={ii}
              {...(ii === 0 ? { "data-block-field": true } : {})}
              value={item}
              onChange={(e) => {
                const next = [...items];
                next[ii] = e.target.value;
                onChange({ items: next });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addAfter(ii);
                }
              }}
              aria-label={`Item ${ii + 1}`}
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => removeAt(ii)}
              aria-label={`Remove item ${ii + 1}`}
              className="rounded p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => addAfter(items.length - 1)}
        className="mt-2 inline-flex items-center gap-1 rounded text-xs font-medium text-[var(--accent)]"
      >
        <Plus className="h-3 w-3" aria-hidden />
        Add item
      </button>
    </div>
  );
}

/** Two labelled sides, each marked as the way to avoid or the way to try. */
function CompareSides({
  block,
  onChange,
}: {
  block: EditableBlock;
  onChange: (patch: Partial<NarrativeBlock>) => void;
}) {
  const ids = React.useId();
  const sides = block.compare ?? [];
  const patchSide = (
    si: number,
    patch: Partial<NonNullable<NarrativeBlock["compare"]>[number]>
  ) => {
    const compare = [...sides];
    compare[si] = { ...compare[si], ...patch };
    onChange({ compare });
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {sides.map((side, si) => (
        <fieldset
          key={si}
          className="space-y-1.5 rounded-md border border-[var(--border)] p-2"
        >
          <legend className="px-1 text-xs font-medium text-[var(--muted-foreground)]">
            Side {si + 1}
          </legend>
          <input
            {...(si === 0 ? { "data-block-field": true } : {})}
            value={side.label}
            onChange={(e) => patchSide(si, { label: e.target.value })}
            aria-label={`Side ${si + 1} heading`}
            placeholder={
              side.tone === "positive" ? "e.g. Try…" : "e.g. Instead of…"
            }
            className={inputCls}
          />
          <textarea
            value={side.text}
            onChange={(e) => patchSide(si, { text: e.target.value })}
            rows={3}
            aria-label={`Side ${si + 1} text`}
            className={`${inputCls} resize-y`}
          />
          <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <label htmlFor={`${ids}-tone-${si}`}>Shown as</label>
            <select
              id={`${ids}-tone-${si}`}
              value={side.tone}
              onChange={(e) =>
                patchSide(si, {
                  tone: e.target.value === "positive" ? "positive" : "negative",
                })
              }
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--foreground)]"
            >
              <option value="negative">The way to avoid (amber)</option>
              <option value="positive">The way to try (green)</option>
            </select>
          </div>
        </fieldset>
      ))}
    </div>
  );
}
