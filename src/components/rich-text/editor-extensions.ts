import { Extension, wrappingInputRule, type Extensions } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { Bold } from "@tiptap/extension-bold";
import { Italic } from "@tiptap/extension-italic";
import { HardBreak } from "@tiptap/extension-hard-break";
import { BulletList, ListKeymap, OrderedList } from "@tiptap/extension-list";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { Slice, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { legacyTextToDoc } from "@/lib/rich-text/from-legacy";
import { RT_LIMITS } from "@/lib/rich-text/types";
import { CappedListItem, Indent } from "./indent-extension";

/**
 * Everything the lesson text editor can make — exactly what the stored
 * format (D36) and the learner view's RichTextView know: paragraphs (with
 * indent), line breaks, bold, italic, and bulleted or numbered lists up to
 * three levels. Listed one by one rather than through StarterKit, which
 * would add headings, links, code, underline and more. Pasted content is
 * parsed against this schema, so anything else is dropped on the way in.
 *
 * Bold comes before italic, so both together render <strong><em>, as for
 * learners.
 *
 * Authoring only: imports Tiptap, which the ESLint rule keeps out of
 * learner code (load the editor through LazyRichTextEditor).
 */
export function editorExtensions(placeholder: string): Extensions {
  return [
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    HardBreak,
    Bullets,
    Numbers,
    CappedListItem,
    ListKeys,
    UndoRedo,
    Placeholder.configure({ placeholder }),
    BlankLines,
    Indent.configure({ max: RT_LIMITS.maxIndent }),
  ];
}

/** What a blank line says in the editor (see BlankLines). */
export const BLANK_LINE_HINT = "Empty line — learners won't see a gap here";

export const blankLinesKey = new PluginKey("blankLines");

/**
 * A blank line between paragraphs — Enter pressed twice, as in Word — is a
 * gap only while editing: learners never see one, as the stored text drops
 * it (sanitizeRichText). So each blank top-level line says so, drawn like
 * the placeholder (globals.css, .rt-blank-line). An editor that is empty
 * shows its own placeholder instead. Its own plugin rather than the
 * Placeholder's: showing that on every empty line makes it work out "is the
 * editor empty?" from the state before each change, so the empty editor's
 * placeholder would go missing once its text is deleted.
 */
const BlankLines = Extension.create({
  name: "blankLines",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blankLinesKey,
        props: {
          decorations: ({ doc }) => {
            if (doc.childCount < 2) return null;
            const blank: Decoration[] = [];
            doc.forEach((node, pos) => {
              if (node.type.name === "paragraph" && !node.textContent.trim()) {
                blank.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: "rt-blank-line",
                    "data-hint": BLANK_LINE_HINT,
                  })
                );
              }
            });
            return DecorationSet.create(doc, blank);
          },
        },
      }),
    ];
  },
});

/** "- ", "* " or "+ " start a bulleted list as typed — and so does "• ". */
const Bullets = BulletList.extend({
  addInputRules() {
    return [
      ...(this.parent?.() ?? []),
      wrappingInputRule({ find: /^\s*•\s$/, type: this.type }),
    ];
  },
});

/**
 * Numbered lists keep only their first number. The `type` attribute
 * (letters, roman numerals — Google Docs pastes them) is left out: learners
 * always see numbers.
 */
const Numbers = OrderedList.extend({
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (element) => {
          const start = Number.parseInt(element.getAttribute("start") ?? "", 10);
          return Number.isFinite(start)
            ? Math.min(Math.max(start, 0), RT_LIMITS.maxOrderedStart)
            : 1;
        },
      },
    };
  },
  // "1. " to "999. " starts a list as typed, as Round 1 reads "1." lines;
  // "2024. " stays text (a list can't start there: the most is 999).
  addInputRules() {
    return [
      wrappingInputRule({
        find: /^(\d{1,3})\.\s$/,
        type: this.type,
        getAttributes: (match) => ({ start: Number(match[1]) }),
        joinPredicate: (match, node) =>
          node.childCount + node.attrs.start === Number(match[1]),
      }),
    ];
  },
  // Tiptap's own plain-text paste (a single "2024. …", "a) …" or "I. …"
  // line becomes a list) is left out: plain text is pasted by Round 1's
  // rules only (RichTextEditor's pastePlainText), and a single line as it is.
  addProseMirrorPlugins() {
    return [];
  },
});

/**
 * Backspace and Delete that join and lift list points sensibly. Its Tab is
 * left out: it moves a paragraph that follows a list into the list's last
 * point, which changes the text when a keyboard user only wants to leave the
 * editor. Tab belongs to list points (CappedListItem) and to the browser.
 */
const ListKeys = ListKeymap.extend({
  addKeyboardShortcuts() {
    const keys = { ...this.parent?.() };
    delete keys.Tab;
    return keys;
  },
}).configure({
  listTypes: [
    { itemName: "listItem", wrapperNames: ["bulletList", "orderedList"] },
  ],
});

/**
 * Plain text with line breaks as the editor pastes it — from a PDF, an
 * email, Notepad: read by the rules learners already see for typed text
 * (Round 1's parseLegacyText), so "•", "-" and "1." lines become lists and
 * blank lines separate paragraphs. The slice is open at both ends, so its
 * first and last lines join the text around the cursor, as any paste does.
 * Null for a single line, which is pasted as it is.
 */
export function plainTextSlice(schema: Schema, text: string): Slice | null {
  if (!/[\r\n]/.test(text)) return null;
  return Slice.maxOpen(schema.nodeFromJSON(legacyTextToDoc(text)).content);
}
