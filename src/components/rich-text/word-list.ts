import { RT_LIMITS } from "@/lib/rich-text/types";

/**
 * Word's lists, rebuilt. Word doesn't copy a list as <ul>/<ol>: each point
 * is a paragraph styled `mso-list:l0 level2 lfo1`, whose bullet or number is
 * drawn by a marker span Word asks other programs to ignore. paste-cleanup.ts
 * reads those paragraphs from the pasted HTML (DOM work, browser only); this
 * file is the pure part — flat points with a level in, a nested list tree and
 * its HTML out — so the rules are unit-tested without a browser.
 *
 * Points nested deeper than learners see (RT_LIMITS.maxListDepth) join the
 * deepest level, so no text is lost; a level Word skips (1 → 3) nests just
 * one step, so there are no empty points in between.
 */

export type ListKind = "bullet" | "number";

/** One point as pasted, before nesting. */
export interface FlatListItem {
  /** 1 = top level. */
  level: number;
  kind: ListKind;
  /** The first number of a numbered list (read from a list's first point). */
  start?: number;
  /** Word's list id ("l0"): a new id at the top level starts a new list. */
  list?: string;
  /**
   * The point's content, as HTML already parsed from the clipboard: a <p>,
   * or inline content.
   */
  html: string;
}

export interface ListTree {
  kind: ListKind;
  start: number;
  items: ListTreeItem[];
}

export interface ListTreeItem {
  html: string;
  /** Lists nested under this point. */
  children: ListTree[];
}

/**
 * What a Word marker says about its list: "1." "12" "(3)" "1.2." "a)" or
 * "iv." are numbers; anything else — "·" "o" "§" U+F0B7, and the letters
 * Wingdings draws as arrows, ticks and boxes ("Ø" "ü" "v", with no "." or
 * ")") — is a bullet. Only digits give a start number (the last part of
 * "1.2."); letters and roman numerals start at 1.
 */
export function parseWordMarker(marker: string): {
  kind: ListKind;
  start: number;
} {
  const m = marker.replace(/\s+/g, "");
  const digits = /^\(?((?:\d{1,3}\.)*\d{1,3})[.)]?$/.exec(m);
  if (digits) {
    const last = Number(digits[1].split(".").pop());
    return { kind: "number", start: Math.min(last, RT_LIMITS.maxOrderedStart) };
  }
  if (/^\(?[a-z]{1,4}[.)]$/i.test(m)) return { kind: "number", start: 1 };
  return { kind: "bullet", start: 1 };
}

/**
 * Nest flat points into lists. Each level holds one open list; a point of
 * another kind at the same level (bullets after numbers) starts a new list
 * there. `maxDepth` caps the nesting (the deepest level learners see).
 */
export function nestListItems(
  items: readonly FlatListItem[],
  maxDepth: number = RT_LIMITS.maxListDepth
): ListTree[] {
  const roots: ListTree[] = [];
  // The lists being filled, outermost first, with the Word level each holds.
  const open: { level: number; list: ListTree }[] = [];
  let rootList: string | undefined;

  const startList = (item: FlatListItem, level: number, depth: number) => {
    const list: ListTree = {
      kind: item.kind,
      start: listStart(item),
      items: [],
    };
    if (depth === 0) {
      roots.push(list);
      rootList = item.list;
    } else {
      const above = open[depth - 1].list.items;
      above[above.length - 1].children.push(list);
    }
    open[depth] = { level, list };
    open.length = depth + 1;
    return list;
  };

  for (const item of items) {
    let level = Math.max(1, Math.trunc(item.level) || 1);
    // Back out to this level. The outermost list takes the lowest level
    // seen, so a list that starts on level 2 still starts at the top.
    while (open.length > 1 && open[open.length - 1].level > level) open.pop();
    if (open.length === 1 && open[0].level > level) open[0].level = level;
    const top = open[open.length - 1];
    // Deeper than learners see: join the deepest list.
    if (top && top.level < level && open.length >= maxDepth) level = top.level;

    let list: ListTree;
    if (top && top.level === level) {
      const depth = open.length - 1;
      const newRoot =
        depth === 0 && item.list !== undefined && item.list !== rootList;
      list =
        top.list.kind === item.kind && !newRoot
          ? top.list
          : startList(item, level, depth);
    } else {
      // One step deeper, however many levels Word skipped.
      list = startList(item, level, open.length);
    }
    list.items.push({ html: item.html, children: [] });
  }
  return roots;
}

function listStart(item: FlatListItem): number {
  if (item.kind !== "number") return 1;
  const n = Math.trunc(item.start ?? 1);
  return Number.isFinite(n)
    ? Math.min(Math.max(n, 0), RT_LIMITS.maxOrderedStart)
    : 1;
}

/**
 * The lists as HTML for the editor to parse: <ul>, or <ol> with a start
 * when it isn't 1, holding <li>{point}{nested lists}</li>. Point HTML is
 * passed through as it came: the editor keeps only what its schema allows,
 * and every change is sanitized again.
 */
export function listTreeToHtml(lists: readonly ListTree[]): string {
  return lists.map(listHtml).join("");
}

function listHtml(list: ListTree): string {
  const items = list.items
    .map((item) => `<li>${item.html}${listTreeToHtml(item.children)}</li>`)
    .join("");
  if (list.kind === "bullet") return `<ul>${items}</ul>`;
  return list.start === 1
    ? `<ol>${items}</ol>`
    : `<ol start="${list.start}">${items}</ol>`;
}
