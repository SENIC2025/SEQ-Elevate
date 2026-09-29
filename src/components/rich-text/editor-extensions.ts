import { wrappingInputRule, type Extensions } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { Bold } from "@tiptap/extension-bold";
import { Italic } from "@tiptap/extension-italic";
import { HardBreak } from "@tiptap/extension-hard-break";
import { BulletList, ListKeymap, OrderedList } from "@tiptap/extension-list";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { Slice, type Schema } from "@tiptap/pm/model";
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
    Indent.configure({ max: RT_LIMITS.maxIndent }),
  ];
}

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
