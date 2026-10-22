import { describe, it, expect } from "vitest";
import {
  addressProblem,
  cleanInlineText,
  cleanPlainText,
  isEmptyDoc,
  linkProblemMessage,
  richTextProblem,
  sanitizeRichText,
} from "./sanitize";
import { docToPlainText } from "./to-plain";
import { RT_LIMITS } from "./types";
import { checkLinkHref } from "./link-url";
import { LINK_INPUTS } from "./link-fixtures";
import { ownFileHost } from "./own-file-host";
import { HOSTILE_ADDRESSES, HOSTILE_MARKS, RENDER_ONLY_MARKS } from "../../../e2e/fixtures/r4-hostile-links";

const USE_WEB_OR_EMAIL = "Use an address starting with https:// or http://, or an email address.";

// Builders for raw (unchecked) editor JSON.
const envelope = (...content: unknown[]) => ({
  v: 1,
  doc: { type: "doc", content },
});
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, ...marks: string[]) =>
  marks.length
    ? { type: "text", text, marks: marks.map((type) => ({ type })) }
    : { type: "text", text };
const br = { type: "hardBreak" };
const li = (...content: unknown[]) => ({ type: "listItem", content });
const ul = (...items: unknown[]) => ({ type: "bulletList", content: items });
const ol = (start: number | undefined, ...items: unknown[]) =>
  start === undefined
    ? { type: "orderedList", content: items }
    : { type: "orderedList", attrs: { start }, content: items };

const docOf = (input: unknown) => sanitizeRichText(input).value?.doc;

describe("sanitizeRichText", () => {
  it("keeps a well-formed doc exactly as it is", () => {
    const input = envelope(
      { type: "paragraph", attrs: { indent: 2 }, content: [t("Indented")] },
      p(t("Bold", "bold"), t(" and "), t("both", "bold", "italic"), br, t("next")),
      ul(li(p(t("Pause")), ul(li(p(t("Breathe"))))), li(p(t("Decide")))),
      ol(3, li(p(t("Third"))), li(p(t("Fourth"))))
    );
    const result = sanitizeRichText(input);
    expect(result.issues).toEqual([]);
    expect(result.value).toEqual(input);
    expect(result.linkProblems).toEqual([]);
  });

  it("takes the editor's own JSON, leaving out default attributes", () => {
    // What Tiptap's getJSON() gives: every attribute, defaults included.
    const input = envelope(
      { type: "paragraph", attrs: { indent: 0 }, content: [t("Hi")] },
      {
        type: "orderedList",
        attrs: { start: 1, type: null },
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", attrs: { indent: 0 }, content: [t("One")] },
            ],
          },
        ],
      }
    );
    expect(sanitizeRichText(input)).toEqual({
      value: envelope(p(t("Hi")), ol(undefined, li(p(t("One"))))),
      issues: [],
      linkProblems: [],
      hasLinks: false,
    });
  });

  it("drops nodes, marks and attributes outside the whitelist", () => {
    const input = envelope(
      { type: "heading", attrs: { level: 1 }, content: [t("Title")] },
      { type: "image", attrs: { src: "https://x.test/a.png" } },
      { type: "blockquote", content: [p(t("Quoted"))] },
      {
        type: "paragraph",
        attrs: { indent: 1, style: "color:red", onclick: "alert(1)", class: "x" },
        content: [
          {
            type: "text",
            text: "Click",
            onclick: "alert(1)",
            marks: [
              { type: "link", attrs: { href: "javascript:alert(1)" } },
              { type: "underline" },
              { type: "code" },
              { type: "textStyle", attrs: { color: "red" } },
              { type: "bold", attrs: { style: "x" } },
            ],
          },
          { type: "image", attrs: { src: "x", onerror: "alert(1)" } },
          { type: "mention", attrs: { id: "1" } },
        ],
      }
    );
    const result = sanitizeRichText(input);
    expect(result.value).toEqual(
      envelope({
        type: "paragraph",
        attrs: { indent: 1 },
        content: [t("Click", "bold")],
      })
    );
    // Release 4: a link mark is read, and this one's address refused
    // (dropped-link, named in linkProblems); the other marks are unknown.
    expect(result.issues).toEqual(["dropped-node", "dropped-mark", "dropped-link"]);
    expect(result.linkProblems).toEqual([{ text: "Click", reason: "refused", detail: USE_WEB_OR_EMAIL }]);
    const json = JSON.stringify(result.value);
    for (const word of ["heading", "image", "link", "href", "javascript", "style", "onclick", "class", "underline", "Title", "Quoted"]) {
      expect(json).not.toContain(word);
    }
  });

  it("keeps markup inside text as text, for the renderer to escape", () => {
    const text = '<script>alert(1)</script><img src=x onerror="alert(1)"> & **bold**';
    expect(docOf(envelope(p(t(text))))).toEqual({
      type: "doc",
      content: [p(t(text))],
    });
  });

  it("clamps indent to 0–4 whole steps", () => {
    const indented = (indent: unknown) =>
      docOf(envelope({ type: "paragraph", attrs: { indent }, content: [t("x")] }))
        ?.content[0];
    expect(indented(9)).toEqual({ type: "paragraph", attrs: { indent: 4 }, content: [t("x")] });
    expect(indented(2.7)).toEqual({ type: "paragraph", attrs: { indent: 2 }, content: [t("x")] });
    for (const none of [-3, 0, "2", null, NaN, Infinity, { n: 1 }]) {
      expect(indented(none)).toEqual(p(t("x")));
    }
  });

  it("clamps a numbered list's start to 0–999, dropping 1", () => {
    const startOf = (start: unknown) =>
      docOf(
        envelope({ type: "orderedList", attrs: { start }, content: [li(p(t("x")))] })
      )?.content[0];
    expect(startOf(5000)).toEqual(ol(999, li(p(t("x")))));
    expect(startOf(-4)).toEqual(ol(0, li(p(t("x")))));
    expect(startOf(0)).toEqual(ol(0, li(p(t("x")))));
    expect(startOf(7.9)).toEqual(ol(7, li(p(t("x")))));
    for (const one of [1, "7", null, undefined]) {
      expect(startOf(one)).toEqual(ol(undefined, li(p(t("x")))));
    }
  });

  it("orders marks bold then italic, once each, and merges text with the same marks", () => {
    const input = envelope(
      p(
        t("a", "italic", "bold", "italic"),
        t("b", "bold", "italic"),
        t("c"),
        t("d", "link"),
        t("e", "bold"),
        t("")
      )
    );
    expect(docOf(input)?.content).toEqual([
      p(t("ab", "bold", "italic"), t("cd"), t("e", "bold")),
    ]);
  });

  it("removes invisible and bidi-control characters; line breaks in text become spaces", () => {
    const messy =
      "A\u0000B\u0007C\u007F\u0085D\u202EE\u2066F\uFEFFG\tH\nI\r\nJ\u2028K";
    expect(docOf(envelope(p(t(messy))))?.content).toEqual([
      p(t("ABCDEFG H I  J K")),
    ]);
    expect(cleanInlineText("x\u000By\u000Cz")).toBe("x y z");
  });

  it("drops half an emoji but keeps whole ones", () => {
    const text = "ok 😊 \uD83D bad \uDE0A end";
    expect(docOf(envelope(p(t(text))))?.content).toEqual([
      p(t("ok 😊  bad  end")),
    ]);
  });

  it("drops blank paragraphs at the top level, keeping one in an empty doc", () => {
    expect(
      docOf(
        envelope(
          { type: "paragraph" },
          p(),
          p(t("   ")),
          p(t("\u00A0")),
          p(br, br),
          p(t("Text")),
          p(t("\u200B"))
        )
      )?.content
    ).toEqual([p(t("Text")), p(t("\u200B"))]);
    expect(docOf(envelope())).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(docOf(envelope(p(t(" "))))).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("trims line breaks at either end of a paragraph", () => {
    expect(docOf(envelope(p(br, t("a"), br, br, t("b"), br, br)))?.content).toEqual([
      p(t("a"), br, br, t("b")),
    ]);
  });

  it("drops empty list items and lists, and starts every item with a paragraph", () => {
    const input = envelope(
      ul(li(p()), li(p(t(" "))), li()),
      ol(2, li(p(t("Kept"))), li(p(br)), { type: "paragraph", content: [t("stray")] }),
      ul(li(ul(li(p(t("Nested"))))))
    );
    const result = sanitizeRichText(input);
    expect(result.value?.doc.content).toEqual([
      ol(2, li(p(t("Kept")))),
      ul(li({ type: "paragraph" }, ul(li(p(t("Nested")))))),
    ]);
    expect(result.issues).toEqual(["dropped-node"]);
  });

  it("keeps an item's later paragraphs, dropping blank ones and any indent", () => {
    const input = envelope(
      ul(
        li(
          { type: "paragraph", attrs: { indent: 3 }, content: [t("First")] },
          p(),
          { type: "paragraph", attrs: { indent: 2 }, content: [t("Second")] }
        )
      )
    );
    expect(docOf(input)?.content).toEqual([
      ul(li(p(t("First")), p(t("Second")))),
    ]);
  });

  it("keeps three levels of lists and flattens deeper ones into the third, text intact", () => {
    // Level n holds "Ln" and then level n + 1.
    const level = (n: number): unknown =>
      n > 5 ? null : li(p(t(`L${n}`)), ...(n < 5 ? [ul(level(n + 1))] : []));
    const input = envelope(ul(level(1), li(p(t("After")))));
    const result = sanitizeRichText(input);
    expect(result.issues).toEqual(["list-flattened"]);
    expect(result.value?.doc.content).toEqual([
      ul(
        li(p(t("L1")), ul(li(p(t("L2")), ul(li(p(t("L3"))), li(p(t("L4"))), li(p(t("L5"))))))),
        li(p(t("After")))
      ),
    ]);
  });

  it("keeps reading order when flattening several nested lists", () => {
    const deep = ul(
      li(
        p(t("L3")),
        ul(li(p(t("a")), ol(4, li(p(t("a1"))))), li(p(t("b")))),
        p(t("L3 more")),
        ol(undefined, li(p(t("c"))))
      )
    );
    const input = envelope(ul(li(p(t("L1")), ul(li(p(t("L2")), deep)))));
    // doc → level-1 list → its item → level-2 list → its item → level 3.
    const third = [0, 0, 1, 0, 1].reduce(
      (node: unknown, i) => (node as { content: unknown[] }).content[i],
      docOf(input)
    );
    expect(third).toEqual(
      ul(
        li(p(t("L3")), p(t("L3 more"))),
        li(p(t("a"))),
        li(p(t("a1"))),
        li(p(t("b"))),
        li(p(t("c")))
      )
    );
  });

  it("flattens hundreds of nesting levels without overflowing the stack", () => {
    let item: unknown = li(p(t("w300")));
    for (let n = 299; n >= 1; n--) item = li(p(t(`w${n}`)), ul(item));
    const result = sanitizeRichText(envelope(ul(item)));
    expect(result.value).not.toBeNull();
    const words = docToPlainText(result.value!.doc).match(/w\d+/g);
    expect(words).toEqual(Array.from({ length: 300 }, (_, i) => `w${i + 1}`));
  });

  it("refuses more text than RT_LIMITS allows", () => {
    const x = RT_LIMITS.maxTextChars;
    expect(sanitizeRichText(envelope(p(t("a".repeat(x))))).value).not.toBeNull();
    expect(sanitizeRichText(envelope(p(t("a".repeat(x - 1))), p(t("bb"))))).toEqual({
      value: null,
      issues: ["too-much-text"],
      linkProblems: [],
      hasLinks: false,
    });
    // Far too long is refused before it's even cleaned.
    expect(sanitizeRichText(envelope(p(t("a".repeat(1_000_000))))).issues).toEqual([
      "too-much-text",
    ]);
  });

  it("stops reading text once a doc's worth has been scanned, kept or not", () => {
    // One string that cleans to nothing, shared by every text node — a
    // server action's arguments can repeat a value by reference. Each node
    // is within the budget; together they are 1,490 times over it.
    const invisible = "\u0001".repeat(RT_LIMITS.maxJsonChars - 1);
    let reads = 0;
    const node = {
      type: "text",
      get text() {
        reads++;
        return invisible;
      },
    };
    const input = envelope(p(...Array.from({ length: 1_490 }, () => node)));
    expect(sanitizeRichText(input)).toEqual({
      value: null,
      issues: ["too-much-text"],
      linkProblems: [],
      hasLinks: false,
    });
    expect(reads).toBe(2);
    // Within the budget, text that cleans to nothing is simply left out.
    expect(docOf(envelope(p(t("\u0001".repeat(1_000)), t("kept"))))).toEqual({
      type: "doc",
      content: [p(t("kept"))],
    });
  });

  it("refuses more nodes than RT_LIMITS allows", () => {
    // A paragraph and its text are two nodes.
    const paragraphs = (n: number) =>
      Array.from({ length: n }, (_, i) => p(t(`p${i}`)));
    const half = RT_LIMITS.maxNodes / 2;
    expect(sanitizeRichText(envelope(...paragraphs(half))).value).not.toBeNull();
    expect(sanitizeRichText(envelope(...paragraphs(half + 1)))).toEqual({
      value: null,
      issues: ["too-many-nodes"],
      linkProblems: [],
      hasLinks: false,
    });
    // Marks count too, so a huge list of them can't be walked for free.
    const marks = Array.from({ length: 5000 }, () => ({ type: "bold" }));
    expect(
      sanitizeRichText(envelope(p({ type: "text", text: "x", marks }))).issues
    ).toEqual(["too-many-nodes"]);
    // …and so do dropped nodes.
    const junk = Array.from({ length: 5000 }, () => ({ type: "image" }));
    expect(sanitizeRichText(envelope(...junk)).issues).toContain("too-many-nodes");
  });

  it("refuses a value too large as JSON", () => {
    // 500 indented paragraphs of 20 quote marks: 10,000 characters and
    // 1,000 nodes — within limits — but each quote is escaped in JSON.
    const input = envelope(
      ...Array.from({ length: 500 }, () => ({
        type: "paragraph",
        attrs: { indent: 4 },
        content: [t('"'.repeat(20))],
      }))
    );
    expect(sanitizeRichText(input)).toEqual({
      value: null,
      issues: ["too-large"],
      linkProblems: [],
      hasLinks: false,
    });
  });

  it("refuses anything but a version-1 or version-2 envelope", () => {
    const bad = [
      null,
      undefined,
      "text",
      42,
      [],
      { v: 3, doc: { type: "doc", content: [] } },
      { v: 0, doc: { type: "doc", content: [] } },
      { v: "2", doc: { type: "doc", content: [] } },
      { v: "1", doc: { type: "doc", content: [] } },
      { v: 1 },
      { v: 1, doc: [] },
      { v: 1, doc: { type: "paragraph", content: [] } },
      { v: 1, doc: { type: "doc" } },
      { v: 1, doc: { type: "doc", content: "text" } },
    ];
    for (const input of bad) {
      expect(sanitizeRichText(input)).toEqual({
        value: null,
        issues: ["bad-envelope"],
        linkProblems: [],
        hasLinks: false,
      });
    }
  });

  it("never throws: cyclic input and throwing getters end in a result", () => {
    const item: { type: string; content: unknown[] } = { type: "listItem", content: [] };
    const list = { type: "bulletList", content: [item] };
    item.content.push(p(t("loop")), list);
    expect(sanitizeRichText(envelope(list))).toEqual({
      value: null,
      issues: ["list-flattened", "too-many-nodes"],
      linkProblems: [],
      hasLinks: false,
    });

    const doc: { type: string; content: unknown[] } = { type: "doc", content: [] };
    doc.content.push(doc, p(t("x")));
    expect(docOf({ v: 1, doc })?.content).toEqual([p(t("x"))]);

    const text = { type: "text", text: "x", marks: [] as unknown[] };
    text.marks.push(text);
    expect(sanitizeRichText(envelope(p(text))).issues).toEqual(["dropped-mark"]);

    const hostile = envelope(p(t("x")));
    Object.defineProperty(hostile.doc, "content", {
      get() {
        throw new Error("no");
      },
    });
    expect(sanitizeRichText(hostile)).toEqual({
      value: null,
      issues: ["bad-envelope"],
      linkProblems: [],
      hasLinks: false,
    });
  });

  it("builds a fresh value that shares nothing with the input", () => {
    const text = t("Hi", "bold");
    const input = envelope(p(text));
    const { value } = sanitizeRichText(input);
    text.text = "changed";
    (text.marks as { type: string }[])[0].type = "link";
    expect(value).toEqual(envelope(p(t("Hi", "bold"))));
  });

  it("is idempotent", () => {
    const messy = [
      envelope(
        { type: "heading", content: [t("H")] },
        p(t("a", "italic", "bold"), t("b", "bold", "italic"), br),
        ul(li(ol(0, li(p(t("x")))), p()), li(p(t("\u202Ey\u0000")))),
        { type: "paragraph", attrs: { indent: 12 }, content: [t("i")] }
      ),
      envelope(p(), p(t("  "))),
    ];
    for (const input of messy) {
      const once = sanitizeRichText(input).value;
      expect(sanitizeRichText(once)).toEqual({
        value: once,
        issues: [],
        linkProblems: [],
        hasLinks: false,
      });
    }
  });
});

describe("cleanPlainText", () => {
  it("keeps tabs and line breaks, which carry a plain text's structure", () => {
    expect(cleanPlainText("·\tone\r\n•\u00A0two\nthree")).toBe(
      "·\tone\r\n•\u00A0two\nthree"
    );
  });

  it("turns Word's manual line and page breaks into line breaks", () => {
    expect(cleanPlainText("a\u000Bb\u000Cc")).toBe("a\nb\nc");
  });

  it("removes invisible characters and half emoji", () => {
    expect(cleanPlainText("a\u0000\u202Eb\uFEFF\uD83D c 😊")).toBe(
      "ab c 😊"
    );
  });
});

describe("isEmptyDoc", () => {
  it("is true only when the doc holds no text", () => {
    expect(isEmptyDoc({ content: [{ type: "paragraph" }] })).toBe(true);
    expect(isEmptyDoc({ content: [] })).toBe(true);
    expect(
      isEmptyDoc({ content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] })
    ).toBe(false);
    expect(
      isEmptyDoc({
        content: [
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] },
            ],
          },
        ],
      })
    ).toBe(false);
  });
});

describe("richTextProblem", () => {
  it("explains the first fatal issue to authors", () => {
    expect(richTextProblem(["dropped-mark", "too-much-text"])).toBe(
      "This text is too long — at most 10,000 characters. Split it into two blocks."
    );
    expect(richTextProblem(["too-many-nodes"], "Block 2 (Key message)")).toBe(
      "Block 2 (Key message) has too much formatting or too many list points to save. Split it into two blocks."
    );
    expect(richTextProblem(["too-large"])).toMatch(/too much formatting/);
    expect(richTextProblem(["bad-envelope"])).toMatch(/couldn't be read/);
  });

  it("advises by what the text is: a block is split or copied, an introduction or the references list is shortened", () => {
    expect(richTextProblem(["too-much-text"], "The references list", false, "list")).toBe(
      "The references list is too long — at most 10,000 characters. Shorten the list."
    );
    expect(richTextProblem(["too-many-nodes"], "The references list", false, "list")).toBe(
      "The references list has too much formatting or too many list points to save. Shorten the list."
    );
    expect(richTextProblem(["too-large"], "The references list", true, "list")).toBe(
      "The references list has too many links or too much formatting to save. Shorten the list."
    );
    expect(richTextProblem(["bad-envelope"], "The references list", false, "list")).toBe(
      "The references list couldn't be read. Reload the page, then make your change again."
    );
    expect(richTextProblem(["too-much-text"], "This introduction", false, "text")).toBe(
      "This introduction is too long — at most 10,000 characters. Shorten it."
    );
    expect(richTextProblem(["too-large"], "This introduction", true, "text")).toBe(
      "This introduction has too many links or too much formatting to save. Shorten it."
    );
    // A block among a lesson's blocks keeps a block's advice.
    expect(richTextProblem(["too-much-text"], "This paragraph", false, "block")).toBe(
      "This paragraph is too long — at most 10,000 characters. Split it into two blocks."
    );
    // No advice speaks of blocks to a text that has none.
    for (const advice of ["text", "list"] as const) {
      for (const issue of ["bad-envelope", "too-much-text", "too-many-nodes", "too-large"] as const) {
        for (const hasLinks of [false, true]) {
          expect(richTextProblem([issue], "The text", hasLinks, advice), `${advice}, ${issue}`).not.toMatch(/block/i);
        }
      }
    }
  });

  it("is null when everything could be repaired", () => {
    expect(richTextProblem([])).toBeNull();
    expect(richTextProblem(["dropped-node", "dropped-mark", "list-flattened"])).toBeNull();
  });
});

/* ------------------------------------------------- Links (Release 4, U3) */

// A text node with a link mark, as a request or a database row may carry it.
const link = (text: string, href: unknown, ...marks: string[]) => ({
  type: "text",
  text,
  marks: [...marks.map((type) => ({ type })), { type: "link", attrs: { href } }],
});
const linkTo = (href: string, ...marks: string[]) => [
  ...marks.map((type) => ({ type })),
  { type: "link", attrs: { href } },
];
const v2 = (...content: unknown[]) => ({ v: 2, doc: { type: "doc", content } });

describe("sanitizeRichText: links (D104)", () => {
  it("keeps a link exactly when the address check accepts its address, normalised", () => {
    const own = { ownFileHost: ownFileHost() };
    for (const href of LINK_INPUTS) {
      const result = sanitizeRichText(envelope(p(t("Read "), link("the guide", href), t(" today."))));
      const check = checkLinkHref(href, own);
      const label = typeof href === "string" ? JSON.stringify(href.slice(0, 80)) : String(href);
      expect(result.value, label).not.toBeNull();
      if (check.ok) {
        expect(result.value, label).toEqual(
          v2(p(t("Read "), { type: "text", text: "the guide", marks: linkTo(check.href) }, t(" today.")))
        );
        expect(result.issues, label).toEqual(check.ownFile ? ["own-file-link"] : []);
      } else {
        expect(result.value, label).toEqual(envelope(p(t("Read the guide today."))));
        expect(result.issues, label).toEqual(["dropped-link"]);
        expect(result.linkProblems, label).toEqual([
          check.reason === "redirect"
            ? { text: "the guide", reason: "redirect" }
            : { text: "the guide", reason: "refused", detail: addressProblem(check.reason, href) },
        ]);
      }
    }
  });

  it("drops every attribute of a link mark but its address", () => {
    const input = envelope(
      p({
        type: "text",
        text: "the guide",
        onclick: "alert(1)",
        marks: [
          {
            type: "link",
            attrs: {
              href: "https://example.org/guide",
              target: "_self",
              rel: "opener",
              class: "evil",
              onclick: "alert(1)",
              style: "position:fixed",
              title: "Your bank",
            },
            onclick: "alert(1)",
          },
        ],
      })
    );
    const result = sanitizeRichText(input);
    expect(result).toEqual({
      value: v2(p({ type: "text", text: "the guide", marks: linkTo("https://example.org/guide") })),
      issues: [],
      linkProblems: [],
      hasLinks: true,
    });
    expect(JSON.stringify(result.value)).not.toMatch(/target|rel|class|onclick|style|title/);
  });

  it("keeps no link on a text that holds two link marks", () => {
    const result = sanitizeRichText(
      envelope(
        p({
          type: "text",
          text: "the guide",
          marks: [
            { type: "link", attrs: { href: "https://example.org/a" } },
            { type: "link", attrs: { href: "https://example.org/a" } },
          ],
        })
      )
    );
    expect(result.value).toEqual(envelope(p(t("the guide"))));
    expect(result.issues).toEqual(["dropped-link"]);
    expect(result.linkProblems).toEqual([{ text: "the guide", reason: "refused", detail: "Its words hold two links. Keep one." }]);
  });

  it("orders marks bold, italic, link, and merges text with the same address", () => {
    const input = envelope(
      p(
        { type: "text", text: "a", marks: [{ type: "link", attrs: { href: "https://example.org/x" } }, { type: "italic" }, { type: "bold" }] },
        link("b", "https://example.org/x", "bold", "italic"),
        link("c", "https://example.org/x"),
        link("d", "HTTPS://EXAMPLE.ORG/x")
      )
    );
    expect(docOf(input)?.content).toEqual([
      p(
        { type: "text", text: "ab", marks: linkTo("https://example.org/x", "bold", "italic") },
        { type: "text", text: "cd", marks: linkTo("https://example.org/x") }
      ),
    ]);
  });

  it("never merges neighbouring links to different addresses", () => {
    const input = envelope(p(link("one", "https://example.org/a"), link(" two", "https://example.org/b")));
    expect(docOf(input)?.content).toEqual([
      p(
        { type: "text", text: "one", marks: linkTo("https://example.org/a") },
        { type: "text", text: " two", marks: linkTo("https://example.org/b") }
      ),
    ]);
  });

  it("drops a link on spaces only, silently", () => {
    const result = sanitizeRichText(envelope(p(t("Read"), link("  ", "https://example.org/"), t("on"))));
    expect(result.value).toEqual(envelope(p(t("Read  on"))));
    expect(result.issues).toEqual([]);
    expect(result.linkProblems).toEqual([]);
  });

  it("drops a link whose text shows another address than it opens (dropped-link)", () => {
    const result = sanitizeRichText(
      envelope(p(t("Log in at "), link("https://bank.example/login", "https://evil.example/login")))
    );
    expect(result.value).toEqual(envelope(p(t("Log in at https://bank.example/login"))));
    expect(result.issues).toEqual(["dropped-link"]);
    expect(result.linkProblems).toEqual([{ text: "https://bank.example/login", reason: "misleading" }]);
    // Showing its own address (www. aside) is fine; so is an email address of the site.
    for (const [text, href] of [
      ["https://www.example.org", "https://example.org/x"],
      ["Kontakt: info@verein.de", "https://verein.de/kontakt"],
      ["help@example.org", "mailto:help@example.org?subject=Hi"],
    ]) {
      expect(sanitizeRichText(envelope(p(link(text, href)))).issues, text).toEqual([]);
    }
  });

  it("says a misleading link's text shows a different address; a file's name shows none (D104, as narrowed on 22 October 2026)", () => {
    for (const text of ["paypal.com", "paypal.соm", "_paypal.com_", "https://bank.example", "www.bank.example", "bank.example/login", "help@bank.example"]) {
      const result = sanitizeRichText(envelope(p(link(text, "https://example.org/files/x"))));
      expect(result.issues, text).toEqual(["dropped-link"]);
      expect(result.linkProblems, text).toEqual([{ text, reason: "misleading" }]);
    }
    // A file's name, ending in a top-level domain or not, is kept: the site box shows where it goes.
    for (const name of ["course-materials.zip", "intro.mov", "README.md", "report.pdf"]) {
      const result = sanitizeRichText(envelope(p(link(name, "https://example.org/files/x"))));
      expect(result.issues, name).toEqual([]);
      expect(result.value?.v, name).toBe(2);
    }
    expect(linkProblemMessage({ text: "paypal.com", reason: "misleading" }, "Block 2 (Paragraph)")).toBe(
      "Block 2 (Paragraph): the link text “paypal.com” shows a different address than the link opens. Show the real address, or use a few words."
    );
  });

  it("checks touching links as one: together they may show another address", () => {
    // Learners would read "https://bank.example", in two links to evil.example.
    const touching = sanitizeRichText(
      envelope(
        p(t("Log in at "), link("https://bank.", "https://evil.example/a"), link("example", "https://evil.example/b"), t(" today."))
      )
    );
    expect(touching.value).toEqual(envelope(p(t("Log in at https://bank.example today."))));
    expect(touching.issues).toEqual(["dropped-link"]);
    expect(touching.linkProblems).toEqual([{ text: "https://bank.example", reason: "misleading" }]);

    // Touching links whose joined text shows no address keep their links.
    const fine = envelope(p(link("one", "https://example.org/a"), link("two", "https://example.org/b")));
    expect(sanitizeRichText(fine).issues).toEqual([]);
    expect(docOf(fine)?.content).toEqual([
      p(
        { type: "text", text: "one", marks: linkTo("https://example.org/a") },
        { type: "text", text: "two", marks: linkTo("https://example.org/b") }
      ),
    ]);

    // A space or a line break between them: two links, each read on its own.
    for (const between of [t(" "), br]) {
      const apart = envelope(p(link("https://bank.", "https://evil.example/a"), between, link("example", "https://evil.example/b")));
      expect(sanitizeRichText(apart).issues).toEqual([]);
    }
  });

  it("reads a link's text as learners see it: characters that show nothing don't hide an address", () => {
    for (const mark of ["\u200B", "\u200C", "\u200E", "\u180E", "\u2062", "\u3164"]) {
      const label = `https://bank${mark}.example/login`;
      const result = sanitizeRichText(envelope(p(t("Log in at "), link(label, "https://evil.example/login"))));
      expect(result.value, JSON.stringify(mark)).toEqual(envelope(p(t(`Log in at ${label}`))));
      expect(result.issues, JSON.stringify(mark)).toEqual(["dropped-link"]);
      expect(result.linkProblems[0]?.reason, JSON.stringify(mark)).toBe("misleading");
    }
    for (const label of ["https://bank.example\u2024login", "https://login@bank.example/"]) {
      expect(sanitizeRichText(envelope(p(link(label, "https://evil.example/login")))).issues, label).toEqual(["dropped-link"]);
    }
    // A link on characters that show nothing is dropped as one on spaces is: silently.
    const invisible = sanitizeRichText(envelope(p(t("Read"), link("\u200B\u2060", "https://example.org/"), t(" on"))));
    expect(invisible.value).toEqual(envelope(p(t("Read\u200B\u2060 on"))));
    expect(invisible.issues).toEqual([]);
  });

  it("reads a link together with the text touching it, as learners read the word it is in", () => {
    const EVIL = "https://evil.example/login";
    const cases: [string, unknown[], string][] = [
      // Two touching links with a character between them that shows nothing.
      ["a zero-width space between two links", [link("https://bank.", "https://evil.example/a"), t("\u200B"), link("example/login", EVIL)], "https://bank.\u200Bexample/login"],
      // An address typed before a named link, and one a named link starts.
      ["an address typed right before a named link", [t("Log in at https://bank.example"), link("/login", EVIL)], "https://bank.example/login"],
      ["a named link that typed text continues", [link("https://bank", EVIL), t(".example/login today")], "https://bank.example/login"],
    ];
    for (const [name, content, word] of cases) {
      const result = sanitizeRichText(envelope(p(...content)));
      expect(result.issues, name).toEqual(["dropped-link"]);
      expect(result.linkProblems, name).toEqual([{ text: word, reason: "misleading" }]);
      expect(result.value?.v, name).toBe(1);
    }
    // Text touching a link that shows the link's own site, or no address, keeps it.
    for (const content of [
      [t("See "), link("https://example.org/guide", "https://example.org/guide"), t(", the guide.")],
      [t("("), link("https://example.org", "https://example.org/"), t(")")],
      [link("the guide", "https://example.org/guide"), t("’s second part")],
      [t("https://example.org"), link("/guide", "https://example.org/guide")],
      [link("https://web.archive.org/web/2020/https://example.org/", "https://web.archive.org/web/2020/https://example.org/")],
    ]) {
      expect(sanitizeRichText(envelope(p(...content))).issues, JSON.stringify(content).slice(0, 120)).toEqual([]);
    }
  });

  it("reads the word a link is in past a raised character after a host", () => {
    const EVIL = "https://evil.example/login";
    const cases: [string, unknown[], string][] = [
      ["a raised character after the text touching a link", [t("Log in at "), link("PayPal", EVIL), t(".com™ today")], "PayPal.com™"],
      ["a host the text touching a link ends", [t("Log in at "), link("PayPal", EVIL), t(".com today")], "PayPal.com"],
    ];
    for (const [name, content, word] of cases) {
      const result = sanitizeRichText(envelope(p(...content)));
      expect(result.issues, name).toEqual(["dropped-link"]);
      expect(result.linkProblems.map((problem) => problem.text), name).toEqual([word]);
      expect(result.value?.v, name).toBe(1);
    }
    // A narrow space shows: "z. B." stays two words, and a link on one keeps its link.
    expect(sanitizeRichText(envelope(p(link("z.", "https://example.org/zb"), t(" B. the guide")))).issues).toEqual([]);
  });

  it("reads a host as it shows: a combining mark left over is nothing, a Roman numeral or a raised letter is the letter", () => {
    const EVIL = "https://evil.example/login";
    const cases: [string, unknown[], string][] = [
      ["a mark at a label's start", [link("www.paypal.̲com/login", EVIL)], "www.paypal.̲com/login"],
      ["a mark at a name's start", [t("Log in at "), link("̲paypal.com", EVIL)], "̲paypal.com"],
      ["a mark starting the text touching a link", [link("paypal.", "https://evil.example/a"), link("̲com", "https://evil.example/b")], "paypal.̲com"],
      ["a Roman numeral letter", [link("paypal.ⅽom", EVIL)], "paypal.ⅽom"],
      ["a raised letter inside a name", [link("paypal.cᵒm", EVIL)], "paypal.cᵒm"],
      ["a Roman numeral letter that ends a name", [t("Log in at "), link("example.n\u217C", EVIL)], "example.n\u217C"],
      ["a top-level domain and a hyphen", [link("paypal.com-login", EVIL)], "paypal.com-login"],
      ["a punycode label Node's URL parser refuses", [link("xn--a.paypal.com", EVIL)], "xn--a.paypal.com"],
    ];
    for (const [name, content, shown] of cases) {
      const result = sanitizeRichText(envelope(p(...content)));
      expect(result.issues, name).toEqual(["dropped-link"]);
      expect(result.linkProblems.map((problem) => problem.text), name).toEqual([shown]);
    }
    // An abbreviation, a title and its feminine ending, a public suffix named by itself over a site
    // under it, and a host with a word after a hyphen over its own site keep their links.
    for (const [text, href] of [
      ["Dr.in Maria Huber", "https://www.univie.ac.at/personen/huber"],
      ["Dir.\u2071\u207F Mag.\u00AA Huber", "https://www.schule.example.at/team"],
      ["Gov.gr Wallet", "https://wallet.gov.gr/"],
      ["Booking.com-Konto", "https://www.booking.com/"],
    ]) {
      const result = sanitizeRichText(envelope(p(link(text, href))));
      expect(result.issues, text).toEqual([]);
      expect(result.value?.v, text).toBe(2);
    }
  });

  it("keeps a link to our own file store, reporting own-file-link", () => {
    const file = "https://e2e-store.public.blob.vercel-storage.com/handout.pdf";
    const result = sanitizeRichText(envelope(p(link("handout", file))));
    expect(result.value).toEqual(v2(p({ type: "text", text: "handout", marks: linkTo(file) })));
    expect(result.issues).toEqual(["own-file-link"]);
    expect(result.linkProblems).toEqual([{ text: "handout", reason: "own-file" }]);
  });

  it("names each refused link once, in order: at most 5, cut to 60 characters", () => {
    const long = "w".repeat(80);
    const result = sanitizeRichText(
      envelope(
        p(link("the ", "javascript:alert(1)"), link("guide", "javascript:alert(1)", "bold")),
        p(link("safe", "https://eur01.safelinks.protection.outlook.com/?url=x")),
        ul(li(p(link(long, "file:///C:/x")))),
        p(link("a", "#1"), t(" "), link("b", "#2"), t(" "), link("c", "#3"))
      )
    );
    expect(result.linkProblems).toEqual([
      { text: "the guide", reason: "refused", detail: USE_WEB_OR_EMAIL },
      { text: "safe", reason: "redirect" },
      { text: `${"w".repeat(59)}…`, reason: "refused", detail: USE_WEB_OR_EMAIL },
      { text: "a", reason: "refused", detail: USE_WEB_OR_EMAIL },
      { text: "b", reason: "refused", detail: USE_WEB_OR_EMAIL },
    ]);
    expect(result.value?.v).toBe(1);
  });

  it("counts an address into the text budget before reading it: 1 MB ends as too-much-text", () => {
    const huge = "https://example.org/" + "a".repeat(1_000_000);
    const started = performance.now();
    const result = sanitizeRichText(envelope(p(link("the guide", huge))));
    expect(performance.now() - started).toBeLessThan(200);
    expect(result.value).toBeNull();
    expect(result.issues).toEqual(["too-much-text"]);
    expect(result.hasLinks).toBe(true);
  });

  it("writes version 2 exactly when a link remains, whatever the input claimed", () => {
    expect(sanitizeRichText(v2(p(t("No link")))).value).toEqual(envelope(p(t("No link"))));
    expect(sanitizeRichText(envelope(p(link("x", "https://example.org/")))).value?.v).toBe(2);
    expect(sanitizeRichText(v2(p(link("x", "javascript:x")))).value?.v).toBe(1);
    expect(sanitizeRichText(v2(ul(li(p(link("deep", "mailto:help@example.org")))))).value?.v).toBe(2);
  });

  it("refuses version 3 as an envelope it can't read", () => {
    expect(sanitizeRichText({ v: 3, doc: { type: "doc", content: [p(t("x"))] } }).issues).toEqual(["bad-envelope"]);
  });

  it("keeps the text of every hostile link, and no link that the check refuses", () => {
    const own = { ownFileHost: ownFileHost() };
    for (const row of HOSTILE_ADDRESSES) {
      const result = sanitizeRichText(envelope(p(t("Read "), link("the guide", row.href), t(" today."))));
      if (row.name === "1,000,000 characters") {
        expect(result.issues, row.name).toEqual(["too-much-text"]);
        continue;
      }
      const check = checkLinkHref(row.href, own);
      expect(check.ok && !check.ownFile, row.name).toBe(false);
      expect(docToPlainText(result.value!.doc), row.name).toBe(
        check.ok ? "Read the guide (" + check.href + ") today." : "Read the guide today."
      );
      expect(result.issues, row.name).toEqual([check.ok ? "own-file-link" : "dropped-link"]);
    }
    for (const row of [...HOSTILE_MARKS, ...RENDER_ONLY_MARKS]) {
      const { value } = sanitizeRichText(row.rich);
      for (const node of value!.doc.content.flatMap((b) => (b.type === "paragraph" ? (b.content ?? []) : []))) {
        for (const mark of node.type === "text" ? (node.marks ?? []) : []) {
          if (mark.type === "link") {
            expect(Object.keys(mark.attrs), row.name).toEqual(["href"]);
            expect(checkLinkHref(mark.attrs.href), row.name).toMatchObject({ ok: true, href: mark.attrs.href });
          }
        }
      }
    }
  });

  it("is idempotent with links", () => {
    const inputs = [
      envelope(
        p(link("a", "HTTPS://Example.org/x", "italic"), link("b", "https://example.org/x"), t(" "), link(" ", "https://e.example/")),
        p(link("https://bank.", "https://evil.example/a"), link("example", "https://evil.example/b")),
        ul(li(p(link("one", "mailto:HELP@example.org?subject=Hi"), link("two", "javascript:x"))))
      ),
      ...HOSTILE_MARKS.map((row) => row.rich),
      ...RENDER_ONLY_MARKS.map((row) => row.rich),
      ...LINK_INPUTS.map((href) => envelope(p(link("x", href)))),
    ];
    for (const input of inputs) {
      const once = sanitizeRichText(input).value;
      const twice = sanitizeRichText(once);
      expect(twice.value).toEqual(once);
      expect(twice.issues.filter((i) => i !== "own-file-link")).toEqual([]);
    }
  });
});

describe("linkProblemMessage", () => {
  it("names the link in a save's words, or the editor's", () => {
    expect(linkProblemMessage({ text: "the guide", reason: "refused" }, "Block 2 (Paragraph)")).toBe(
      "Block 2 (Paragraph): the link “the guide” can't be used. Use an address starting with https:// or http://, or an email address."
    );
    expect(linkProblemMessage({ text: "the guide", reason: "redirect" }, "Block 2 (Paragraph)")).toBe(
      "Block 2 (Paragraph): the link “the guide” is an Outlook safe link, which carries the address of the mailbox it was sent to. Use the original address instead."
    );
    expect(linkProblemMessage({ text: "https://bank.example", reason: "misleading" }, "Block 2 (Paragraph)")).toBe(
      "Block 2 (Paragraph): the link text “https://bank.example” shows a different address than the link opens. Show the real address, or use a few words."
    );
    expect(linkProblemMessage({ text: "handout", reason: "own-file" }, "Block 2 (Paragraph)")).toBe(
      "Block 2 (Paragraph): the link “handout” points to a file uploaded to the platform. Add the file to the lesson as a document instead."
    );
    expect(linkProblemMessage({ text: "https://bank.example", reason: "misleading" })).toBe(
      "The link text “https://bank.example” shows a different address than the link opens. Show the real address, or use a few words."
    );
  });
});

describe("richTextProblem with links", () => {
  it("says a doc with links has too many links or too much formatting", () => {
    expect(richTextProblem(["too-many-nodes"], "Block 2 (Paragraph)", true)).toBe(
      "Block 2 (Paragraph) has too many links or too much formatting to save. Split it into two blocks."
    );
    expect(richTextProblem(["too-large"], "This text", true)).toBe(
      "This text has too many links or too much formatting to save. Split it into two blocks."
    );
    // Too much text is too much text.
    expect(richTextProblem(["too-much-text"], "This text", true)).toMatch(/is too long/);
  });
});
