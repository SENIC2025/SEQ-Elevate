"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { focusAfterItemRemove, focusAfterMove, moveItem } from "./item-list";

const iconButton =
  "inline-flex min-h-6 min-w-6 items-center justify-center rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40 disabled:hover:text-[var(--muted-foreground)]";

/**
 * A list editor's keyboard-safe changes (WCAG 2.4.3): after a move, focus
 * follows the item to its new place (on the button pressed, or the other
 * one at an end), so the author can keep pressing without losing their
 * place; after a removal it goes to the caption of the item that took the
 * removed one's place (or the one before); after an add, into the new
 * item's first box. Captions get their ids here (`captionId`) for that.
 */
export function useListMoves<T extends { id: string }>(
  list: readonly T[],
  onChange: (next: T[]) => void
) {
  const ids = React.useId();
  const [focus, setFocus] = React.useState<{
    id: string;
    to: "up" | "down" | "caption" | "field";
    n: number;
  } | null>(null);
  React.useEffect(() => {
    if (!focus) return;
    if (focus.to === "up" || focus.to === "down") {
      document.getElementById(`${ids}-${focus.id}-${focus.to}`)?.focus();
      return;
    }
    const caption = document.getElementById(`${ids}-${focus.id}-caption`);
    const box =
      focus.to === "field"
        ? caption?.closest('[role="group"]')?.querySelector<HTMLElement>("input, textarea")
        : null;
    (box ?? caption)?.focus();
  }, [focus, ids]);

  const next = (f: { n: number } | null) => (f?.n ?? 0) + 1;
  const move = (index: number, dir: -1 | 1) => {
    const item = list[index];
    onChange(moveItem(list, index, dir));
    setFocus((f) => ({ id: item.id, to: focusAfterMove(index, dir, list.length), n: next(f) }));
  };
  const remove = (index: number) => {
    const to = focusAfterItemRemove(list, index);
    onChange(list.filter((_, i) => i !== index));
    if (to) setFocus((f) => ({ id: to, to: "caption", n: next(f) }));
  };
  const add = (item: T) => {
    onChange([...list, item]);
    setFocus((f) => ({ id: item.id, to: "field", n: next(f) }));
  };
  const buttonId = (id: string, dir: "up" | "down") => `${ids}-${id}-${dir}`;
  const captionId = (id: string) => `${ids}-${id}-caption`;
  return { move, remove, add, buttonId, captionId, limitId: `${ids}-limit` };
}

/** Move up, Move down and Remove for one item, each named with the item ("Move question 2 up"). */
export function ItemControls({
  index,
  length,
  upId,
  downId,
  labels,
  canRemove,
  onMove,
  onRemove,
}: {
  index: number;
  length: number;
  upId: string;
  downId: string;
  labels: { up: string; down: string; remove: string };
  canRemove: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <span className="ml-auto inline-flex items-center gap-1">
      <button
        type="button"
        id={upId}
        className={iconButton}
        disabled={index === 0}
        aria-label={labels.up}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        id={downId}
        className={iconButton}
        disabled={index === length - 1}
        aria-label={labels.down}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="h-4 w-4" aria-hidden />
      </button>
      {canRemove ? (
        <button
          type="button"
          className={`${iconButton} hover:text-[var(--danger)]`}
          aria-label={labels.remove}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

/**
 * "Add question" / "Add statement": at the list's limit it stays, aria-
 * disabled and described by a note saying the limit, rather than vanishing
 * from under the author's focus.
 */
export function AddItemButton({
  label,
  full,
  limitId,
  limitNote,
  onAdd,
}: {
  label: string;
  full: boolean;
  limitId: string;
  limitNote: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        {...(full ? { "aria-disabled": true as const, "aria-describedby": limitId } : {})}
        onClick={() => {
          if (!full) onAdd();
        }}
      >
        <Plus className="h-4 w-4" aria-hidden />
        {label}
      </Button>
      {full ? (
        <span id={limitId} className="text-xs text-[var(--muted-foreground)]">
          {limitNote}
        </span>
      ) : null}
    </div>
  );
}
