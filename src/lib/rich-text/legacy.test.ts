import { describe, it, expect } from "vitest";
import { parseLegacyText, type LegacyNode } from "./legacy";

/** Every word the learner will read, in order — markers excluded. */
function wordsOf(nodes: LegacyNode[]): string[] {
  return nodes
    .flatMap((n) => (n.type === "paragraph" ? n.lines : n.items))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
}

describe("parseLegacyText", () => {
  it("returns nothing for empty or whitespace-only text", () => {
    expect(parseLegacyText("")).toEqual([]);
    expect(parseLegacyText("  \n \n\t ")).toEqual([]);
  });

  it("keeps a single line as one paragraph", () => {
    expect(parseLegacyText("Pause before you answer.")).toEqual([
      { type: "paragraph", lines: ["Pause before you answer."] },
    ]);
  });

  it("keeps line breaks inside a paragraph", () => {
    expect(parseLegacyText("First line\nSecond line")).toEqual([
      { type: "paragraph", lines: ["First line", "Second line"] },
    ]);
  });

  it("starts a new paragraph after one or more blank lines", () => {
    expect(parseLegacyText("One.\n\nTwo.\n\n\n\nThree.")).toEqual([
      { type: "paragraph", lines: ["One."] },
      { type: "paragraph", lines: ["Two."] },
      { type: "paragraph", lines: ["Three."] },
    ]);
  });

  it("handles Windows and old Mac line endings", () => {
    expect(parseLegacyText("a\r\nb\r\n\r\nc\rd")).toEqual([
      { type: "paragraph", lines: ["a", "b"] },
      { type: "paragraph", lines: ["c", "d"] },
    ]);
  });

  it("trims leading and trailing whitespace from the text and each line", () => {
    expect(parseLegacyText("\n\n   Indented line   \n\tTabbed line\t\n\n")).toEqual([
      { type: "paragraph", lines: ["Indented line", "Tabbed line"] },
    ]);
  });

  it("turns bullets on their own lines into a list instead of a wall of text", () => {
    const text = [
      "When a message pushes you to react, slow down:",
      "• Pause and notice your first reaction",
      "• Question who benefits from the message",
      "• Decide what you will do next",
      "Practise this with the next headline you read.",
    ].join("\n");
    expect(parseLegacyText(text)).toEqual([
      {
        type: "paragraph",
        lines: ["When a message pushes you to react, slow down:"],
      },
      {
        type: "bullets",
        items: [
          "Pause and notice your first reaction",
          "Question who benefits from the message",
          "Decide what you will do next",
        ],
      },
      {
        type: "paragraph",
        lines: ["Practise this with the next headline you read."],
      },
    ]);
  });

  it("accepts the bullet markers people type or paste", () => {
    for (const marker of ["•", "◦", "▪", "●", "■", "‣", "⁃", "·", "", "-", "–", "*"]) {
      expect(parseLegacyText(`${marker} one\n${marker} two`)).toEqual([
        { type: "bullets", items: ["one", "two"] },
      ]);
    }
  });

  it("accepts a tab or non-breaking space after the marker (Word pastes)", () => {
    expect(parseLegacyText("•\tone\n·  two")).toEqual([
      { type: "bullets", items: ["one", "two"] },
    ]);
  });

  it("keeps mixed markers in one list", () => {
    expect(parseLegacyText("- one\n* two\n• three")).toEqual([
      { type: "bullets", items: ["one", "two", "three"] },
    ]);
  });

  it("does not treat a dash or asterisk without a following space as a bullet", () => {
    expect(parseLegacyText("-5 °C is the threshold.\n-based on data\n*note*")).toEqual([
      {
        type: "paragraph",
        lines: ["-5 °C is the threshold.", "-based on data", "*note*"],
      },
    ]);
  });

  it("does not treat an em dash attribution as a bullet", () => {
    expect(parseLegacyText("Think before you share.\n— A librarian")).toEqual([
      { type: "paragraph", lines: ["Think before you share.", "— A librarian"] },
    ]);
  });

  it("keeps one list when blank lines separate its items", () => {
    expect(parseLegacyText("• one\n\n• two\n\n\n• three")).toEqual([
      { type: "bullets", items: ["one", "two", "three"] },
    ]);
  });

  it("turns numbered lines into a numbered list", () => {
    expect(parseLegacyText("1. Pause\n2. Question\n3. Decide")).toEqual([
      { type: "numbers", start: 1, items: ["Pause", "Question", "Decide"] },
    ]);
    expect(parseLegacyText("1) Pause\n2) Question")).toEqual([
      { type: "numbers", start: 1, items: ["Pause", "Question"] },
    ]);
  });

  it("keeps the number a list starts at", () => {
    expect(parseLegacyText("4. Check the source\n5. Check the date")).toEqual([
      { type: "numbers", start: 4, items: ["Check the source", "Check the date"] },
    ]);
  });

  it("keeps a numbered list across blank lines while the sequence continues", () => {
    expect(parseLegacyText("1. Pause\n\n2. Question")).toEqual([
      { type: "numbers", start: 1, items: ["Pause", "Question"] },
    ]);
  });

  it("starts a new list when the numbers skip, so the author's numbers show", () => {
    expect(parseLegacyText("1. Pause\n3. Decide")).toEqual([
      { type: "numbers", start: 1, items: ["Pause"] },
      { type: "numbers", start: 3, items: ["Decide"] },
    ]);
  });

  it("does not treat years, decimals or dates as numbered items", () => {
    expect(parseLegacyText("2024. A new year\n1.5 hours\n12.03.2025 workshop")).toEqual([
      {
        type: "paragraph",
        lines: ["2024. A new year", "1.5 hours", "12.03.2025 workshop"],
      },
    ]);
  });

  it("splits a paragraph, bullets, numbers and a paragraph without blank lines", () => {
    const text = "Intro\n- a\n- b\n1. c\n2. d\nOutro\nmore outro";
    expect(parseLegacyText(text)).toEqual([
      { type: "paragraph", lines: ["Intro"] },
      { type: "bullets", items: ["a", "b"] },
      { type: "numbers", start: 1, items: ["c", "d"] },
      { type: "paragraph", lines: ["Outro", "more outro"] },
    ]);
  });

  it("splits inline bullets pasted onto one line into a lead-in and a list", () => {
    expect(parseLegacyText("Key points: • Pause • Question • Decide")).toEqual([
      { type: "paragraph", lines: ["Key points:"] },
      { type: "bullets", items: ["Pause", "Question", "Decide"] },
    ]);
  });

  it("splits a line that starts with a bullet and carries more inline", () => {
    expect(parseLegacyText("• Pause • Question • Decide")).toEqual([
      { type: "bullets", items: ["Pause", "Question", "Decide"] },
    ]);
    expect(parseLegacyText("• Pause • Question")).toEqual([
      { type: "bullets", items: ["Pause", "Question"] },
    ]);
  });

  it("joins an inline lead-in to the paragraph above it", () => {
    expect(parseLegacyText("Before you share a post:\nAsk • Who wrote it? • Why now?\nThen decide.")).toEqual([
      { type: "paragraph", lines: ["Before you share a post:", "Ask"] },
      { type: "bullets", items: ["Who wrote it?", "Why now?"] },
      { type: "paragraph", lines: ["Then decide."] },
    ]);
  });

  it("leaves a single inline bullet alone — it is usually a separator", () => {
    expect(parseLegacyText("Berlin • Athens")).toEqual([
      { type: "paragraph", lines: ["Berlin • Athens"] },
    ]);
  });

  it("drops empty inline items but keeps a trailing bullet glyph as text", () => {
    expect(parseLegacyText("Steps • • Pause • Decide")).toEqual([
      { type: "paragraph", lines: ["Steps"] },
      { type: "bullets", items: ["Pause", "Decide"] },
    ]);
    expect(parseLegacyText("• Pause •")).toEqual([
      { type: "bullets", items: ["Pause •"] },
    ]);
  });

  it("joins a bullet glyph alone on its line to the next line (PDF copies)", () => {
    expect(parseLegacyText("Remember:\n•\nPause\n•\nDecide")).toEqual([
      { type: "paragraph", lines: ["Remember:"] },
      { type: "bullets", items: ["Pause", "Decide"] },
    ]);
  });

  it("drops a bullet glyph that has nothing after it", () => {
    expect(parseLegacyText("Text\n•\n\nMore")).toEqual([
      { type: "paragraph", lines: ["Text"] },
      { type: "paragraph", lines: ["More"] },
    ]);
  });

  it("preserves German, Greek and emoji text exactly", () => {
    const text = "Ärger bemerken – dann entscheiden 😊\n• Σκέψου πριν απαντήσεις; ναι· όχι\n• Straße ✅";
    expect(parseLegacyText(text)).toEqual([
      { type: "paragraph", lines: ["Ärger bemerken – dann entscheiden 😊"] },
      { type: "bullets", items: ["Σκέψου πριν απαντήσεις; ναι· όχι", "Straße ✅"] },
    ]);
  });

  it("never interprets HTML or markdown", () => {
    const text = "<b>Bold?</b> & **not bold** <script>x</script>";
    expect(parseLegacyText(text)).toEqual([{ type: "paragraph", lines: [text] }]);
  });

  it("never loses a word of the author's text", () => {
    const text = [
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
    ].join("\r\n");
    // Only list markers disappear; "Berlin • Athens" keeps its separator.
    expect(wordsOf(parseLegacyText(text))).toEqual([
      "Intro", "line", "with", "-5", "°C", "and", "a", "hyphen-ated", "word",
      "Key", "points:", "one", "two", "three",
      "first", "third", "star", "item", "dash", "item",
      "orphan", "text", "Berlin", "•", "Athens",
    ]);
  });
});
