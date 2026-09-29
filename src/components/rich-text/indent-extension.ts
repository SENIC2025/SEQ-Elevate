import { Extension } from "@tiptap/core";
import { ListItem } from "@tiptap/extension-list";
import type { Node as PmNode, ResolvedPos } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { RT_LIMITS } from "@/lib/rich-text/types";

/**
 * Indent, for the lesson text editor (D36).
 *
 * - A paragraph gets an `indent` of 0–4 steps, drawn as the same inline
 *   `padding-inline-start` (1.5rem a step) the learner view's RichTextView
 *   uses — so it looks the same while editing.
 * - In a list, indenting moves the point one level in or out instead (that
 *   is what indent means there); paragraphs inside lists never keep an
 *   indent of their own, as the stored format has none there.
 * - Lists go at most RT_LIMITS.maxListDepth (3) levels deep, as learners see
 *   them. At that depth Tab isn't taken, so it moves focus out of the
 *   editor like everywhere else on the page (no keyboard trap, WCAG 2.1.2).
 *
 * Keys: Ctrl/⌘+] and Ctrl/⌘+[ anywhere; Tab and Shift+Tab in a list.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    indent: {
      /** A list point one level in; a paragraph one step right. */
      indent: () => ReturnType;
      /** A list point one level out; a paragraph one step left. */
      outdent: () => ReturnType;
    };
  }
}

/** One indent step, in rem — the same as the learner view's. */
export const INDENT_STEP_REM = 1.5;

const LIST_TYPES = new Set(["bulletList", "orderedList"]);
const isListNode = (node: PmNode) => LIST_TYPES.has(node.type.name);

/** How many lists surround position `$pos` down to depth `upTo`. */
function listsAround($pos: ResolvedPos, upTo = $pos.depth): number {
  let n = 0;
  for (let d = upTo; d > 0; d--) if (isListNode($pos.node(d))) n++;
  return n;
}

/** How many levels of lists `node` holds (0 = none). */
function listLevelsIn(node: PmNode): number {
  let most = 0;
  node.forEach((child) => {
    if (!isListNode(child)) return;
    child.forEach((item) => {
      most = Math.max(most, 1 + listLevelsIn(item));
    });
  });
  return most;
}

/** Is the cursor (the start of the selection) in a list point? */
export function inListItem(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "listItem") return true;
  }
  return false;
}

/**
 * Would moving the selected list points one level in keep every list within
 * `maxDepth` levels? (Their own sub-lists move in with them.) Depth only:
 * sinkListItem still needs a point above to move under.
 */
export function canSinkWithin(state: EditorState, maxDepth: number): boolean {
  const { $from, $to } = state.selection;
  const range = $from.blockRange(
    $to,
    (node) => node.childCount > 0 && node.firstChild?.type.name === "listItem"
  );
  if (!range) return false;
  let below = 0;
  for (let i = range.startIndex; i < range.endIndex; i++) {
    below = Math.max(below, listLevelsIn(range.parent.child(i)));
  }
  return listsAround($from, range.depth) + 1 + below <= maxDepth;
}

/** Change the indent of the top-level paragraphs in the selection by `delta`. */
function shiftParagraphs(
  state: EditorState,
  tr: Transaction,
  dispatch: ((tr: Transaction) => void) | undefined,
  delta: 1 | -1,
  max: number
): boolean {
  const { from, to } = state.selection;
  let changed = false;
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type.name !== "paragraph") return !isListNode(node);
    if (parent?.type.name === "doc") {
      const current = Number(node.attrs.indent) || 0;
      const next = Math.min(max, Math.max(0, current + delta));
      if (next !== current) {
        changed = true;
        if (dispatch) tr.setNodeAttribute(pos, "indent", next);
      }
    }
    return false;
  });
  return changed;
}

export interface IndentOptions {
  /** The most indent steps a paragraph can have. */
  max: number;
}

export const Indent = Extension.create<IndentOptions>({
  name: "indent",

  addOptions() {
    return { max: RT_LIMITS.maxIndent };
  },

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          indent: {
            default: 0,
            // Word and Google Docs indent with margin-left, 36pt (0.5in) a
            // step; our own copies carry padding-inline-start. Inside a
            // list the nesting is the indent.
            parseHTML: (element) => {
              if (element.closest("li")) return 0;
              const steps =
                remSteps(element.style.paddingInlineStart) ||
                lengthSteps(element.style.marginLeft);
              return Math.min(this.options.max, Math.max(0, steps));
            },
            renderHTML: (attributes) => {
              const indent = Number(attributes.indent) || 0;
              return indent > 0
                ? {
                    style: `padding-inline-start: ${indent * INDENT_STEP_REM}rem`,
                  }
                : {};
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      indent:
        () =>
        ({ state, tr, dispatch, commands }) =>
          inListItem(state)
            ? canSinkWithin(state, RT_LIMITS.maxListDepth) &&
              commands.sinkListItem("listItem")
            : shiftParagraphs(state, tr, dispatch, 1, this.options.max),
      outdent:
        () =>
        ({ state, tr, dispatch, commands }) =>
          inListItem(state)
            ? commands.liftListItem("listItem")
            : shiftParagraphs(state, tr, dispatch, -1, this.options.max),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-]": () => this.editor.commands.indent(),
      "Mod-[": () => this.editor.commands.outdent(),
    };
  },

  addProseMirrorPlugins() {
    return [
      // A paragraph that ends up in a list — a list toggled on, a point
      // joined — drops its indent: learners never see one there.
      new Plugin({
        key: new PluginKey("indentOutsideLists"),
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          let tr: Transaction | null = null;
          state.doc.descendants((node, pos, parent) => {
            if (node.type.name !== "paragraph") return true;
            if (parent?.type.name === "listItem" && node.attrs.indent) {
              tr = (tr ?? state.tr).setNodeAttribute(pos, "indent", 0);
            }
            return false;
          });
          return tr;
        },
      }),
    ];
  },
});

/** "3rem" → 2 steps. */
function remSteps(value: string): number {
  const rem = /^([\d.]+)rem$/.exec(value.trim());
  return rem ? Math.round(Number(rem[1]) / INDENT_STEP_REM) : 0;
}

/** "36pt", "0.5in", "48px" → 1 step (Word's and Docs' default tab stop). */
function lengthSteps(value: string): number {
  const m = /^([\d.]+)(pt|px|in|cm)$/.exec(value.trim());
  if (!m) return 0;
  const points =
    Number(m[1]) *
    ({ pt: 1, px: 0.75, in: 72, cm: 72 / 2.54 } as const)[
      m[2] as "pt" | "px" | "in" | "cm"
    ];
  return Math.round(points / 36);
}

/**
 * List points, capped at the depth learners see: Tab moves a point one
 * level in only while it (and its own sub-points) stay within
 * RT_LIMITS.maxListDepth levels — otherwise Tab isn't taken, and moves focus
 * on. Shift+Tab moves it out; Enter and Backspace work as in any list.
 */
export const CappedListItem = ListItem.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Tab: () =>
        canSinkWithin(this.editor.state, RT_LIMITS.maxListDepth) &&
        this.editor.commands.sinkListItem(this.name),
    };
  },
});
