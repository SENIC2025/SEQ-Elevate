import { describe, it, expect, afterEach } from "vitest";
import { Editor, getSchema, type JSONContent } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { DecorationSet } from "@tiptap/pm/view";
import {
  blankLinesKey,
  editorExtensions,
  plainTextSlice,
} from "./editor-extensions";
import { canSinkWithin } from "./indent-extension";
import { VARIANT } from "./RichTextEditor";
import { NARRATIVE_TEXT_CLASS } from "@/components/course/NarrativeStage";
import { REFLECTION_INTRO_CLASS } from "@/components/course/ReflectionIntro";
import { legacyTextToDoc } from "@/lib/rich-text/from-legacy";
import { sanitizeRichText } from "@/lib/rich-text/sanitize";
import type { RichTextV1 } from "@/lib/rich-text/types";

/**
 * The editor can make exactly what the stored format and the learner view
 * know (D36) — no more (a heading or link would be dropped on save, so the
 * author would lose it without warning), and no less (a stored doc the
 * editor can't open would crash it). Tiptap runs in node without a page, so
 * its commands are checked here too; typing, the toolbar and pasting are in
 * e2e/rich-text-editor.spec.ts.
 */

const schema = getSchema(editorExtensions("Write here"));

describe("the editor's schema", () => {
  it("has exactly the stored format's nodes and marks", () => {
    expect(Object.keys(schema.nodes).sort()).toEqual(
      [
        "bulletList",
        "doc",
        "hardBreak",
        "listItem",
        "orderedList",
        "paragraph",
        "text",
      ].sort()
    );
    // In this order: a mark's place in the schema is its nesting, so bold
    // and italic together draw <strong><em>, as for learners.
    expect(Object.keys(schema.marks)).toEqual(["bold", "italic"]);
  });

  it("gives paragraphs an indent and numbered lists only a start", () => {
    expect(Object.keys(schema.nodes.paragraph.spec.attrs ?? {})).toEqual([
      "indent",
    ]);
    expect(Object.keys(schema.nodes.orderedList.spec.attrs ?? {})).toEqual([
      "start",
    ]);
    expect(schema.nodes.bulletList.spec.attrs ?? {}).toEqual({});
  });

  it("opens every stored shape, and gives it back unchanged", () => {
    const stored: RichTextV1 = {
      v: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { indent: 2 },
            content: [
              { type: "text", text: "Both ", marks: [{ type: "bold" }] },
              {
                type: "text",
                text: "marks",
                marks: [{ type: "bold" }, { type: "italic" }],
              },
              { type: "hardBreak" },
              { type: "text", text: "next line" },
            ],
          },
          {
            type: "orderedList",
            attrs: { start: 3 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Three" }],
                  },
                  {
                    type: "bulletList",
                    content: [
                      {
                        type: "listItem",
                        content: [
                          {
                            type: "paragraph",
                            content: [{ type: "text", text: "nested" }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const node = schema.nodeFromJSON(stored.doc);
    node.check();
    // What the editor hands back (with its default attributes) sanitizes to
    // the stored value again.
    expect(sanitizeRichText({ v: 1, doc: node.toJSON() }).value).toEqual(
      stored
    );
  });

  it("opens legacy text converted by Round 1's rules", () => {
    const doc = legacyTextToDoc("Intro\n• one\n• two\n\n3. three\n4. four");
    expect(() => schema.nodeFromJSON(doc).check()).not.toThrow();
    expect(() => schema.nodeFromJSON(legacyTextToDoc("")).check()).not.toThrow();
  });
});

/* --------------------------- Indent and lists --------------------------- */

const p = (text: string, indent = 0): JSONContent => ({
  type: "paragraph",
  ...(indent ? { attrs: { indent } } : {}),
  content: [{ type: "text", text }],
});
const li = (text: string, ...lists: JSONContent[]): JSONContent => ({
  type: "listItem",
  content: [p(text), ...lists],
});
const ul = (...items: JSONContent[]): JSONContent => ({
  type: "bulletList",
  content: items,
});
const ol = (...items: JSONContent[]): JSONContent => ({
  type: "orderedList",
  content: items,
});

let open: Editor[] = [];
afterEach(() => {
  open.forEach((editor) => editor.destroy());
  open = [];
});

/** A page-less editor holding `content`, with its plugins running. */
function editorWith(...content: JSONContent[]): Editor {
  const editor = new Editor({
    element: null,
    extensions: editorExtensions(""),
    content: { type: "doc", content },
  });
  editor.view.updateState(
    editor.state.reconfigure({ plugins: editor.extensionManager.plugins })
  );
  open.push(editor);
  return editor;
}

/** Put the cursor at the end of the text `text`. */
function cursorIn(editor: Editor, text: string) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) at = pos + text.length;
  });
  expect(at, `"${text}" is in the doc`).toBeGreaterThan(0);
  editor.commands.setTextSelection(at);
}

const firstIndent = (editor: Editor) =>
  editor.getJSON().content?.[0]?.attrs?.indent;

/** The doc as it would be stored (default attributes left out). */
const stored = (editor: Editor) =>
  sanitizeRichText({ v: 1, doc: editor.getJSON() }).value?.doc.content;

/* The browser's part, for a page-less editor: each event is offered to the
   plugins in turn, as ProseMirror does, and the answer is whether one took
   it. What isn't taken, the browser does itself. */

// ProseMirror's own test for "Mod" meaning ⌘ rather than Ctrl.
const mac =
  typeof navigator !== "undefined" &&
  /Mac|iP(hone|[oa]d)/.test(navigator.platform);

/** Press `key` with Ctrl (⌘ on a Mac) when `mod`; true if the editor took it. */
function press(editor: Editor, key: string, mod = false): boolean {
  const event = {
    key,
    ctrlKey: mod && !mac,
    metaKey: mod && mac,
    altKey: false,
    shiftKey: false,
  } as KeyboardEvent;
  return editor.extensionManager.plugins.some(
    (plugin) => plugin.props.handleKeyDown?.call(plugin, editor.view, event) === true
  );
}

/** Type `text` at the cursor: each character goes to the input rules first. */
function type(editor: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const insert = () => editor.state.tr.insertText(ch, from, to);
    const taken = editor.extensionManager.plugins.some(
      (plugin) =>
        plugin.props.handleTextInput?.call(
          plugin,
          editor.view,
          from,
          to,
          ch,
          insert
        ) === true
    );
    if (!taken) editor.view.dispatch(insert());
  }
}

/** Does a plugin take a paste of this plain text (no HTML)? */
function pasteTaken(editor: Editor, text: string): boolean {
  const event = {
    clipboardData: {
      getData: (kind: string) => (kind === "text/plain" ? text : ""),
    },
  } as unknown as ClipboardEvent;
  const slice = new Slice(Fragment.from(editor.schema.text(text)), 0, 0);
  return editor.extensionManager.plugins.some(
    (plugin) =>
      plugin.props.handlePaste?.call(plugin, editor.view, event, slice) === true
  );
}

/** Every paragraph's indent, lists included. */
function indents(editor: Editor): number[] {
  const out: number[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "paragraph") out.push(node.attrs.indent);
  });
  return out;
}

/** A paragraph as the editor hands it back, with its default indent. */
const withDefaults = (node: JSONContent): JSONContent => ({
  ...node,
  attrs: { indent: 0, ...node.attrs },
});

describe("indent", () => {
  it("steps a paragraph in up to 4 times, and back out to none", () => {
    const editor = editorWith(p("Text"));
    cursorIn(editor, "Text");
    for (let step = 1; step <= 4; step++) {
      expect(editor.commands.indent()).toBe(true);
      expect(firstIndent(editor)).toBe(step);
    }
    expect(editor.can().indent(), "no fifth step").toBe(false);
    for (let step = 3; step >= 0; step--) {
      expect(editor.commands.outdent()).toBe(true);
      expect(firstIndent(editor)).toBe(step);
    }
    expect(editor.can().outdent(), "nothing to take away").toBe(false);
  });

  it("moves a list point one level in and out instead", () => {
    const editor = editorWith(ul(li("A"), li("B")));
    cursorIn(editor, "B");
    expect(editor.commands.indent()).toBe(true);
    expect(stored(editor)).toEqual([ul(li("A", ul(li("B"))))]);
    expect(editor.commands.outdent()).toBe(true);
    expect(stored(editor)).toEqual([ul(li("A"), li("B"))]);
  });

  it("drops a paragraph's indent once it is in a list", () => {
    const editor = editorWith(p("Text", 2));
    cursorIn(editor, "Text");
    expect(indents(editor)).toEqual([2]);
    editor.commands.toggleBulletList();
    // In the editor too, not only when saved: it would look indented there.
    expect(indents(editor)).toEqual([0]);
    expect(stored(editor)).toEqual([ul(li("Text"))]);
  });
});

describe("list depth (Tab)", () => {
  // A
  //   B
  //     C
  //     C2
  //   B2
  const deep = ul(li("A", ul(li("B", ul(li("C"), li("C2"))), li("B2"))));

  it("lets a point move in while it stays within 3 levels", () => {
    const editor = editorWith(deep);
    cursorIn(editor, "B2");
    expect(canSinkWithin(editor.state, 3)).toBe(true);
  });

  it("stops at the third level, so Tab moves focus on (no keyboard trap)", () => {
    const editor = editorWith(deep);
    cursorIn(editor, "C2");
    expect(canSinkWithin(editor.state, 3)).toBe(false);
    expect(editor.commands.indent()).toBe(false);
  });

  it("counts the point's own sub-points", () => {
    // B would take C to level 3 — fine; D to level 4 — not.
    const ok = editorWith(ul(li("A"), li("B", ul(li("C")))));
    cursorIn(ok, "B");
    expect(canSinkWithin(ok.state, 3)).toBe(true);
    const tooDeep = editorWith(ul(li("A"), li("B", ul(li("C", ul(li("D")))))));
    cursorIn(tooDeep, "B");
    expect(canSinkWithin(tooDeep.state, 3)).toBe(false);
  });

  it("leaves Tab to the browser at the third level, so focus moves on", () => {
    const editor = editorWith(deep);
    cursorIn(editor, "C2");
    expect(press(editor, "Tab")).toBe(false);
    cursorIn(editor, "B2");
    expect(press(editor, "Tab")).toBe(true);
  });

  it("never sinks a first point or text outside a list", () => {
    // Nothing above it to move under: Tab isn't taken there either.
    const first = editorWith(ul(li("A"), li("B")));
    cursorIn(first, "A");
    expect(first.can().sinkListItem("listItem")).toBe(false);
    expect(first.can().indent()).toBe(false);
    const text = editorWith(p("Text"));
    cursorIn(text, "Text");
    expect(canSinkWithin(text.state, 3)).toBe(false);
  });
});

describe("indent keys", () => {
  // On a Mac, a ⌘[ or ⌘] the editor doesn't take is the browser's Back or
  // Forward: the page — and every unsaved edit on it — would be gone.
  it("takes Ctrl/⌘+[ and ] even when there is nothing to move", () => {
    const flat = editorWith(p("Text"));
    cursorIn(flat, "Text");
    expect(flat.can().outdent()).toBe(false);
    expect(press(flat, "[", true)).toBe(true);
    expect(flat.getJSON().content).toEqual([p("Text")].map(withDefaults));

    const far = editorWith(p("Far", 4));
    cursorIn(far, "Far");
    expect(press(far, "]", true)).toBe(true);
    expect(firstIndent(far)).toBe(4);

    const first = editorWith(ul(li("A"), li("B")));
    cursorIn(first, "A");
    expect(press(first, "]", true)).toBe(true);
    expect(stored(first)).toEqual([ul(li("A"), li("B"))]);
  });

  it("still indents and outdents with them", () => {
    const editor = editorWith(p("Text"));
    cursorIn(editor, "Text");
    expect(press(editor, "]", true)).toBe(true);
    expect(firstIndent(editor)).toBe(1);
    expect(press(editor, "[", true)).toBe(true);
    expect(firstIndent(editor)).toBe(0);
  });
});

describe("typing a number", () => {
  it('starts a numbered list at "1. " to "999. ", from that number', () => {
    for (const [typed, start] of [
      ["1. ", 1],
      ["12. ", 12],
      ["999. ", 999],
    ] as const) {
      const editor = editorWith({ type: "paragraph" });
      editor.commands.setTextSelection(1);
      type(editor, `${typed}Point`);
      const list = ol(li("Point"));
      expect(stored(editor), typed).toEqual([
        start === 1 ? list : { ...list, attrs: { start } },
      ]);
    }
  });

  it('keeps "2024. " as text: learners\' lists can\'t start there', () => {
    const editor = editorWith({ type: "paragraph" });
    editor.commands.setTextSelection(1);
    type(editor, "2024. Was a big year");
    expect(stored(editor)).toEqual([p("2024. Was a big year")]);
  });

  it("continues the list just above with its next number", () => {
    const editor = editorWith(ol(li("One")), { type: "paragraph" });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    type(editor, "2. Two");
    expect(stored(editor)).toEqual([ol(li("One"), li("Two"))]);
  });
});

describe("pasting plain text", () => {
  it("leaves a single line to the normal paste, whatever it starts with", () => {
    // No list from one line: Tiptap's own list paste isn't in the editor.
    for (const line of ["2024. Annual report", "a) Ask first", "I. Introduction", "3. Decide"]) {
      const editor = editorWith({ type: "paragraph" });
      editor.commands.setTextSelection(1);
      expect(pasteTaken(editor, line), line).toBe(false);
    }
  });

  /** Paste `text` at the cursor, as the editor's paste handler does. */
  function pasteText(editor: Editor, text: string) {
    const slice = plainTextSlice(editor.schema, text);
    expect(slice, "a slice for text with line breaks").not.toBeNull();
    editor.view.dispatch(editor.state.tr.replaceSelection(slice!));
  }

  it("makes lists of '1.' and '•' lines, as learners always saw them", () => {
    const editor = editorWith({ type: "paragraph" });
    editor.commands.setTextSelection(1);
    pasteText(editor, "Steps:\n1. Listen\n2. Ask\n\n• Thank them");
    expect(stored(editor)).toEqual([
      p("Steps:"),
      ol(li("Listen"), li("Ask")),
      ul(li("Thank them")),
    ]);
  });

  it("joins its first and last lines to the text around the cursor", () => {
    const editor = editorWith(p("ab"));
    editor.commands.setTextSelection(2);
    pasteText(editor, "x\ny");
    expect(stored(editor)).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "ax" },
          { type: "hardBreak" },
          { type: "text", text: "yb" },
        ],
      },
    ]);
  });

  it("leaves a single line to the normal paste", () => {
    expect(plainTextSlice(schema, "Berlin • Athens • Rome")).toBeNull();
  });
});

describe("blank lines", () => {
  /** The top-level paragraphs marked as blank, by their text's position. */
  function marked(editor: Editor): number[] {
    const plugin = blankLinesKey.get(editor.state);
    const set = plugin?.props.decorations?.call(plugin, editor.state) as
      | DecorationSet
      | null
      | undefined;
    return (set?.find() ?? []).map((d) => d.from);
  }

  it("marks each blank line between paragraphs: learners won't see a gap", () => {
    const editor = editorWith(
      p("One"),
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "   " }] },
      p("Two")
    );
    // "One" is 5 positions long; the next paragraph starts at 5, then 7.
    expect(marked(editor)).toEqual([5, 7]);
  });

  it("leaves an empty editor to its placeholder, and list points alone", () => {
    expect(marked(editorWith({ type: "paragraph" }))).toEqual([]);
    expect(marked(editorWith(ul(li("A"), li("B"))))).toEqual([]);
  });
});

describe("the editor's look", () => {
  // Authors see what learners get (D36): the text is drawn with the
  // learner's own classes. (A key message's highlighted box is drawn
  // around the editor, so its text classes can't be compared this way.)
  it("draws a paragraph and a reflection's introduction as learners see them", () => {
    expect(VARIANT.paragraph.prose).toBe(NARRATIVE_TEXT_CLASS.paragraph);
    expect(VARIANT["reflection-intro"].prose).toBe(REFLECTION_INTRO_CLASS);
  });
});
