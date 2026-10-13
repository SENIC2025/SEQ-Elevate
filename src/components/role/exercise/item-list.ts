/**
 * Moving and removing items of a question's list (reflection questions,
 * self-assessment statements) — pure, so the order rules are tested on
 * their own. Lists are never reordered by drag (WCAG 2.5.7): each item has
 * Move up and Move down.
 */

/** The list with item `index` swapped with its neighbour; the same list at either end. */
export function moveItem<T>(list: readonly T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/**
 * Where focus goes after an item moved: the button pressed, unless the item
 * now sits at the end it moved towards — that button is disabled there, so
 * the other one.
 */
export function focusAfterMove(
  index: number,
  dir: -1 | 1,
  length: number
): "up" | "down" {
  const at = Math.min(Math.max(index + dir, 0), length - 1);
  if (dir === -1) return at === 0 ? "down" : "up";
  return at === length - 1 ? "up" : "down";
}
