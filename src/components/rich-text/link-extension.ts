import { Mark } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { checkLinkHref } from "@/lib/rich-text/link-url";
import { ownFileHost } from "@/lib/rich-text/own-file-host";

/**
 * The editor's named link (D104, D106): a mark holding one address, `href`,
 * and nothing else, as the stored format keeps it (types.ts). Our own mark
 * rather than Tiptap's link extension, so the one address check
 * (checkLinkHref, link-url.ts) decides at every way in and out:
 *
 * - pasting or dropping `<a href>`: the parse rule takes the link only when
 *   the check accepts its address, and never one of our own file store;
 *   otherwise the text comes in without it (paste-cleanup.ts has unwrapped
 *   and counted such anchors already);
 * - drawing: JSON can enter the editor without the parse rule (the text it
 *   opens), so the address is checked again and drawn, normalised, only
 *   when it is accepted; a refused one draws as `<a class="seq-link">`
 *   without an address, its text visible to fix or unlink. No other
 *   attribute is ever copied. It opens in a new tab without a handle on
 *   this page (`noopener noreferrer`), should an author ⌘-click it;
 * - setLessonLink refuses (returns false) an address the check refuses or
 *   one of our own files.
 *
 * Not inclusive: typing right after a link doesn't extend it. One link per
 * text: a link replaces another (a mark excludes its own type). Typed
 * addresses stay text (no autolink, D55): learners get them as quick links.
 *
 * Authoring only: imports Tiptap (see eslint.config.mjs).
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lessonLink: {
      /** Links the selection to `href`, normalised; false when the address can't be a new link. */
      setLessonLink: (attrs: { href: string }) => ReturnType;
      /** Removes the whole link around the cursor (or in the selection). */
      unsetLessonLink: () => ReturnType;
    };
  }
}

/**
 * The whole link (neighbouring text with the same link mark) on one side
 * of `pos`: the text right after it ("after") or right before it
 * ("before"), when that text is linked. Null otherwise.
 */
function linkRunAt(state: EditorState, pos: number, side: "after" | "before"): { from: number; to: number } | null {
  const type = state.schema.marks.link;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const { node, index } = side === "after" ? parent.childAfter($pos.parentOffset) : parent.childBefore($pos.parentOffset);
  const mark = node ? type.isInSet(node.marks) : undefined;
  if (!node || !mark) return null;
  let start = index;
  let end = index + 1;
  while (start > 0 && mark.isInSet(parent.child(start - 1).marks)) start--;
  while (end < parent.childCount && mark.isInSet(parent.child(end).marks)) end++;
  let from = $pos.start();
  for (let i = 0; i < start; i++) from += parent.child(i).nodeSize;
  let to = from;
  for (let i = start; i < end; i++) to += parent.child(i).nodeSize;
  return { from, to };
}

/**
 * The link the cursor is in, whole; or, for a selection, the selection
 * widened to the whole of any link it starts or ends in. Null when there is
 * no link there. A cursor right after a link isn't in it (links aren't
 * inclusive): typing there doesn't extend it, and Link makes a new one.
 */
export function linkRange(state: EditorState): { from: number; to: number } | null {
  const type = state.schema.marks.link;
  if (!type) return null;
  const { empty, from, to, $from } = state.selection;
  if (empty) {
    if (!type.isInSet(state.storedMarks ?? $from.marks())) return null;
    return linkRunAt(state, from, "after") ?? linkRunAt(state, from, "before");
  }
  const first = linkRunAt(state, from, "after");
  const last = linkRunAt(state, to, "before");
  const range = { from: Math.min(from, first?.from ?? from), to: Math.max(to, last?.to ?? to) };
  return state.doc.rangeHasMark(range.from, range.to, type) ? range : null;
}

/** The normalised address of a new link, or null when it can't be one (refused, or our own file). */
export function newLinkHref(href: unknown): string | null {
  const check = checkLinkHref(href, { ownFileHost: ownFileHost() });
  return check.ok && !check.ownFile ? check.href : null;
}

export const LessonLink = Mark.create({
  name: "link",
  inclusive: false,
  keepOnSplit: false,

  addAttributes() {
    return {
      href: {
        default: null,
        // Read by the parse rule below; drawn by renderHTML, never as given.
        parseHTML: (element: HTMLElement) => newLinkHref(element.getAttribute("href")),
        rendered: false,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[href]",
        getAttrs: (element: HTMLElement) => {
          const href = newLinkHref(element.getAttribute("href"));
          return href === null ? false : { href };
        },
      },
    ];
  },

  renderHTML({ mark }) {
    const href = newLinkHref(mark.attrs.href);
    return href === null
      ? ["a", { class: "seq-link" }, 0]
      : ["a", { href, class: "seq-link", rel: "noopener noreferrer", target: "_blank" }, 0];
  },

  addCommands() {
    return {
      setLessonLink:
        ({ href }) =>
        ({ commands }) => {
          const checked = newLinkHref(href);
          return checked === null ? false : commands.setMark(this.name, { href: checked });
        },
      unsetLessonLink:
        () =>
        ({ state, tr, dispatch }) => {
          const range = linkRange(state);
          if (!range) return false;
          if (dispatch) tr.removeMark(range.from, range.to, state.schema.marks.link);
          return true;
        },
    };
  },
});
