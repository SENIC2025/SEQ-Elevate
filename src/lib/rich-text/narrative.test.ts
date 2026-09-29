import { describe, it, expect } from "vitest";
import {
  NARRATIVE_LIMITS,
  blockPlainText,
  cleanNarrativeLine,
  sanitizeNarrativeBlocks,
} from "./narrative";

const rich = (...content: unknown[]) => ({
  v: 1,
  doc: { type: "doc", content },
});
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, ...marks: unknown[]) =>
  marks.length ? { type: "text", text, marks } : { type: "text", text };

/** The blocks of an accepted save (fails the test on refusal). */
function saved(input: unknown) {
  const result = sanitizeNarrativeBlocks(input);
  if (!result.ok) throw new Error(`refused: ${result.issues.join(" | ")}`);
  return result.blocks;
}

function refused(input: unknown) {
  const result = sanitizeNarrativeBlocks(input);
  if (result.ok) throw new Error("accepted");
  return result.issues;
}

describe("sanitizeNarrativeBlocks", () => {
  it("keeps a plain paragraph or key message plain — it isn't converted", () => {
    expect(
      saved([
        { kind: "paragraph", text: "Intro:\n• Pause\n·\tDecide" },
        { kind: "callout", text: "" },
        { kind: "paragraph" },
      ])
    ).toEqual([
      { kind: "paragraph", text: "Intro:\n• Pause\n·\tDecide" },
      { kind: "callout", text: "" },
      { kind: "paragraph", text: "" },
    ]);
  });

  it("removes invisible characters from plain text, keeping tabs, line breaks and no-break spaces", () => {
    expect(
      saved([{ kind: "paragraph", text: "a\u0000b\u202Ec\r\nd\te\u00A0f" }])
    ).toEqual([{ kind: "paragraph", text: "abc\r\nd\te\u00A0f" }]);
  });

  it("stores rich text sanitized, with the plain text derived on the server", () => {
    const blocks = saved([
      {
        kind: "paragraph",
        text: "whatever the browser says",
        rich: rich(
          p(t("Stay "), t("calm", { type: "bold" }), t(" here", { type: "link", attrs: { href: "javascript:alert(1)" } })),
          { type: "bulletList", content: [{ type: "listItem", content: [p(t("Pause"))] }] },
          { type: "image", attrs: { src: "x" } }
        ),
      },
    ]);
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        rich: rich(
          p(t("Stay "), t("calm", { type: "bold" }), t(" here")),
          { type: "bulletList", content: [{ type: "listItem", content: [p(t("Pause"))] }] }
        ),
        text: "Stay calm here\n\n• Pause",
      },
    ]);
    expect(JSON.stringify(blocks)).not.toMatch(/javascript|image|href/);
  });

  it("gives a key message rich text too", () => {
    expect(saved([{ kind: "callout", rich: rich(p(t("Remember", { type: "italic" }))) }])).toEqual([
      {
        kind: "callout",
        rich: rich(p(t("Remember", { type: "italic" }))),
        text: "Remember",
      },
    ]);
  });

  it("keeps a block of a format version it doesn't know as its plain text", () => {
    expect(
      saved([
        { kind: "callout", rich: { v: 2, doc: { type: "fancy" } }, text: "Hello" },
        { kind: "paragraph", rich: null, text: "Plain" },
        { kind: "paragraph", rich: "junk", text: "Also plain" },
      ])
    ).toEqual([
      { kind: "callout", text: "Hello" },
      { kind: "paragraph", text: "Plain" },
      { kind: "paragraph", text: "Also plain" },
    ]);
  });

  it("refuses rich text over a limit, naming the block", () => {
    expect(
      refused([
        { kind: "paragraph", text: "fine" },
        { kind: "callout", rich: rich(p(t("x".repeat(10_001)))) },
      ])
    ).toEqual([
      "Block 2 (Key message) is too long — at most 10,000 characters. Split it into two blocks.",
    ]);
    expect(
      refused([{ kind: "paragraph", rich: { v: 1, doc: { type: "doc", content: "x" } } }])
    ).toEqual([
      "Block 1 (Paragraph) couldn't be read. Copy its text into a new block, then remove this one.",
    ]);
  });

  it("refuses plain text over the limit rather than cutting it short", () => {
    expect(
      saved([{ kind: "paragraph", text: "x".repeat(NARRATIVE_LIMITS.maxTextChars) }])
    ).toHaveLength(1);
    expect(
      refused([{ kind: "paragraph", text: "x".repeat(NARRATIVE_LIMITS.maxTextChars + 1) }])
    ).toEqual([
      "Block 1 (Paragraph) is too long — at most 10,000 characters. Split it into two blocks.",
    ]);
  });

  it("keeps a list's items and a valid list style", () => {
    expect(
      saved([
        { kind: "list", items: ["One", "", "Two\u0000"], listStyle: "bullet" },
        { kind: "list", items: ["A"], listStyle: "number" },
        { kind: "list", items: ["B", 3, null, { x: 1 }], listStyle: "roman" },
        { kind: "list" },
      ])
    ).toEqual([
      { kind: "list", items: ["One", "", "Two"], listStyle: "bullet" },
      { kind: "list", items: ["A"], listStyle: "number" },
      { kind: "list", items: ["B"] },
      { kind: "list", items: [] },
    ]);
  });

  it("refuses a list over its limits", () => {
    const items = (n: number, text = "x") => Array.from({ length: n }, () => text);
    expect(saved([{ kind: "list", items: items(50) }])).toHaveLength(1);
    expect(refused([{ kind: "list", items: items(51) }])).toEqual([
      "Block 1 (List) has more than 50 points. Split it into two lists.",
    ]);
    expect(
      refused([{ kind: "list", items: ["ok", "x".repeat(1_001)] }])
    ).toEqual(["Block 1 (List): point 2 is too long — at most 1,000 characters."]);
  });

  it("keeps two sides of a compare block, each with a known tone", () => {
    expect(
      saved([
        {
          kind: "compare",
          compare: [
            { label: "Avoid", text: "Snapping back", tone: "negative", color: "red" },
            { label: "Try", text: "Pausing", tone: "positive" },
            { label: "Third", text: "Dropped", tone: "positive" },
          ],
        },
        {
          kind: "compare",
          compare: [{ label: 1, text: null, tone: "cheerful" }, "junk"],
        },
      ])
    ).toEqual([
      {
        kind: "compare",
        compare: [
          { label: "Avoid", text: "Snapping back", tone: "negative" },
          { label: "Try", text: "Pausing", tone: "positive" },
        ],
      },
      { kind: "compare", compare: [{ label: "", text: "", tone: "negative" }] },
    ]);
  });

  it("refuses a compare side over its limits", () => {
    expect(
      refused([
        {
          kind: "compare",
          compare: [
            { label: "x".repeat(121), text: "ok", tone: "negative" },
            { label: "ok", text: "x".repeat(2_001), tone: "positive" },
          ],
        },
      ])
    ).toEqual([
      "Block 1 (Compare two sides): the heading of side 1 is too long — at most 120 characters.",
      "Block 1 (Compare two sides): the text of side 2 is too long — at most 2,000 characters.",
    ]);
  });

  it("drops unknown kinds and anything a kind doesn't use", () => {
    expect(
      saved([
        { kind: "video", src: "https://x.test" },
        "text",
        null,
        [],
        {
          kind: "paragraph",
          text: "Hi",
          items: ["x"],
          compare: [],
          listStyle: "bullet",
          _key: "k1",
          onclick: "alert(1)",
        },
        { kind: "list", items: ["a"], text: "stray", rich: rich(p(t("x"))) },
      ])
    ).toEqual([
      { kind: "paragraph", text: "Hi" },
      { kind: "list", items: ["a"] },
    ]);
  });

  it("refuses more blocks than a lesson may have", () => {
    const blocks = (n: number) =>
      Array.from({ length: n }, () => ({ kind: "paragraph", text: "x" }));
    expect(saved(blocks(100))).toHaveLength(100);
    expect(refused(blocks(101))).toEqual([
      "A lesson can have at most 100 blocks — this one has 101. Remove or combine some.",
    ]);
  });

  it("refuses blocks that aren't a list", () => {
    for (const input of [undefined, null, "blocks", { kind: "paragraph" }]) {
      expect(refused(input)).toEqual([
        "The lesson's blocks couldn't be read. Reload the page and try again.",
      ]);
    }
  });

  it("reports every problem, numbering blocks as the editor sent them", () => {
    expect(
      refused([
        { kind: "paragraph", text: "x".repeat(10_001) },
        { kind: "list", items: ["ok"] },
        { kind: "list", items: Array.from({ length: 51 }, () => "x") },
      ])
    ).toEqual([
      "Block 1 (Paragraph) is too long — at most 10,000 characters. Split it into two blocks.",
      "Block 3 (List) has more than 50 points. Split it into two lists.",
    ]);
  });
});

describe("blockPlainText", () => {
  it("is the block's text when there is one", () => {
    expect(blockPlainText({ text: "Stored", rich: rich(p(t("Other"))) })).toBe("Stored");
    expect(blockPlainText({ text: "" })).toBe("");
  });

  it("derives the text from rich text stored without it", () => {
    expect(blockPlainText({ rich: rich(p(t("Take a "), t("moment", { type: "bold" }))) })).toBe(
      "Take a moment"
    );
  });

  it("is undefined when there's nothing readable", () => {
    expect(blockPlainText({})).toBeUndefined();
    expect(blockPlainText({ rich: { v: 9 } })).toBeUndefined();
  });
});

describe("cleanNarrativeLine", () => {
  it("makes one trimmed line without invisible characters", () => {
    expect(cleanNarrativeLine("  Why\tit\r\nmatters\u202E \u0000 ", 200)).toBe(
      "Why it matters"
    );
  });

  it("cuts at the limit without splitting an emoji", () => {
    expect(cleanNarrativeLine("abcdef", 4)).toBe("abcd");
    expect(cleanNarrativeLine("abc😊", 4)).toBe("abc");
    expect(cleanNarrativeLine("ab 😊", 5)).toBe("ab 😊");
  });

  it("is empty for anything but a string", () => {
    expect(cleanNarrativeLine(undefined, 10)).toBe("");
    expect(cleanNarrativeLine(42, 10)).toBe("");
  });
});
