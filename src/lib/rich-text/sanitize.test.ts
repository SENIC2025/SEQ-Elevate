import { describe, it, expect } from "vitest";
import {
  cleanInlineText,
  cleanPlainText,
  isEmptyDoc,
  richTextProblem,
  sanitizeRichText,
} from "./sanitize";
import { docToPlainText } from "./to-plain";
import { RT_LIMITS } from "./types";

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
    expect(result.issues).toEqual(["dropped-node", "dropped-mark"]);
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
    });
    // Far too long is refused before it's even cleaned.
    expect(sanitizeRichText(envelope(p(t("a".repeat(1_000_000))))).issues).toEqual([
      "too-much-text",
    ]);
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
    expect(sanitizeRichText(input)).toEqual({ value: null, issues: ["too-large"] });
  });

  it("refuses anything but a version-1 envelope", () => {
    const bad = [
      null,
      undefined,
      "text",
      42,
      [],
      { v: 2, doc: { type: "doc", content: [] } },
      { v: "1", doc: { type: "doc", content: [] } },
      { v: 1 },
      { v: 1, doc: [] },
      { v: 1, doc: { type: "paragraph", content: [] } },
      { v: 1, doc: { type: "doc" } },
      { v: 1, doc: { type: "doc", content: "text" } },
    ];
    for (const input of bad) {
      expect(sanitizeRichText(input)).toEqual({ value: null, issues: ["bad-envelope"] });
    }
  });

  it("never throws: cyclic input and throwing getters end in a result", () => {
    const item: { type: string; content: unknown[] } = { type: "listItem", content: [] };
    const list = { type: "bulletList", content: [item] };
    item.content.push(p(t("loop")), list);
    expect(sanitizeRichText(envelope(list))).toEqual({
      value: null,
      issues: ["list-flattened", "too-many-nodes"],
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
    expect(sanitizeRichText(hostile)).toEqual({ value: null, issues: ["bad-envelope"] });
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
      expect(sanitizeRichText(once)).toEqual({ value: once, issues: [] });
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

  it("is null when everything could be repaired", () => {
    expect(richTextProblem([])).toBeNull();
    expect(richTextProblem(["dropped-node", "dropped-mark", "list-flattened"])).toBeNull();
  });
});
