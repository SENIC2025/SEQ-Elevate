"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { NarrativeBlock } from "@/lib/cms/types";
import {
  moveBlock,
  insertBlock,
  duplicateBlock,
  removeBlock,
  restoreBlock,
} from "./block-ops";
import { blockLabel, type BlockTemplate } from "./block-templates";
import { BlockTemplatePicker } from "./BlockTemplatePicker";
import {
  BlockEditor,
  type EditableBlock,
  type FocusRequest,
} from "./BlockEditor";
import { Plus, Undo2 } from "lucide-react";

let keySeq = 0;
const nextKey = () => `b-${keySeq++}`;

/** Give saved blocks the client-only keys the editor needs. */
export function withKeys(blocks: NarrativeBlock[]): EditableBlock[] {
  return blocks.map((b) => ({ ...b, _key: nextKey() }));
}

type Removed = { block: EditableBlock; index: number };

/**
 * A lesson's content blocks: edit, reorder, duplicate, add from a template,
 * and remove with an undo. Nothing is saved here — the parent owns `blocks`
 * and its Save button.
 *
 * "Remove block" acts at once and leaves "Block removed. Undo" in its place
 * until the next change (or `resetKey` changes, e.g. after a save).
 */
export function BlockList({
  blocks,
  onBlocksChange,
  resetKey,
}: {
  blocks: EditableBlock[];
  onBlocksChange: (next: EditableBlock[]) => void;
  /** Changing it clears the undo row (the parent bumps it on save). */
  resetKey: number;
}) {
  const ids = React.useId();
  const addEndRef = React.useRef<HTMLButtonElement>(null);
  const undoRef = React.useRef<HTMLButtonElement>(null);
  const [removed, setRemoved] = React.useState<Removed | null>(null);
  const [focus, setFocus] = React.useState<FocusRequest | null>(null);
  // Where the template list is open: below a block (its key) or at the end.
  const [picker, setPicker] = React.useState<{ after: string | null } | null>(
    null
  );

  // A save (or discard) upstream: the removed block can't come back any more.
  const [seenReset, setSeenReset] = React.useState(resetKey);
  if (resetKey !== seenReset) {
    setSeenReset(resetKey);
    setRemoved(null);
    setPicker(null);
  }

  // Keep keyboard users on the "Undo" they need, instead of on the page.
  React.useEffect(() => {
    if (removed) undoRef.current?.focus();
  }, [removed]);

  const requestFocus = (key: string, target: FocusRequest["target"]) =>
    setFocus((f) => ({ key, target, n: (f?.n ?? 0) + 1 }));

  function change(next: EditableBlock[]) {
    setRemoved(null);
    onBlocksChange(next);
  }

  function pick(template: BlockTemplate) {
    const at =
      !picker || picker.after === null
        ? blocks.length
        : blocks.findIndex((b) => b._key === picker.after) + 1;
    const block = { ...template.make(), _key: nextKey() };
    change(insertBlock(blocks, block, at));
    setPicker(null);
    requestFocus(block._key, "field");
  }

  function closePicker() {
    const after = picker?.after;
    setPicker(null);
    if (after) requestFocus(after, "add");
    else addEndRef.current?.focus();
  }

  function remove(key: string) {
    const out = removeBlock(blocks, key);
    if (!out.removed) return;
    onBlocksChange(out.list);
    setRemoved(out.removed);
    if (picker?.after === key) setPicker(null);
  }

  function undo() {
    if (!removed) return;
    onBlocksChange(restoreBlock(blocks, removed));
    requestFocus(removed.block._key, "field");
    setRemoved(null);
  }

  // Focus moves to "Undo", which is described by the message, so screen
  // readers hear both.
  const undoRow = removed ? (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-sm text-[var(--muted-foreground)]">
      <span id={`${ids}-removed`}>
        {blockLabel(removed.block)} block removed.
      </span>
      <Button
        ref={undoRef}
        size="sm"
        variant="outline"
        onClick={undo}
        aria-describedby={`${ids}-removed`}
      >
        <Undo2 className="h-4 w-4" aria-hidden />
        Undo
      </Button>
    </div>
  ) : null;

  const endPickerId = `${ids}-picker-end`;

  return (
    <div>
      {blocks.length === 0 && !removed ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-sm text-[var(--muted-foreground)]">
          This lesson has no content yet. Add the first block below.
        </p>
      ) : null}

      <ol className="space-y-3">
        {blocks.map((block, i) => {
          const pickerId = `${ids}-picker-${block._key}`;
          const addOpen = picker?.after === block._key;
          return (
            <li key={block._key} className="space-y-3">
              {removed?.index === i ? undoRow : null}
              <BlockEditor
                block={block}
                index={i}
                total={blocks.length}
                focus={focus?.key === block._key ? focus : null}
                addOpen={addOpen}
                pickerId={pickerId}
                onChange={(patch) =>
                  change(
                    blocks.map((b) =>
                      b._key === block._key ? { ...b, ...patch } : b
                    )
                  )
                }
                onMove={(dir) => {
                  change(moveBlock(blocks, i, dir));
                  requestFocus(block._key, dir === -1 ? "up" : "down");
                }}
                onDuplicate={() => {
                  const key = nextKey();
                  change(duplicateBlock(blocks, block._key, key));
                  requestFocus(key, "field");
                }}
                onAddBelow={() =>
                  addOpen ? closePicker() : setPicker({ after: block._key })
                }
                onRemove={() => remove(block._key)}
              />
              {addOpen ? (
                <BlockTemplatePicker
                  id={pickerId}
                  onPick={pick}
                  onClose={closePicker}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      {removed && removed.index >= blocks.length ? (
        <div className={blocks.length ? "mt-3" : ""}>{undoRow}</div>
      ) : null}

      <div className="mt-3 space-y-2">
        <Button
          ref={addEndRef}
          size="sm"
          variant="outline"
          aria-expanded={picker !== null && picker.after === null}
          aria-controls={
            picker !== null && picker.after === null ? endPickerId : undefined
          }
          onClick={() =>
            picker !== null && picker.after === null
              ? setPicker(null)
              : setPicker({ after: null })
          }
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add block
        </Button>
        {picker !== null && picker.after === null ? (
          <BlockTemplatePicker
            id={endPickerId}
            onPick={pick}
            onClose={closePicker}
          />
        ) : null}
      </div>
    </div>
  );
}
