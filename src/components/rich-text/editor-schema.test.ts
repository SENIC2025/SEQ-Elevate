import { describe, it, expect, afterEach } from "vitest";
import { Editor, getSchema, type JSONContent } from "@tiptap/core";
import { editorExtensions, plainTextSlice } from "./editor-extensions";
import { canSinkWithin } from "./indent-extension";
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

/** Every paragraph's indent, lists included. */
function indents(editor: Editor): number[] {
  const out: number[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "paragraph") out.push(node.attrs.indent);
  });
  return out;
}

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

describe("pasting plain text", () => {
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
