"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { focusAfterMove, moveItem } from "./item-list";

const iconButton =
  "inline-flex min-h-6 min-w-6 items-center justify-center rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40 disabled:hover:text-[var(--muted-foreground)]";

/**
 * A list editor's keyboard-safe reordering: after a move, focus follows the
 * item to its new place (on the button pressed, or the other one at an
 * end), so the author can keep pressing without losing their place.
 */
export function useListMoves<T extends { id: string }>(
  list: readonly T[],
  onChange: (next: T[]) => void
) {
  const ids = React.useId();
  const [focus, setFocus] = React.useState<{ id: string; dir: "up" | "down"; n: number } | null>(
    null
  );
  React.useEffect(() => {
    if (focus) document.getElementById(`${ids}-${focus.id}-${focus.dir}`)?.focus();
  }, [focus, ids]);

  const move = (index: number, dir: -1 | 1) => {
    const item = list[index];
    onChange(moveItem(list, index, dir));
    setFocus((f) => ({
      id: item.id,
      dir: focusAfterMove(index, dir, list.length),
      n: (f?.n ?? 0) + 1,
    }));
  };
  const buttonId = (id: string, dir: "up" | "down") => `${ids}-${id}-${dir}`;
  return { move, buttonId };
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
