import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { indentPadding, RichTextView } from "./RichTextView";

// Static markup is what the server sends and what the client must hydrate
// to, so it's also the check that both render the same thing.
function render(props: Parameters<typeof RichTextView>[0]): string {
  return renderToStaticMarkup(createElement(RichTextView, props));
}

// Docs as the editor's JSON writes them (unchecked input).
type Json = Record<string, unknown>;
const doc = (...content: Json[]) => ({ v: 1, doc: { type: "doc", content } });
const text = (value: string, ...marks: string[]): Json =>
  marks.length
    ? { type: "text", text: value, marks: marks.map((type) => ({ type })) }
    : { type: "text", text: value };
const br: Json = { type: "hardBreak" };
const p = (...content: Json[]): Json => ({ type: "paragraph", content });
const indented = (indent: unknown, ...content: Json[]): Json => ({
  type: "paragraph",
  attrs: { indent },
  content,
});
const li = (...content: Json[]): Json => ({ type: "listItem", content });
const ul = (...items: Json[]): Json => ({ type: "bulletList", content: items });
const ol = (start: unknown, ...items: Json[]): Json => ({
  type: "orderedList",
  attrs: { start },
  content: items,
});

// Rich text keeps typed spaces, as the editor does; plain text renders as
// in Round 1.
const wrap = (html: string) =>
  `<div class="seq-prose whitespace-break-spaces">${html}</div>`;
const plainWrap = (html: string) => `<div class="seq-prose">${html}</div>`;

describe("RichTextView", () => {
  it("renders bold, italic and both, bold outside italic", () => {
    expect(
      render({
        rich: doc(
          p(
            text("Plain "),
            text("bold", "bold"),
            text(" "),
            text("italic", "italic"),
            text(" "),
            text("both", "italic", "bold")
          )
        ),
      })
    ).toBe(
      wrap(
        "<p>Plain <strong>bold</strong> <em>italic</em> <strong><em>both</em></strong></p>"
      )
    );
  });

  it("renders line breaks inside a paragraph", () => {
    expect(render({ rich: doc(p(text("One"), br, text("Two"))) })).toBe(
      wrap("<p>One<br/>Two</p>")
    );
  });

  it("renders list items tight, with nested lists inside the item", () => {
    expect(
      render({
        rich: doc(
          ul(
            li(
              p(text("Pause")),
              ul(li(p(text("Breathe"))), li(p(text("Count"))))
            ),
            li(p(text("Decide", "bold")))
          )
        ),
      })
    ).toBe(
      wrap(
        "<ul><li>Pause<ul><li>Breathe</li><li>Count</li></ul></li><li><strong>Decide</strong></li></ul>"
      )
    );
  });

  it("renders further paragraphs of an item as paragraphs after its text", () => {
    expect(
      render({ rich: doc(ul(li(p(text("First")), p(text("More"))))) })
    ).toBe(wrap("<ul><li>First<p>More</p></li></ul>"));
  });

  it("starts a point without text of its own on an empty line, as the editor does", () => {
    // Its text deleted, its sub-list kept: its bullet stays on a line of its
    // own instead of joining the sub-list's first line.
    const empty = { type: "paragraph" };
    expect(
      render({ rich: doc(ul(li(empty, ul(li(p(text("Child"))))))) })
    ).toBe(wrap("<ul><li><br/><ul><li>Child</li></ul></li></ul>"));
    expect(render({ rich: doc(ul(li(empty, p(text("More"))))) })).toBe(
      wrap("<ul><li><br/><p>More</p></li></ul>")
    );
  });

  it("keeps spaces as typed, as the editor shows them", () => {
    const html = render({ rich: doc(p(text("  a  b"))) });
    expect(html).toBe(wrap("<p>  a  b</p>"));
    expect(html).toContain('class="seq-prose whitespace-break-spaces"');
    // Plain text is rendered as it always was.
    expect(render({ text: "a  b" })).toBe(plainWrap("<p>a  b</p>"));
  });

  it("always writes the start number of a numbered list", () => {
    expect(render({ rich: doc(ol(undefined, li(p(text("a"))))) })).toBe(
      wrap('<ol start="1"><li>a</li></ol>')
    );
    expect(render({ rich: doc(ol(4, li(p(text("d"))))) })).toBe(
      wrap('<ol start="4"><li>d</li></ol>')
    );
    expect(render({ rich: doc(ol(0, li(p(text("zero"))))) })).toBe(
      wrap('<ol start="0"><li>zero</li></ol>')
    );
  });

  it("clamps the start number", () => {
    expect(render({ rich: doc(ol(123456, li(p(text("a"))))) })).toBe(
      wrap('<ol start="999"><li>a</li></ol>')
    );
    expect(render({ rich: doc(ol("7", li(p(text("a"))))) })).toBe(
      wrap('<ol start="1"><li>a</li></ol>')
    );
  });

  it("nests numbered lists in bullets and the other way round", () => {
    expect(
      render({
        rich: doc(ol(1, li(p(text("Step")), ul(li(p(text("detail")))))))
      })
    ).toBe(
      wrap('<ol start="1"><li>Step<ul><li>detail</li></ul></li></ol>')
    );
  });

  it("indents paragraphs by 1.5rem a step, at most 4 steps", () => {
    expect(render({ rich: doc(indented(1, text("One"))) })).toBe(
      wrap('<p style="padding-inline-start:1.5rem">One</p>')
    );
    expect(render({ rich: doc(indented(4, text("Four"))) })).toBe(
      wrap('<p style="padding-inline-start:6rem">Four</p>')
    );
    expect(render({ rich: doc(indented(99, text("Far"))) })).toBe(
      wrap('<p style="padding-inline-start:6rem">Far</p>')
    );
  });

  it("ignores an indent that isn't a positive number", () => {
    for (const indent of [0, -2, "3", "1rem; color: red", null, Number.NaN]) {
      expect(render({ rich: doc(indented(indent, text("x"))) })).toBe(
        wrap("<p>x</p>")
      );
    }
  });

  it("shows lists nested deeper than three levels at three, keeping the text", () => {
    const deep = ul(
      li(
        p(text("L1")),
        ul(li(p(text("L2")), ul(li(p(text("L3")), ul(li(p(text("L4"))))))))
      )
    );
    const html = render({ rich: doc(deep) });
    expect(html).toBe(
      wrap(
        "<ul><li>L1<ul><li>L2<ul><li>L3</li><li>L4</li></ul></li></ul></li></ul>"
      )
    );
    expect(html).not.toMatch(/(<ul>.*){4}/);
  });

  it("skips empty paragraphs and renders nothing for an empty doc", () => {
    expect(render({ rich: doc(p(), p(text("Text")), p(text("   "))) })).toBe(
      wrap("<p>Text</p>")
    );
    expect(render({ rich: doc(p()) })).toBe("");
    expect(render({ rich: doc() })).toBe("");
  });

  it("prefers usable rich text over the plain text beside it", () => {
    expect(
      render({ rich: doc(p(text("Rich", "bold"))), text: "Plain" })
    ).toBe(wrap("<p><strong>Rich</strong></p>"));
    // An author who cleared the block cleared both.
    expect(render({ rich: doc(p()), text: "stale" })).toBe("");
  });

  it("shows the plain text, by Round 1's rules, when there is no rich text", () => {
    expect(render({ text: "Remember:\n• Pause\n• Decide" })).toBe(
      plainWrap("<p>Remember:</p><ul><li>Pause</li><li>Decide</li></ul>")
    );
    expect(render({ rich: null, text: "Hi" })).toBe(plainWrap("<p>Hi</p>"));
    expect(render({})).toBe("");
  });

  it("falls back to the plain text for a format version it doesn't know", () => {
    const v2 = { v: 2, doc: { type: "doc", content: [p(text("New"))] } };
    expect(render({ rich: v2, text: "Fallback" })).toBe(
      plainWrap("<p>Fallback</p>")
    );
  });

  it("falls back to the plain text for rich text it can't use", () => {
    for (const rich of [
      "<p>html</p>",
      42,
      [],
      { v: 1 },
      { v: 1, doc: { type: "paragraph", content: [] } },
      { v: 1, doc: { type: "doc", content: "nope" } },
      // Over the text limit: refused, never half shown.
      doc(p(text("x".repeat(20_000)))),
    ]) {
      expect(render({ rich, text: "Fallback" })).toBe(
        plainWrap("<p>Fallback</p>")
      );
    }
  });

  it("ends cyclic input with a result instead of hanging", () => {
    const item: Json = { type: "listItem", content: [] };
    const list: Json = { type: "bulletList", content: [item] };
    (item.content as Json[]).push(p(text("loop")), list);
    // It runs out of the node budget, so it can't be used at all.
    expect(render({ rich: doc(list), text: "Fallback" })).toBe(
      plainWrap("<p>Fallback</p>")
    );
  });

  it("adds the compact spacing and the caller's classes", () => {
    expect(
      render({
        rich: doc(p(text("Hi"))),
        compact: true,
        className: "inline-block text-sm",
      })
    ).toBe(
      '<div class="seq-prose seq-prose-compact whitespace-break-spaces inline-block text-sm"><p>Hi</p></div>'
    );
  });
});

describe("indentPadding", () => {
  it("is 1.5rem a step, from 1 to 4 steps", () => {
    expect(indentPadding(1)).toBe("1.5rem");
    expect(indentPadding(2)).toBe("3rem");
    expect(indentPadding(2.7)).toBe("3rem");
    expect(indentPadding(4)).toBe("6rem");
    expect(indentPadding(40)).toBe("6rem");
  });

  it("is none for zero, negative or non-numbers", () => {
    for (const indent of [0, -1, "2", null, undefined, Infinity, Number.NaN]) {
      expect(indentPadding(indent)).toBeNull();
    }
  });
});

describe("RichTextView keeps hostile content inert", () => {
  const hostile = doc(
    { type: "heading", attrs: { level: 1 }, content: [text("Heading")] },
    { type: "image", attrs: { src: "x", onerror: "alert(1)" } },
    {
      type: "paragraph",
      attrs: { style: "color:red", onclick: "alert(1)", class: "evil" },
      content: [
        text("<script>alert(1)</script>"),
        {
          type: "text",
          text: " click me",
          marks: [
            { type: "link", attrs: { href: "javascript:alert(1)" } },
            { type: "bold" },
          ],
        },
        { type: "image", attrs: { src: "javascript:alert(1)" } },
        text(' <img src=x onerror="alert(1)">'),
        {
          type: "text",
          text: "styled",
          marks: [{ type: "textStyle", attrs: { color: "red" } }],
        },
      ],
    },
    { type: "codeBlock", content: [text("rm -rf /")] },
    {
      type: "bulletList",
      attrs: { style: "list-style: url(javascript:alert(1))" },
      content: [
        li(p({ type: "text", text: "item", marks: [{ type: "underline" }] })),
        { type: "table", content: [] },
      ],
    }
  );

  const html = render({ rich: hostile });

  it("escapes markup in text instead of rendering it", () => {
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("emits no links, images, scripts or other elements", () => {
    expect(html).not.toMatch(/<(a|img|script|h1|pre|code|table|u|span|style)\b/i);
    expect(html).not.toMatch(/<(?!\/?(?:div|p|ul|ol|li|br|strong|em)\b)/);
  });

  it("emits no attributes but the root class", () => {
    // Every opening tag: text is escaped, so a "<" in it can't start one.
    const tags = html.match(/<[a-z][^>]*>/gi) ?? [];
    expect(tags[0]).toBe('<div class="seq-prose whitespace-break-spaces">');
    for (const tag of tags.slice(1)) {
      expect(tag).toMatch(/^<(?:p|ul|ol|li|br\/|strong|em)>$/);
    }
  });

  it("keeps the whitelisted formatting and the text", () => {
    expect(html).toBe(
      wrap(
        "<p>&lt;script&gt;alert(1)&lt;/script&gt;<strong> click me</strong> &lt;img src=x onerror=&quot;alert(1)&quot;&gt;styled</p>" +
          "<ul><li>item</li></ul>"
      )
    );
  });
});
