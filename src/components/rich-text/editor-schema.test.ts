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
import { linkRange } from "./link-extension";
import { VARIANT, editorChange, openingDoc, problemLine, removedLinksNote, toolbarTools } from "./RichTextEditor";
import { NARRATIVE_TEXT_CLASS } from "@/components/course/NarrativeStage";
import { REFLECTION_INTRO_CLASS } from "@/components/course/ReflectionIntro";
import { legacyTextToDoc } from "@/lib/rich-text/from-legacy";
import { sanitizeRichText } from "@/lib/rich-text/sanitize";
import { checkLinkHref } from "@/lib/rich-text/link-url";
import { LINK_INPUTS } from "@/lib/rich-text/link-fixtures";
import { ownFileHost } from "@/lib/rich-text/own-file-host";
import type { RichText, RichTextV1 } from "@/lib/rich-text/types";

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
    // and italic together draw <strong><em>, as for learners. Release 4
    // (D104): and a link, last, as the stored format orders marks.
    expect(Object.keys(schema.marks)).toEqual(["bold", "italic", "link"]);
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

describe("indent, where a text's layout sets it (the references list)", () => {
  // .seq-references hangs every entry alike: an indent step would show
  // nothing there, so the references editor has none to give.
  const listEditor = (...content: JSONContent[]) => {
    const editor = new Editor({
      element: null,
      extensions: editorExtensions("", { indent: VARIANT.references.indent }),
      content: { type: "doc", content },
    });
    editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
    open.push(editor);
    return editor;
  };

  it("gives an entry no indent step, by command or shortcut", () => {
    const editor = listEditor(p("Entry"));
    cursorIn(editor, "Entry");
    expect(editor.can().indent()).toBe(false);
    expect(editor.commands.indent()).toBe(false);
    press(editor, "]", true);
    expect(firstIndent(editor)).toBe(0);
  });

  it("keeps no indent step from a paste or a stored entry", () => {
    // Word's Bibliography style: a half-inch margin, one step anywhere else.
    const pasted = { style: { paddingInlineStart: "", marginLeft: ".5in" }, closest: () => null } as unknown as HTMLElement;
    const indentOf = (indent: boolean) => {
      const rule = getSchema(editorExtensions("", { indent })).nodes.paragraph.spec.parseDOM?.[0];
      return (rule?.getAttrs?.(pasted) as { indent?: number } | null)?.indent;
    };
    expect(indentOf(true)).toBe(1);
    expect(indentOf(false)).toBe(0);
    const storedList = { v: 1, doc: { type: "doc", content: [p("Stored", 2), ul(li("Point"))] } };
    expect(openingDoc(storedList, "Stored", { indent: false }).doc).toEqual({ type: "doc", content: [p("Stored"), ul(li("Point"))] });
    // Every other text opens with its indent.
    expect(openingDoc(storedList, "Stored").doc.content?.[0]).toEqual(p("Stored", 2));
  });

  it("still moves a list point in and out", () => {
    const editor = listEditor(ul(li("A"), li("B")));
    cursorIn(editor, "B");
    expect(editor.commands.indent()).toBe(true);
    expect(stored(editor)).toEqual([ul(li("A", ul(li("B"))))]);
  });

  it("leaves indent to every other text", () => {
    for (const variant of ["paragraph", "callout", "reflection-intro"] as const) expect(VARIANT[variant].indent, variant).toBe(true);
    expect(VARIANT.references.indent).toBe(false);
  });

  it("has no Indent buttons in the references toolbar, and both in every other", () => {
    const ids = (indent: boolean) => toolbarTools(indent).map((tool) => tool.id);
    expect(ids(false)).not.toContain("indent");
    expect(ids(false)).not.toContain("outdent");
    expect(ids(false)).toEqual(expect.arrayContaining(["bold", "italic", "link", "unlink", "bullets", "numbers", "undo", "redo"]));
    expect(ids(true)).toEqual(expect.arrayContaining(["indent", "outdent"]));
    expect(ids(true).length).toBe(ids(false).length + 2);
  });
});

describe("the problem line's advice", () => {
  // Each text is told what its editor offers: a lesson's block can be
  // split into two; an introduction and the references list are one text.
  const paragraphOf = (content: JSONContent[]) => ({ v: 2, doc: { type: "doc", content: [{ type: "paragraph", content }] } });
  const linked = (text: string, href: string): JSONContent => ({ type: "text", text, marks: [{ type: "link", attrs: { href } }] });
  const long = sanitizeRichText({ v: 1, doc: { type: "doc", content: [p("x".repeat(10_001))] } });
  // 1,600 links and words in under 10,000 characters: too many nodes.
  const crowded = sanitizeRichText(
    paragraphOf(Array.from({ length: 1_600 }, (_, i) => (i % 2 ? { type: "text", text: " " } : linked(`w${i}`, `https://example.org/${i}`))))
  );

  it("splits a paragraph or a key message into two blocks", () => {
    expect(problemLine("paragraph", long)).toBe("This paragraph is too long — at most 10,000 characters. Split it into two blocks.");
    expect(problemLine("callout", long)).toBe("This key message is too long — at most 10,000 characters. Split it into two blocks.");
  });

  it("shortens an introduction, and the references list", () => {
    expect(problemLine("reflection-intro", long)).toBe("This introduction is too long — at most 10,000 characters. Shorten it.");
    expect(problemLine("references", long)).toBe("The references list is too long — at most 10,000 characters. Shorten the list.");
    expect(problemLine("references", crowded)).toBe(
      "The references list has too many links or too much formatting to save. Shorten the list."
    );
  });

  it("names a link's problem when the text can be saved otherwise", () => {
    const misleading = sanitizeRichText(paragraphOf([linked("bank.example", "https://evil.example/")]));
    expect(problemLine("references", misleading)).toBe(
      "The link text “bank.example” looks like a web address, but the link opens another one. Use a few words instead, or show the real address."
    );
    expect(problemLine("references", sanitizeRichText({ v: 1, doc: { type: "doc", content: [p("Fine")] } }))).toBeNull();
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

/* --------------------------------------------- Links (Release 4, U8, D104) */

/** An element as the parse rule reads it: only its attributes. */
const anchor = (attrs: Record<string, unknown>) =>
  ({ getAttribute: (name: string) => (typeof attrs[name] === "string" ? attrs[name] : null) }) as unknown as HTMLElement;

/** What the link mark's parse rule makes of `<a href>`: its attributes, or false (the text stays, unlinked). */
function parsed(href: unknown) {
  const rule = schema.marks.link.spec.parseDOM?.find((r) => "tag" in r && r.tag === "a[href]");
  if (!rule || !("getAttrs" in rule) || !rule.getAttrs) throw new Error("no a[href] rule");
  return rule.getAttrs(anchor({ href, target: "_self", onclick: "alert(1)", class: "x" }) as never);
}

/** The mark's drawing for `href`, as ProseMirror gets it. */
function drawn(href: unknown) {
  const mark = schema.marks.link.create({ href });
  return schema.marks.link.spec.toDOM!(mark, true) as unknown as [string, Record<string, string>, number];
}

describe("the link mark (D104)", () => {
  it("is not inclusive (typing after a link doesn't extend it) and stores only its address", () => {
    expect(schema.marks.link.spec.inclusive).toBe(false);
    expect(Object.keys(schema.marks.link.spec.attrs ?? {})).toEqual(["href"]);
  });

  it("takes a pasted <a href> exactly when the address check accepts it, normalised; never our own files", () => {
    const own = { ownFileHost: ownFileHost() };
    for (const href of LINK_INPUTS) {
      if (typeof href !== "string") continue;
      const check = checkLinkHref(href, own);
      const label = JSON.stringify(href.slice(0, 80));
      if (check.ok && !check.ownFile) expect(parsed(href), label).toEqual({ href: check.href });
      else expect(parsed(href), label).toBe(false);
    }
  });

  it("draws an address only when the check accepts it, and never any other attribute", () => {
    expect(drawn("HTTPS://Example.org/guide")).toEqual([
      "a",
      { href: "https://example.org/guide", class: "seq-link", rel: "noopener noreferrer", target: "_blank" },
      0,
    ]);
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "https://e2e-store.public.blob.vercel-storage.com/handout.pdf",
      "https://user:pw@evil.example",
      42,
      null,
    ]) {
      expect(drawn(href), String(href)).toEqual(["a", { class: "seq-link" }, 0]);
    }
  });

  it("opens every stored shape with links, and gives it back unchanged", () => {
    const stored: RichText = {
      v: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Read " },
              { type: "text", text: "the ", marks: [{ type: "link", attrs: { href: "https://example.org/guide" } }] },
              {
                type: "text",
                text: "guide",
                marks: [{ type: "bold" }, { type: "italic" }, { type: "link", attrs: { href: "https://example.org/guide" } }],
              },
              { type: "text", text: "two", marks: [{ type: "link", attrs: { href: "mailto:help@example.org?subject=Hi" } }] },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "point", marks: [{ type: "link", attrs: { href: "http://example.org/" } }] }],
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
    expect(sanitizeRichText({ v: 1, doc: node.toJSON() }).value).toEqual(stored);
  });

  it("links a selection only to an address the check accepts, and unlinks the whole link", () => {
    const editor = editorWith(p("Read the guide today"));
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText) from = pos + "Read ".length;
    });
    editor.commands.setTextSelection({ from, to: from + "the guide".length });
    for (const bad of ["javascript:alert(1)", "https://e2e-store.public.blob.vercel-storage.com/x.pdf", "www.example.org"]) {
      expect(editor.commands.setLessonLink({ href: bad }), bad).toBe(false);
    }
    expect(stored(editor)).toEqual([p("Read the guide today")]);
    expect(editor.commands.setLessonLink({ href: "HTTPS://Example.org/guide" })).toBe(true);
    expect(stored(editor)).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Read " },
          { type: "text", text: "the guide", marks: [{ type: "link", attrs: { href: "https://example.org/guide" } }] },
          { type: "text", text: " today" },
        ],
      },
    ]);
    // The cursor anywhere in the link: Remove link takes all of it.
    editor.commands.setTextSelection(from + 2);
    expect(editor.isActive("link")).toBe(true);
    expect(editor.commands.unsetLessonLink()).toBe(true);
    expect(stored(editor)).toEqual([p("Read the guide today")]);
  });

  it("doesn't extend a link to text typed after it", () => {
    const editor = editorWith({
      type: "paragraph",
      content: [{ type: "text", text: "guide", marks: [{ type: "link", attrs: { href: "https://example.org/" } }] }],
    });
    cursorIn(editor, "guide");
    type(editor, " more");
    expect(stored(editor)).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "guide", marks: [{ type: "link", attrs: { href: "https://example.org/" } }] },
          { type: "text", text: " more" },
        ],
      },
    ]);
  });
});

describe("openingDoc (what the editor opens)", () => {
  const linked = (text: string, href: string) => ({ type: "text", text, marks: [{ type: "link", attrs: { href } }] });
  /** A stored version-2 paragraph over the node limit (1,501 text nodes) with hostile links. */
  const overLimit = {
    v: 2,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            linked("First ", "javascript:alert(1)"),
            linked("second ", "data:text/html,<script>alert(1)</script>"),
            ...Array.from({ length: 1_499 }, (_, i) => ({ type: "text", text: `w${i} `, marks: [{ type: "italic" }] })),
          ],
        },
      ],
    },
  };

  it("opens an over-limit doc that holds a link as the block's text, with the problem", () => {
    const opened = openingDoc(overLimit, "An over-limit block, opened as its text.");
    expect(opened.doc).toEqual(legacyTextToDoc("An over-limit block, opened as its text."));
    expect(opened.issues).toContain("too-many-nodes");
    expect(JSON.stringify(opened.doc)).not.toMatch(/javascript|data:|link/);
  });

  it("still opens an over-limit doc without a link as it is", () => {
    const plain = {
      v: 1,
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: Array.from({ length: 1_501 }, (_, i) => ({ type: "text", text: `w${i} `, marks: [{ type: "italic" }] })) }],
      },
    };
    const opened = openingDoc(plain, "text");
    expect(opened.doc).toBe(plain.doc);
    expect(opened.issues).toEqual(["too-many-nodes"]);
  });

  it("counts running out of its walk as finding a link", () => {
    // Marks the sanitizer never gets to: the walk is bounded too.
    const deep = {
      v: 1,
      doc: {
        type: "doc",
        content: Array.from({ length: 7_000 }, () => ({ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }] })),
      },
    };
    expect(openingDoc(deep, "As text").doc).toEqual(legacyTextToDoc("As text"));
  });

  it("opens a stored doc with links sanitized: refused links as text, accepted ones normalised", () => {
    const opened = openingDoc(
      { v: 2, doc: { type: "doc", content: [{ type: "paragraph", content: [linked("bad", "javascript:x"), { type: "text", text: " " }, linked("good", "HTTPS://Example.org/")] }] } },
      "unused"
    );
    expect(opened.doc).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "bad " }, linked("good", "https://example.org/")] }],
    });
    expect(() => schema.nodeFromJSON(opened.doc).check()).not.toThrow();
  });
});

describe("removedLinksNote (a stored link the check refuses, named when the editor opens)", () => {
  const linked = (text: string, href: string) => ({ type: "text", text, marks: [{ type: "link", attrs: { href } }] });
  const stored = (...content: unknown[]) => ({ v: 2, doc: { type: "doc", content: [{ type: "paragraph", content }] } });

  it("names the one link removed, and says what to do", () => {
    const opened = openingDoc(stored(linked("the guide", "javascript:alert(1)"), { type: "text", text: " today" }), "unused");
    expect(removedLinksNote(opened.removedLinks)).toBe(
      "The link “the guide” can't be used and was removed. Add it again with the Link button."
    );
  });

  it("names the first of several, misleading ones included", () => {
    const opened = openingDoc(
      stored(linked("https://bank.example", "https://evil.example/"), { type: "text", text: " and " }, linked("old", "file:///C:/x")),
      "unused"
    );
    expect(removedLinksNote(opened.removedLinks)).toBe(
      "Links that can't be used were removed, the first “old”. Add them again with the Link button."
    );
  });

  it("says nothing when no link was removed (a link to our own files stays, named as a problem)", () => {
    const opened = openingDoc(stored(linked("handout", "https://e2e-store.public.blob.vercel-storage.com/x.pdf")), "unused");
    expect(opened.removedLinks).toEqual([]);
    expect(removedLinksNote(opened.removedLinks)).toBeNull();
    expect(opened.linkProblems).toEqual([{ text: "handout", reason: "own-file" }]);
  });
});

describe("editorChange (what the editor hands up after an edit)", () => {
  const linked = (text: string, href: string) => ({ type: "text", text, marks: [{ type: "link", attrs: { href } }] });
  const docOf = (...content: unknown[]): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content }] as JSONContent[] });
  const change = (doc: JSONContent) => editorChange(doc, sanitizeRichText({ v: 1, doc }));

  it("hands up a text it can save as it is, and its plain text", () => {
    const doc = docOf({ type: "text", text: "Read " }, linked("the guide", "https://example.org/guide"));
    expect(change(doc)).toEqual({
      rich: { v: 2, doc },
      text: "Read the guide (https://example.org/guide)",
    });
  });

  it("hands up a link the save would refuse as it is, with the paragraph's words beside it", () => {
    // An older save (a rollback to Release 3) stores the words, never an empty paragraph.
    const doc = docOf({ type: "text", text: "Read " }, linked("the https://bank.example guide", "https://evil.example/"), { type: "text", text: " today." });
    const { rich, text } = change(doc);
    expect(rich).toEqual({ v: 2, doc });
    expect(text).toBe("Read the https://bank.example guide today.");
  });

  it("hands up text over a limit as it is, with its words and its links' addresses beside it", () => {
    const doc = docOf(
      linked("the guide", "https://example.org/guide"),
      ...Array.from({ length: 1_500 }, (_, i) => ({ type: "text", text: ` w${i}`, marks: [{ type: i % 2 ? "bold" : "italic" }] }))
    );
    const { rich, text } = change(doc);
    expect(rich.v).toBe(2);
    expect(text.startsWith("the guide (https://example.org/guide) w0 w1")).toBe(true);
  });
});

describe("linkRange (what Link and Remove link act on)", () => {
  const linked = (text: string, href: string): JSONContent => ({
    type: "text",
    text,
    marks: [{ type: "link", attrs: { href } }],
  });
  const at = (editor: Editor, text: string, offset: number) => {
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (node.isText && node.text === text) pos = p + offset;
    });
    return pos;
  };

  it("is the whole link around the cursor, across formatting, and none just after it", () => {
    const editor = editorWith({
      type: "paragraph",
      content: [
        { type: "text", text: "Read " },
        linked("the ", "https://example.org/a"),
        { type: "text", text: "guide", marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.org/a" } }] },
        { type: "text", text: " today" },
      ],
    });
    const start = at(editor, "the ", 0);
    editor.commands.setTextSelection(start + 2);
    expect(linkRange(editor.state)).toEqual({ from: start, to: start + "the guide".length });
    // Right after the link: not in it.
    editor.commands.setTextSelection(start + "the guide".length);
    expect(linkRange(editor.state)).toBeNull();
    // A selection that starts right after it doesn't take it in.
    editor.commands.setTextSelection({ from: start + "the guide".length, to: start + "the guide to".length });
    expect(linkRange(editor.state)).toBeNull();
    // A selection over part of it: widened to all of it.
    editor.commands.setTextSelection({ from: start - 2, to: start + 2 });
    expect(linkRange(editor.state)).toEqual({ from: start - 2, to: start + "the guide".length });
  });

  it("tells touching links apart", () => {
    const editor = editorWith({
      type: "paragraph",
      content: [linked("one", "https://example.org/a"), linked("two", "https://example.org/b")],
    });
    const two = at(editor, "two", 0);
    editor.commands.setTextSelection(two + 1);
    expect(linkRange(editor.state)).toEqual({ from: two, to: two + 3 });
  });
});
