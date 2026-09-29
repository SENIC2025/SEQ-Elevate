import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormattedText } from "@/components/course/FormattedText";
import { legacyTextToDoc } from "@/lib/rich-text/from-legacy";
import { RichTextView } from "./RichTextView";

/**
 * Parity guard for existing lesson text (D36). Every lesson written before
 * rich text is plain text, and learners must keep seeing exactly what they
 * saw in Round 1 once FormattedText renders through the shared rich-text
 * renderer. The expected markup below was captured from Round 1's own
 * FormattedText, before the switch, for every input in its parser tests
 * (src/lib/rich-text/legacy.test.ts) and in FormattedText.test.ts. Don't
 * regenerate it: a difference here is a change learners would see.
 */

function render(props: Parameters<typeof FormattedText>[0]): string {
  return renderToStaticMarkup(createElement(FormattedText, props));
}

const CASES: [input: string, html: string][] = [
  ["", ""],
  ["  \n \n\t ", ""],
  [
    "Pause before you answer.",
    '<div class="seq-prose"><p>Pause before you answer.</p></div>',
  ],
  [
    "First line\nSecond line",
    '<div class="seq-prose"><p>First line<br/>Second line</p></div>',
  ],
  [
    "One.\n\nTwo.\n\n\n\nThree.",
    '<div class="seq-prose"><p>One.</p><p>Two.</p><p>Three.</p></div>',
  ],
  [
    "a\r\nb\r\n\r\nc\rd",
    '<div class="seq-prose"><p>a<br/>b</p><p>c<br/>d</p></div>',
  ],
  [
    "\n\n   Indented line   \n\tTabbed line\t\n\n",
    '<div class="seq-prose"><p>Indented line<br/>Tabbed line</p></div>',
  ],
  [
    "When a message pushes you to react, slow down:\n• Pause and notice your first reaction\n• Question who benefits from the message\n• Decide what you will do next\nPractise this with the next headline you read.",
    '<div class="seq-prose"><p>When a message pushes you to react, slow down:</p><ul><li>Pause and notice your first reaction</li><li>Question who benefits from the message</li><li>Decide what you will do next</li></ul><p>Practise this with the next headline you read.</p></div>',
  ],
  [
    "•\tone\n·  two",
    '<div class="seq-prose"><ul><li>one</li><li>two</li></ul></div>',
  ],
  [
    "•Pause\n•Question\nDecide",
    '<div class="seq-prose"><ul><li>Pause</li><li>Question</li><li>Decide</li></ul></div>',
  ],
  [
    "•Pause • Question • Decide",
    '<div class="seq-prose"><ul><li>Pause</li><li>Question</li><li>Decide</li></ul></div>',
  ],
  [
    "·\tLevel one\no\tLevel two\n§\tLevel three",
    '<div class="seq-prose"><ul><li>Level one</li><li>Level two</li><li>Level three</li></ul></div>',
  ],
  [
    "o well, try again\n§ 12 applies here",
    '<div class="seq-prose"><p>o well, try again<br/>§ 12 applies here</p></div>',
  ],
  [
    "- one\n* two\n• three",
    '<div class="seq-prose"><ul><li>one</li><li>two</li><li>three</li></ul></div>',
  ],
  [
    "-5 °C is the threshold.\n-based on data\n*note*",
    '<div class="seq-prose"><p>-5 °C is the threshold.<br/>-based on data<br/>*note*</p></div>',
  ],
  [
    "Think before you share.\n— A librarian",
    '<div class="seq-prose"><p>Think before you share.<br/>— A librarian</p></div>',
  ],
  [
    "• one\n\n• two\n\n\n• three",
    '<div class="seq-prose"><ul><li>one</li><li>two</li><li>three</li></ul></div>',
  ],
  [
    "1. Pause\n2. Question\n3. Decide",
    '<div class="seq-prose"><ol start="1"><li>Pause</li><li>Question</li><li>Decide</li></ol></div>',
  ],
  [
    "1) Pause\n2) Question",
    '<div class="seq-prose"><ol start="1"><li>Pause</li><li>Question</li></ol></div>',
  ],
  [
    "4. Check the source\n5. Check the date",
    '<div class="seq-prose"><ol start="4"><li>Check the source</li><li>Check the date</li></ol></div>',
  ],
  [
    "1. Pause\n\n2. Question",
    '<div class="seq-prose"><ol start="1"><li>Pause</li><li>Question</li></ol></div>',
  ],
  [
    "1. Pause\n3. Decide",
    '<div class="seq-prose"><ol start="1"><li>Pause</li></ol><ol start="3"><li>Decide</li></ol></div>',
  ],
  [
    "2024. A new year\n1.5 hours\n12.03.2025 workshop",
    '<div class="seq-prose"><p>2024. A new year<br/>1.5 hours<br/>12.03.2025 workshop</p></div>',
  ],
  [
    "Intro\n- a\n- b\n1. c\n2. d\nOutro\nmore outro",
    '<div class="seq-prose"><p>Intro</p><ul><li>a</li><li>b</li></ul><ol start="1"><li>c</li><li>d</li></ol><p>Outro<br/>more outro</p></div>',
  ],
  [
    "Key points: • Pause • Question • Decide",
    '<div class="seq-prose"><p>Key points:</p><ul><li>Pause</li><li>Question</li><li>Decide</li></ul></div>',
  ],
  [
    "• Pause • Question • Decide",
    '<div class="seq-prose"><ul><li>Pause</li><li>Question</li><li>Decide</li></ul></div>',
  ],
  [
    "• Pause • Question",
    '<div class="seq-prose"><ul><li>Pause</li><li>Question</li></ul></div>',
  ],
  [
    "Before you share a post:\nAsk • Who wrote it? • Why now?\nThen decide.",
    '<div class="seq-prose"><p>Before you share a post:<br/>Ask</p><ul><li>Who wrote it?</li><li>Why now?</li></ul><p>Then decide.</p></div>',
  ],
  [
    "Berlin • Athens",
    '<div class="seq-prose"><p>Berlin • Athens</p></div>',
  ],
  [
    "Steps • • Pause • Decide",
    '<div class="seq-prose"><p>Steps</p><ul><li>Pause</li><li>Decide</li></ul></div>',
  ],
  [
    "• Pause •",
    '<div class="seq-prose"><ul><li>Pause •</li></ul></div>',
  ],
  [
    "Remember:\n•\nPause\n•\nDecide",
    '<div class="seq-prose"><p>Remember:</p><ul><li>Pause</li><li>Decide</li></ul></div>',
  ],
  [
    "Text\n•\n\nMore",
    '<div class="seq-prose"><p>Text</p><p>More</p></div>',
  ],
  [
    "Ärger bemerken – dann entscheiden 😊\n• Σκέψου πριν απαντήσεις; ναι· όχι\n• Straße ✅",
    '<div class="seq-prose"><p>Ärger bemerken – dann entscheiden 😊</p><ul><li>Σκέψου πριν απαντήσεις; ναι· όχι</li><li>Straße ✅</li></ul></div>',
  ],
  [
    "<b>Bold?</b> & **not bold** <script>x</script>",
    '<div class="seq-prose"><p>&lt;b&gt;Bold?&lt;/b&gt; &amp; **not bold** &lt;script&gt;x&lt;/script&gt;</p></div>',
  ],
  [
    "  Intro line with -5 °C and a hyphen-ated word  \r\nKey points: • one • two • three\r\n\r\n1) first\r\n3) third\r\n* star item\r\n–\tdash item\r\n\r\n•\r\norphan text\r\nBerlin • Athens",
    '<div class="seq-prose"><p>Intro line with -5 °C and a hyphen-ated word<br/>Key points:</p><ul><li>one</li><li>two</li><li>three</li></ul><ol start="1"><li>first</li></ol><ol start="3"><li>third</li></ol><ul><li>star item</li><li>dash item</li><li>orphan text</li></ul><p>Berlin • Athens</p></div>',
  ],
  // FormattedText.test.ts
  [
    "Remember:\n• Pause\n• Decide",
    '<div class="seq-prose"><p>Remember:</p><ul><li>Pause</li><li>Decide</li></ul></div>',
  ],
  [
    "3. Check\n4. Decide",
    '<div class="seq-prose"><ol start="3"><li>Check</li><li>Decide</li></ol></div>',
  ],
  [
    "<b>x</b> & <script>alert(1)</script>",
    '<div class="seq-prose"><p>&lt;b&gt;x&lt;/b&gt; &amp; &lt;script&gt;alert(1)&lt;/script&gt;</p></div>',
  ],
];

/**
 * Text Round 1 shows exactly as typed, invisible characters and tabs
 * included, and a list numbered from 0. Existing text is never cleaned up
 * on the way to learners — only text saved from the new editor is.
 */
const AS_TYPED: [input: string, html: string][] = [
  [
    "0. Zero\n1. One",
    '<div class="seq-prose"><ol start="0"><li>Zero</li><li>One</li></ol></div>',
  ],
  [
    "Zero​width and ‮reversed‬ text",
    '<div class="seq-prose"><p>Zero​width and ‮reversed‬ text</p></div>',
  ],
  [
    "Tab\tinside a line",
    '<div class="seq-prose"><p>Tab\tinside a line</p></div>',
  ],
];

const BULLET_MARKERS = [
  "•", "◦", "▪", "●", "■", "‣", "⁃", "·", "", "", "-", "–", "*",
];

describe("legacy lesson text renders exactly as in Round 1", () => {
  it.each(CASES)("%j", (input, html) => {
    expect(render({ text: input })).toBe(html);
  });

  it.each(AS_TYPED)("%j", (input, html) => {
    expect(render({ text: input })).toBe(html);
  });

  it("renders every bullet marker as the same list", () => {
    for (const marker of BULLET_MARKERS) {
      expect(render({ text: `${marker} one\n${marker} two` })).toBe(
        '<div class="seq-prose"><ul><li>one</li><li>two</li></ul></div>'
      );
    }
  });

  it("keeps the compact spacing and the caller's classes on the root", () => {
    expect(
      render({
        text: "Remember:\n• Pause\n• Decide\n\n3. Check",
        compact: true,
        className: "inline-block text-sm",
      })
    ).toBe(
      '<div class="seq-prose seq-prose-compact inline-block text-sm"><p>Remember:</p><ul><li>Pause</li><li>Decide</li></ul><ol start="3"><li>Check</li></ol></div>'
    );
  });

  it("renders nothing without text", () => {
    expect(render({ text: undefined })).toBe("");
  });
});

// Added with the switch to RichTextView; the Round 1 captures above are
// unchanged.
describe("legacy lesson text through RichTextView", () => {
  const view = (props: Parameters<typeof RichTextView>[0]) =>
    renderToStaticMarkup(createElement(RichTextView, props));

  it.each(CASES)("as plain text: %j", (input, html) => {
    expect(view({ text: input })).toBe(html);
  });

  // An author's first edit turns a plain block into rich text. Converted
  // by the same rules, it must still look the same to learners: the same
  // markup, its root only adding the editor's handling of spaces (the rules
  // trim every line, so that changes nothing but runs of spaces inside one,
  // which the author saw while editing).
  it.each(CASES)("converted to rich text: %j", (input, html) => {
    const rich = { v: 1, doc: legacyTextToDoc(input) };
    expect(view({ rich, text: "ignored while rich is usable" })).toBe(
      html.replace(
        '<div class="seq-prose">',
        '<div class="seq-prose whitespace-break-spaces">'
      )
    );
  });
});
