import { describe, it, expect } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
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
    // Version 2 is Release 4's (links); version 3 is unknown.
    const v3 = { v: 3, doc: { type: "doc", content: [p(text("New"))] } };
    expect(render({ rich: v3, text: "Fallback" })).toBe(
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

// Quick links: web and email addresses typed in lesson text are links for
// learners, with the "(opens in a new tab)" cue in the interface language.
const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  children?: ReactNode;
}>;

function renderIn(
  locale: "en" | "de" | "el",
  props: Parameters<typeof RichTextView>[0]
): string {
  const messages = { en, de, el }[locale] as typeof en;
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale, messages },
      createElement(RichTextView, props)
    )
  );
}

const linkTo = (href: string, inner: string, cue = "(opens in a new tab)") =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer" class="seq-link">${inner}<span class="sr-only"> ${cue}</span></a>`;

describe("RichTextView quick links", () => {
  it("links a web address typed in rich text, punctuation outside", () => {
    expect(
      renderIn("en", { rich: doc(p(text("Read https://example.org/guide."))) })
    ).toBe(
      wrap(
        `<p>Read ${linkTo("https://example.org/guide", "https://example.org/guide")}.</p>`
      )
    );
  });

  it("links an email address as mailto", () => {
    expect(
      renderIn("en", { rich: doc(p(text("Ask help@example.org (any time)"))) })
    ).toBe(
      wrap(
        `<p>Ask ${linkTo("mailto:help@example.org", "help@example.org")} (any time)</p>`
      )
    );
  });

  it("keeps bold and italic inside the link", () => {
    expect(
      renderIn("en", {
        rich: doc(
          p(
            text("See "),
            text("https://example.org", "bold"),
            text(" or "),
            text("help@example.org", "italic", "bold")
          )
        ),
      })
    ).toBe(
      wrap(
        `<p>See ${linkTo("https://example.org/", "<strong>https://example.org</strong>")} or ${linkTo(
          "mailto:help@example.org",
          "<strong><em>help@example.org</em></strong>"
        )}</p>`
      )
    );
  });

  it("links addresses in list items, nested ones too", () => {
    expect(
      renderIn("en", {
        rich: doc(
          ul(
            li(
              p(text("Site: https://example.org")),
              ul(li(p(text("help@example.org"))))
            )
          )
        ),
      })
    ).toBe(
      wrap(
        `<ul><li>Site: ${linkTo("https://example.org/", "https://example.org")}<ul><li>${linkTo(
          "mailto:help@example.org",
          "help@example.org"
        )}</li></ul></li></ul>`
      )
    );
  });

  it("links addresses in plain (legacy) text, in its lists too", () => {
    expect(
      renderIn("en", {
        text: "More at (https://example.org/a_(b)).\n• Mail mailto:help@example.org",
      })
    ).toBe(
      plainWrap(
        `<p>More at (${linkTo("https://example.org/a_(b)", "https://example.org/a_(b)")}).</p>` +
          `<ul><li>Mail ${linkTo("mailto:help@example.org", "mailto:help@example.org")}</li></ul>`
      )
    );
  });

  it("says the link opens in a new tab in the interface language", () => {
    const rich = doc(p(text("https://example.org")));
    expect(renderIn("de", { rich })).toContain(
      '<span class="sr-only"> (öffnet in einem neuen Tab)</span>'
    );
    expect(renderIn("el", { rich })).toContain(
      '<span class="sr-only"> (ανοίγει σε νέα καρτέλα)</span>'
    );
  });

  it("never links other schemes, in any letter case", () => {
    const html = renderIn("en", {
      rich: doc(
        p(
          text(
            "javascript:alert(1) JavaScript:alert(1) data:text/html,x vbscript:x file:///etc/passwd"
          )
        )
      ),
      text: "unused",
    });
    expect(html).not.toContain("<a");
    expect(html).toBe(
      wrap(
        "<p>javascript:alert(1) JavaScript:alert(1) data:text/html,x vbscript:x file:///etc/passwd</p>"
      )
    );
  });

  it("escapes what an address carries into the href", () => {
    const html = renderIn("en", {
      rich: doc(p(text("https://example.org/?q='x'&y=1"))),
    });
    expect(html).toContain('href="https://example.org/?q=%27x%27&amp;y=1"');
  });

  it("shows addresses as links but not as controls in an inert preview", () => {
    // The lesson editor's block preview is itself a button: a link inside
    // it would be a control inside a control.
    expect(
      render({ rich: doc(p(text("Go to https://example.org"))), inertLinks: true })
    ).toBe(wrap('<p>Go to <span class="seq-link">https://example.org</span></p>'));
  });

  it("renders text without addresses exactly as before", () => {
    // Rendered without a messages provider: no address, no translation.
    expect(render({ rich: doc(p(text("No links here."))) })).toBe(
      wrap("<p>No links here.</p>")
    );
    expect(render({ text: "• a@ b\n• example.org" })).toBe(
      plainWrap("<ul><li>a@ b</li><li>example.org</li></ul>")
    );
  });
});

/* ------------------------------------------- Named links (Release 4, U7) */

const named = (value: string, href: unknown, ...marks: string[]): Json => ({
  type: "text",
  text: value,
  marks: [...marks.map((type) => ({ type })), { type: "link", attrs: { href } }],
});
const v2 = (...content: Json[]) => ({ v: 2, doc: { type: "doc", content } });

/**
 * The site a named link opens, after its words and inside it (the owner's
 * decision of 22 October 2026): a ", " that only screen readers hear, then
 * the site in a box. The ", " stays inline (not .sr-only, which is
 * absolutely positioned): browsers put a space around a block in a link's
 * name, which would read "the guide , example.org".
 */
const siteBox = (site: string) => `<span class="seq-link-sep">, </span><span class="seq-link-site">${site}</span>`;
/** A named link drawn live: its words, the site's box (none for null), the new-tab cue. */
const namedTo = (href: string, inner: string, site: string | null, cue = "(opens in a new tab)") =>
  linkTo(href, `${inner}${site === null ? "" : siteBox(site)}`, cue);
/** The same in an inert preview: a span that says where it goes. */
const inertNamed = (title: string, inner: string, site: string | null) =>
  `<span class="seq-link" title="${title}">${inner}${site === null ? "" : siteBox(site)}</span>`;

/** What a link's text adds up to, in order, as a browser names an <a> whose parts are all inline but the cue. */
const linkNames = (html: string) =>
  [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) =>
    m[1]
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
  );

describe("RichTextView named links (D104)", () => {
  it("draws a link as one <a> opening in a new tab, bold and italic inside it", () => {
    expect(
      renderIn("en", {
        rich: v2(
          p(
            text("Read "),
            named("the ", "https://example.org/guide"),
            named("guide", "https://example.org/guide", "bold"),
            named(" now", "https://example.org/guide", "italic"),
            text(" today.")
          )
        ),
      })
    ).toBe(
      wrap(`<p>Read ${namedTo("https://example.org/guide", "the <strong>guide</strong><em> now</em>", "example.org")} today.</p>`)
    );
  });

  it("draws the address as stored, normalised by the check on every render", () => {
    expect(renderIn("en", { rich: v2(p(named("Bücher", "https://bücher.example/straße"))) })).toBe(
      wrap(`<p>${namedTo("https://xn--bcher-kva.example/stra%C3%9Fe", "Bücher", "xn--bcher-kva.example")}</p>`)
    );
  });

  it("draws neighbouring links to different addresses as two links", () => {
    expect(
      renderIn("en", { rich: v2(p(named("one", "https://example.org/a"), named("two", "https://example.org/b"))) })
    ).toBe(
      wrap(`<p>${namedTo("https://example.org/a", "one", "example.org")}${namedTo("https://example.org/b", "two", "example.org")}</p>`)
    );
  });

  it("ends a link at a line break", () => {
    expect(
      renderIn("en", { rich: v2(p(named("one", "https://example.org/a"), br, named("two", "https://example.org/a"))) })
    ).toBe(
      wrap(`<p>${namedTo("https://example.org/a", "one", "example.org")}<br/>${namedTo("https://example.org/a", "two", "example.org")}</p>`)
    );
  });

  it("finds quick links only in unlinked text: a typed address never runs into a named link", () => {
    expect(
      renderIn("en", {
        rich: v2(p(text("See https://example.org/"), named("guide", "https://example.org/guide"), text(" or help@example.org"))),
      })
    ).toBe(
      wrap(
        `<p>See ${linkTo("https://example.org/", "https://example.org/")}${namedTo(
          "https://example.org/guide",
          "guide",
          "example.org"
        )} or ${linkTo("mailto:help@example.org", "help@example.org")}</p>`
      )
    );
    // A named link whose text is an address is one link, not a link inside a link.
    const html = renderIn("en", { rich: v2(p(named("https://example.org/guide", "https://example.org/guide"))) });
    expect(html).toBe(wrap(`<p>${namedTo("https://example.org/guide", "https://example.org/guide", null)}</p>`));
  });

  it("draws links in list points", () => {
    expect(renderIn("en", { rich: v2(ul(li(p(named("Tips", "https://example.org/tips"))))) })).toBe(
      wrap(`<ul><li>${namedTo("https://example.org/tips", "Tips", "example.org")}</li></ul>`)
    );
  });

  it("names where a link goes in an inert preview, as a title, and shows its site as learners see it", () => {
    expect(
      render({
        rich: v2(p(named("the guide", "https://example.org/guide"), text(" or "), named("us", "mailto:team@example.org?subject=Hi"))),
        inertLinks: true,
      })
    ).toBe(
      wrap(
        `<p>${inertNamed("https://example.org/guide", "the guide", "example.org")} or ${inertNamed("team@example.org", "us", null)}</p>`
      )
    );
  });

  it("draws a refused link as its text, without a link", () => {
    expect(render({ rich: v2(p(text("Read "), named("the guide", "javascript:alert(1)"), text("."))) })).toBe(
      wrap("<p>Read the guide.</p>")
    );
  });

  it("draws version 2 from its doc, and an unknown version from its text", () => {
    expect(renderIn("en", { rich: v2(p(named("x", "https://example.org/"))), text: "Fallback" })).toBe(
      wrap(`<p>${namedTo("https://example.org/", "x", "example.org")}</p>`)
    );
    expect(render({ rich: { v: 3, doc: v2(p(text("x"))).doc }, text: "Fallback" })).toBe(plainWrap("<p>Fallback</p>"));
  });
});

describe("RichTextView shows the site each named link opens (the site label)", () => {
  const GUIDE = "https://example.org/guide";

  it("puts the site after the link's words, inside the link: heard as \"words, site\" before \"(opens in a new tab)\"", () => {
    const html = renderIn("en", { rich: v2(p(text("Read "), named("the guide", GUIDE), text(" today."))) });
    expect(html).toBe(wrap(`<p>Read ${namedTo(GUIDE, "the guide", "example.org")} today.</p>`));
    expect(linkNames(html)).toEqual(["the guide, example.org (opens in a new tab)"]);
    // Inline, so no browser puts a space before the comma.
    expect(html).not.toContain('<span class="sr-only">, </span>');
  });

  it("says it in the interface language around it", () => {
    const rich = v2(p(named("AMS-Seite", "https://www.ams.at/arbeitsuchende"), text(" und "), named("οδηγό του ΕΦΚΑ", "https://www.efka.gov.gr/el/odigos")));
    expect(linkNames(renderIn("de", { rich }))).toEqual([
      "AMS-Seite, ams.at (öffnet in einem neuen Tab)",
      "οδηγό του ΕΦΚΑ, efka.gov.gr (öffnet in einem neuen Tab)",
    ]);
    expect(linkNames(renderIn("el", { rich }))).toEqual([
      "AMS-Seite, ams.at (ανοίγει σε νέα καρτέλα)",
      "οδηγό του ΕΦΚΑ, efka.gov.gr (ανοίγει σε νέα καρτέλα)",
    ]);
  });

  it("shows the site for words that name no site, or another one the check doesn't read", () => {
    const rows: [string, string, string][] = [
      ["Click here to verify your account", "https://evil.example/verify", "evil.example"],
      ["PayPal login", "https://evil.example/login", "evil.example"],
      ["Ministry guidance", "https://www.minedu.gov.gr/guidance", "minedu.gov.gr"],
      ["Wikipedia", "https://en.wikipedia.org/wiki/Mercury_(planet)", "wikipedia.org"],
      ["the form", "https://docs.google.com/forms/d/e/x/viewform", "google.com"],
    ];
    for (const [words, href, site] of rows) {
      const html = renderIn("en", { rich: v2(p(named(words, href))) });
      expect(linkNames(html), words).toEqual([`${words}, ${site} (opens in a new tab)`]);
    }
  });

  it("is left out only when the whole of the words is the link's address", () => {
    const without = (words: string, href = GUIDE) => {
      const html = renderIn("en", { rich: v2(p(named(words, href))) });
      expect(html, words).not.toContain("seq-link-site");
      expect(linkNames(html), words).toEqual([`${words} (opens in a new tab)`]);
    };
    without("https://example.org/guide");
    without("example.org/guide");
    without("www.example.org/guide/");
    without("EXAMPLE.ORG/guide");
    without("gov.gr", "https://www.gov.gr/");
    const withSite = (words: string, href: string, site: string) => {
      const html = renderIn("en", { rich: v2(p(named(words, href))) });
      expect(linkNames(html), words).toEqual([`${words}, ${site} (opens in a new tab)`]);
    };
    // Words that begin with the site and go on, or only name it.
    withSite("evil.example Login", "https://evil.example/", "evil.example");
    withSite("evil.example/paypal.com", "https://evil.example/", "evil.example");
    withSite("evil.example/paypal.\u217Dom", "https://evil.example/", "evil.example");
    withSite("example.org", GUIDE, "example.org");
    withSite("example.org/guide and more", GUIDE, "example.org");
    withSite("bank.example", "https://login.bank.example/", "bank.example");
    // The address across bold and plain parts of one link is still its address.
    expect(renderIn("en", { rich: v2(p(named("example.org", GUIDE, "bold"), named("/guide", GUIDE))) })).not.toContain("seq-link-site");
  });

  it("shows an international site in punycode, also under words that spell it in Unicode", () => {
    const html = renderIn("en", {
      rich: v2(p(named("bücher.de", "https://xn--bcher-kva.de/"), text(" "), named("Bücher", "https://www.bücher.de/shop"))),
    });
    expect(linkNames(html)).toEqual([
      "bücher.de, xn--bcher-kva.de (opens in a new tab)",
      "Bücher, xn--bcher-kva.de (opens in a new tab)",
    ]);
  });

  it("keeps the site after right-to-left words, and the words before it", () => {
    const html = renderIn("en", {
      rich: v2(p(text("Read "), named("\u05D4\u05DE\u05D3\u05E8\u05D9\u05DA", "https://example.org/he"), text(" and "), named("\u0627\u0644\u062F\u0644\u064A\u0644 example", "https://example.org/ar"), text("."))),
    });
    expect(html).toContain(namedTo("https://example.org/he", "\u05D4\u05DE\u05D3\u05E8\u05D9\u05DA", "example.org"));
    expect(linkNames(html)).toEqual([
      "\u05D4\u05DE\u05D3\u05E8\u05D9\u05DA, example.org (opens in a new tab)",
      "\u0627\u0644\u062F\u0644\u064A\u0644 example, example.org (opens in a new tab)",
    ]);
  });

  it("shows the site after very long words, at their end", () => {
    const words = "A very long link text that goes on ".repeat(250).trim(); // 8,749 characters, within one text's limit
    const html = renderIn("en", { rich: v2(p(named(words, "https://evil.example/x"))) });
    expect(linkNames(html)).toEqual([`${words}, evil.example (opens in a new tab)`]);
    expect(html.indexOf("seq-link-site")).toBeGreaterThan(html.indexOf(words.slice(-20)));
  });

  it("shows no site for an email link: its words are heard with what it opens", () => {
    const html = renderIn("en", { rich: v2(p(named("our team", "mailto:help@example.org?subject=Course"))) });
    expect(html).not.toContain("seq-link-site");
    expect(linkNames(html)).toEqual(["our team (opens in a new tab)"]);
  });

  it("shows our own file store's site like any other link's", () => {
    const html = renderIn("en", { rich: v2(p(named("the handout", "https://abc123.public.blob.vercel-storage.com/handout.pdf"))) });
    expect(linkNames(html)).toEqual(["the handout, vercel-storage.com (opens in a new tab)"]);
  });

  it("never adds a site to a quick link: its words are the address", () => {
    const html = renderIn("en", { rich: doc(p(text("Read https://example.org/guide or www.bpb.de/x or help@example.org."))) });
    expect(html).not.toContain("seq-link-site");
    expect(html).not.toContain("seq-link-sep");
  });

  it("shows the site in the inert block preview as learners see it, with no link", () => {
    const html = render({ rich: v2(p(named("the guide", GUIDE), text(" or "), named("example.org/guide", GUIDE))), inertLinks: true });
    expect(html).toBe(
      wrap(`<p>${inertNamed(GUIDE, "the guide", "example.org")} or ${inertNamed(GUIDE, "example.org/guide", null)}</p>`)
    );
    expect(html).not.toMatch(/<a\b|href=/);
  });
});

describe("RichTextView keeps hostile links inert", () => {
  const ADDRESSES: unknown[] = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\u0000script:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///C:/x",
    "//evil.example",
    "/relative",
    "#x",
    "https:evil.example",
    "https://user:pw@evil.example",
    "https://bank.example@evil.example",
    "https://example.org/" + "a".repeat(3000),
    42,
    { href: "https://example.org" },
    ["https://example.org"],
    'https://example.org/"><script>alert(1)</script>',
    "https://example.org/' onmouseover='alert(1)",
  ];
  const hostile = v2(
    ...ADDRESSES.map((href, i) =>
      p(text(`Row ${i}: `), named("click", href, "bold"), {
        type: "text",
        text: " me",
        marks: [{ type: "link", attrs: { href: "https://example.org/ok", target: "_self", onclick: "alert(1)", style: "x" } }],
      })
    ),
    p(named("https://bank.", "https://evil.example/a"), named("example", "https://evil.example/b")),
    p({ type: "text", text: "two", marks: [{ type: "link", attrs: { href: "https://a.example/" } }, { type: "link", attrs: { href: "https://b.example/" } }] }),
    p({ type: "text", text: "deep", marks: [{ type: "link", attrs: { attrs: { href: "javascript:alert(1)" } } }] }),
    p({ type: "text", text: "anchor", marks: [{ type: "anchor", attrs: { href: "javascript:alert(1)" } }] }),
    ul(li(p(named("https://example.org", "https://example.org/"), text(" and https://example.org/typed"))))
  );
  const html = renderIn("en", { rich: hostile, text: "unused" });
  const plain = render({ rich: hostile, inertLinks: true });

  it("emits only whitelisted elements and attributes", () => {
    for (const out of [html, plain]) {
      const tags = out.match(/<[a-z][^>]*>/gi) ?? [];
      for (const tag of tags) {
        expect(tag).toMatch(/^<(?:div|p|ul|ol|li|br\/|strong|em|a|span)(?:\s|>|\/)/);
        for (const [, name] of tag.matchAll(/\s([a-z-]+)=/gi)) {
          expect(["href", "target", "rel", "class", "lang", "title", "start", "style"]).toContain(name);
        }
      }
      // style only as a paragraph's indent, start only on <ol>.
      expect(out).not.toMatch(/<(?!p\b)[a-z]+[^>]*\sstyle=/i);
    }
  });

  it("never puts a link inside a link", () => {
    expect(html).not.toMatch(/<a\b(?:(?!<\/a>)[\s\S])*<a\b/);
  });

  it("only ever draws https, http and mailto addresses", () => {
    const hrefs = [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^(?:https:\/\/|http:\/\/|mailto:)/);
    expect(html).not.toMatch(/javascript|vbscript|data:|file:|evil\.example/i);
    expect(html).not.toMatch(/onclick|onmouseover|_self/);
  });

  it("keeps the text of every refused link", () => {
    const accepted = ADDRESSES.indexOf('https://example.org/"><script>alert(1)</script>');
    for (let i = 0; i < ADDRESSES.length; i++) {
      if (i !== accepted) expect(html).toContain(`Row ${i}: <strong>click</strong>`);
    }
    // An address whose markup the URL parser percent-encodes is a link, inert.
    expect(html).toContain(
      `Row ${accepted}: <a href="https://example.org/%22%3E%3Cscript%3Ealert(1)%3C/script%3E" target="_blank"`
    );
    // Touching links that read as another address are text, and that text a quick link to where it says.
    expect(html).toContain(`<p>${linkTo("https://bank.example/", "https://bank.example")}</p>`);
    expect(html).toContain("<p>two</p>");
    expect(html).toContain("<p>deep</p>");
    expect(html).toContain("<p>anchor</p>");
  });

  it("draws no link at all in an inert preview", () => {
    expect(plain).not.toMatch(/<a\b|href=/);
  });
});
