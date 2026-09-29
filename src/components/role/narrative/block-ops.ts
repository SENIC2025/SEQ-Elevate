/**
 * Pure list operations behind the lesson block editor: move, insert,
 * duplicate and remove (with what's needed to undo it). Every function
 * returns a new array and never mutates its input, so React state updates
 * stay predictable — and the rules can be unit-tested without a browser.
 *
 * Blocks carry a client-only `_key` while they're edited (a stable React key
 * that survives reordering); stripKey removes it before saving.
 */

export type Keyed<T> = T & { _key: string };

/** The block without its editor-only key — what gets saved. */
export function stripKey<T>({ _key, ...rest }: Keyed<T>): T {
  void _key;
  return rest as T;
}

/** Swap the block at `index` with its neighbour above (-1) or below (1). */
export function moveBlock<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir;
  if (index < 0 || index >= list.length || j < 0 || j >= list.length) {
    return list;
  }
  const next = [...list];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

/** Insert `block` at `atIndex` (clamped), or at the end when omitted. */
export function insertBlock<T>(list: T[], block: T, atIndex?: number): T[] {
  const at =
    atIndex === undefined
      ? list.length
      : Math.min(Math.max(atIndex, 0), list.length);
  return [...list.slice(0, at), block, ...list.slice(at)];
}

/**
 * A deep copy of the block with `key`, under `newKey`, placed directly
 * below it. Deep, so editing the copy's list items or compare sides never
 * changes the original.
 */
export function duplicateBlock<T extends { _key: string }>(
  list: T[],
  key: string,
  newKey: string
): T[] {
  const index = list.findIndex((b) => b._key === key);
  if (index === -1) return list;
  const copy = { ...structuredClone(list[index]), _key: newKey };
  return insertBlock(list, copy, index + 1);
}

/**
 * Remove the block with `key`. Also returns the block and where it was, so
 * "Undo" can put it back exactly (see restoreBlock).
 */
export function removeBlock<T extends { _key: string }>(
  list: T[],
  key: string
): { list: T[]; removed?: { block: T; index: number } } {
  const index = list.findIndex((b) => b._key === key);
  if (index === -1) return { list };
  return {
    list: [...list.slice(0, index), ...list.slice(index + 1)],
    removed: { block: list[index], index },
  };
}

/** Undo a removeBlock: the block goes back where it was. */
export function restoreBlock<T>(
  list: T[],
  removed: { block: T; index: number }
): T[] {
  return insertBlock(list, removed.block, removed.index);
}
