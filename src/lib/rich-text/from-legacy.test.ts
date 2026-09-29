import { describe, it, expect } from "vitest";
import { legacyNodesToDoc, legacyTextToDoc } from "./from-legacy";
import { parseLegacyText } from "./legacy";
import { sanitizeRichText } from "./sanitize";
import type { RtBlock, RtDoc, RtInline, RtListItem } from "./types";

// Expected docs, written out.
const P = (...lines: string[]): RtBlock => ({
  type: "paragraph",
  content: lines.flatMap((text, i): RtInline[] =>
    i ? [{ type: "hardBreak" }, { type: "text", text }] : [{ type: "text", text }]
  ),
});
const item = (text: string): RtListItem => ({
  type: "listItem",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const UL = (...items: string[]): RtBlock => ({
  type: "bulletList",
  content: items.map(item),
});
const OL = (start: number, ...items: string[]): RtBlock =>
  start === 1
    ? { type: "orderedList", content: items.map(item) }
    : { type: "orderedList", attrs: { start }, content: items.map(item) };
const doc = (...content: RtBlock[]): RtDoc => ({ type: "doc", content });
const EMPTY = doc({ type: "paragraph" });

/**
 * Every input in Round 1's parser tests (legacy.test.ts), and the doc it
 * must become — the learner already sees exactly this structure.
 */
const CASES: [string, RtDoc][] = [
  ["", EMPTY],
  ["  \n \n\t ", EMPTY],
  ["Pause before you answer.", doc(P("Pause before you answer."))],
  ["First line\nSecond line", doc(P("First line", "Second line"))],
  ["One.\n\nTwo.\n\n\n\nThree.", doc(P("One."), P("Two."), P("Three."))],
  ["a\r\nb\r\n\r\nc\rd", doc(P("a", "b"), P("c", "d"))],
  [
    "\n\n   Indented line   \n\tTabbed line\t\n\n",
    doc(P("Indented line", "Tabbed line")),
  ],
  [
    [
      "When a message pushes you to react, slow down:",
      "• Pause and notice your first reaction",
      "• Question who benefits from the message",
      "• Decide what you will do next",
      "Practise this with the next headline you read.",
    ].join("\n"),
    doc(
      P("When a message pushes you to react, slow down:"),
      UL(
        "Pause and notice your first reaction",
        "Question who benefits from the message",
        "Decide what you will do next"
      ),
      P("Practise this with the next headline you read.")
    ),
  ],
  ...["•", "◦", "▪", "●", "■", "‣", "⁃", "·", "\uF0B7", "\uF0A7", "-", "–", "*"].map(
    (marker): [string, RtDoc] => [`${marker} one\n${marker} two`, doc(UL("one", "two"))]
  ),
  ["•\tone\n·\u00A0\u00A0two", doc(UL("one", "two"))],
  ["•Pause\n•Question\n\uF0B7Decide", doc(UL("Pause", "Question", "Decide"))],
  ["•Pause • Question • Decide", doc(UL("Pause", "Question", "Decide"))],
  [
    "·\tLevel one\no\tLevel two\n§\tLevel three",
    doc(UL("Level one", "Level two", "Level three")),
  ],
  [
    "o well, try again\n§ 12 applies here",
    doc(P("o well, try again", "§ 12 applies here")),
  ],
  ["- one\n* two\n• three", doc(UL("one", "two", "three"))],
  [
    "-5 °C is the threshold.\n-based on data\n*note*",
    doc(P("-5 °C is the threshold.", "-based on data", "*note*")),
  ],
  [
    "Think before you share.\n— A librarian",
    doc(P("Think before you share.", "— A librarian")),
  ],
  ["• one\n\n• two\n\n\n• three", doc(UL("one", "two", "three"))],
  ["1. Pause\n2. Question\n3. Decide", doc(OL(1, "Pause", "Question", "Decide"))],
  ["1) Pause\n2) Question", doc(OL(1, "Pause", "Question"))],
  [
    "4. Check the source\n5. Check the date",
    doc(OL(4, "Check the source", "Check the date")),
  ],
  ["1. Pause\n\n2. Question", doc(OL(1, "Pause", "Question"))],
  ["1. Pause\n3. Decide", doc(OL(1, "Pause"), OL(3, "Decide"))],
  [
    "2024. A new year\n1.5 hours\n12.03.2025 workshop",
    doc(P("2024. A new year", "1.5 hours", "12.03.2025 workshop")),
  ],
  [
    "Intro\n- a\n- b\n1. c\n2. d\nOutro\nmore outro",
    doc(P("Intro"), UL("a", "b"), OL(1, "c", "d"), P("Outro", "more outro")),
  ],
  [
    "Key points: • Pause • Question • Decide",
    doc(P("Key points:"), UL("Pause", "Question", "Decide")),
  ],
  ["• Pause • Question • Decide", doc(UL("Pause", "Question", "Decide"))],
  ["• Pause • Question", doc(UL("Pause", "Question"))],
  [
    "Before you share a post:\nAsk • Who wrote it? • Why now?\nThen decide.",
    doc(
      P("Before you share a post:", "Ask"),
      UL("Who wrote it?", "Why now?"),
      P("Then decide.")
    ),
  ],
  ["Berlin • Athens", doc(P("Berlin • Athens"))],
  ["Steps • • Pause • Decide", doc(P("Steps"), UL("Pause", "Decide"))],
  ["• Pause •", doc(UL("Pause •"))],
  ["Remember:\n•\nPause\n•\nDecide", doc(P("Remember:"), UL("Pause", "Decide"))],
  ["Text\n•\n\nMore", doc(P("Text"), P("More"))],
  [
    "Ärger bemerken – dann entscheiden 😊\n• Σκέψου πριν απαντήσεις; ναι· όχι\n• Straße ✅",
    doc(
      P("Ärger bemerken – dann entscheiden 😊"),
      UL("Σκέψου πριν απαντήσεις; ναι· όχι", "Straße ✅")
    ),
  ],
  [
    "<b>Bold?</b> & **not bold** <script>x</script>",
    doc(P("<b>Bold?</b> & **not bold** <script>x</script>")),
  ],
  [
    [
      "  Intro line with -5 °C and a hyphen-ated word  ",
      "Key points: • one • two • three",
      "",
      "1) first",
      "3) third",
      "* star item",
      "–\tdash item",
      "",
      "•",
      "orphan text",
      "Berlin • Athens",
    ].join("\r\n"),
    doc(
      P("Intro line with -5 °C and a hyphen-ated word", "Key points:"),
      UL("one", "two", "three"),
      OL(1, "first"),
      OL(3, "third"),
      UL("star item", "dash item", "orphan text"),
      P("Berlin • Athens")
    ),
  ],
  // Not in Round 1's tests: a list may start at 0.
  ["0. Zero\n1. One", doc(OL(0, "Zero", "One"))],
];

describe("legacyTextToDoc", () => {
  it.each(CASES)("converts %j with Round 1's rules", (text, expected) => {
    expect(legacyTextToDoc(text)).toEqual(expected);
  });

  it("builds canonical docs: the sanitizer finds nothing to change", () => {
    for (const [text] of CASES) {
      const doc = legacyTextToDoc(text);
      expect(sanitizeRichText({ v: 1, doc })).toEqual({
        value: { v: 1, doc },
        issues: [],
      });
    }
  });

  it("treats missing text as empty", () => {
    expect(legacyTextToDoc(undefined)).toEqual(EMPTY);
    expect(legacyTextToDoc(null)).toEqual(EMPTY);
    expect(legacyTextToDoc(42 as unknown as string)).toEqual(EMPTY);
  });
});

describe("legacyNodesToDoc", () => {
  it("shares nothing with the parsed nodes", () => {
    const nodes = parseLegacyText("a\nb\n• c");
    const result = legacyNodesToDoc(nodes);
    if (nodes[0].type === "paragraph") nodes[0].lines[0] = "changed";
    if (nodes[1].type === "bullets") nodes[1].items.push("more");
    expect(result).toEqual(doc(P("a", "b"), UL("c")));
  });
});
