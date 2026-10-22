import { describe, it, expect } from "vitest";
import { docToPlainText } from "./to-plain";
import { legacyTextToDoc } from "./from-legacy";
import type { RtBlock, RtDoc, RtInline, RtListItem } from "./types";

const t = (text: string, ...marks: ("bold" | "italic")[]): RtInline =>
  marks.length
    ? { type: "text", text, marks: marks.map((type) => ({ type })) }
    : { type: "text", text };
const br: RtInline = { type: "hardBreak" };
const p = (...content: RtInline[]): RtBlock => ({ type: "paragraph", content });
const li = (...content: RtBlock[]): RtListItem => ({ type: "listItem", content });
const ul = (...items: RtListItem[]): RtBlock => ({ type: "bulletList", content: items });
const ol = (start: number, ...items: RtListItem[]): RtBlock =>
  start === 1
    ? { type: "orderedList", content: items }
    : { type: "orderedList", attrs: { start }, content: items };
const doc = (...content: RtBlock[]): RtDoc => ({ type: "doc", content });

describe("docToPlainText", () => {
  it("separates blocks with a blank line and keeps line breaks", () => {
    expect(docToPlainText(doc(p(t("One"), br, t("two")), p(t("Three"))))).toBe(
      "One\ntwo\n\nThree"
    );
  });

  it("writes lists the way authors type them, with the real numbers", () => {
    expect(
      docToPlainText(
        doc(
          ul(li(p(t("Pause"))), li(p(t("Decide")))),
          ol(1, li(p(t("First"))), li(p(t("Second")))),
          ol(7, li(p(t("Seventh")))),
          ol(0, li(p(t("Zero"))))
        )
      )
    ).toBe("• Pause\n• Decide\n\n1. First\n2. Second\n\n7. Seventh\n\n0. Zero");
  });

  it("leaves out bold, italic and indent", () => {
    expect(
      docToPlainText(
        doc({
          type: "paragraph",
          attrs: { indent: 2 },
          content: [t("Stay "), t("calm", "bold", "italic"), t(".")],
        })
      )
    ).toBe("Stay calm.");
  });

  it("puts nested items after their parent, each with its own list's marker", () => {
    expect(
      docToPlainText(
        doc(
          ol(
            1,
            li(p(t("Notice")), ul(li(p(t("breath"))), li(p(t("tone"))))),
            li(p(t("Pause")), ol(1, li(p(t("count")), ul(li(p(t("to ten"))))))),
            li(p(t("Decide")))
          )
        )
      )
    ).toBe("1. Notice\n• breath\n• tone\n2. Pause\n1. count\n• to ten\n3. Decide");
  });

  it("keeps an item on one line: its paragraphs and line breaks join with spaces", () => {
    expect(
      docToPlainText(doc(ul(li(p(t("Ask"), br, t("who")), p(t("and why"))))))
    ).toBe("• Ask who and why");
  });

  it("gives an item without text of its own no line, keeping the numbers after it", () => {
    expect(
      docToPlainText(
        doc(
          ol(
            1,
            li({ type: "paragraph" }, ul(li(p(t("nested"))))),
            li(p(t("Second")))
          )
        )
      )
    ).toBe("• nested\n2. Second");
  });

  it("is empty for an empty doc", () => {
    expect(docToPlainText(doc({ type: "paragraph" }))).toBe("");
    expect(docToPlainText(doc())).toBe("");
  });

  it("reads back as the same doc for every plain-text structure (round trip)", () => {
    const inputs = [
      "Pause before you answer.",
      "First line\nSecond line",
      "One.\n\nTwo.\n\nThree.",
      "When:\n• Pause\n• Question\n• Decide\nPractise this.",
      "1. Pause\n2. Question",
      "4. Check the source\n5. Check the date",
      "1. Pause\n3. Decide",
      "Intro\n- a\n- b\n1. c\n2. d\nOutro\nmore outro",
      "Key points: • Pause • Question • Decide",
      "Before you share a post:\nAsk • Who wrote it? • Why now?\nThen decide.",
      "Berlin • Athens",
      "• Pause •",
      "o well, try again\n§ 12 applies here",
      "-5 °C is the threshold.\n-based on data\n*note*",
      "0. Zero\n1. One",
      "Ärger bemerken – dann entscheiden 😊\n• Σκέψου πριν απαντήσεις; ναι· όχι",
      "<b>Bold?</b> & **not bold** <script>x</script>",
    ];
    for (const input of inputs) {
      const d = legacyTextToDoc(input);
      expect(legacyTextToDoc(docToPlainText(d))).toEqual(d);
    }
  });

  it("reads a formatted doc back as the same paragraphs and lists, unformatted and flat", () => {
    const formatted = doc(
      {
        type: "paragraph",
        attrs: { indent: 1 },
        content: [t("Remember", "bold"), t(" this", "italic")],
      },
      ul(li(p(t("Pause")), ul(li(p(t("Breathe"))))), li(p(t("Decide")))),
      ol(3, li(p(t("Third"), br, t("line"))))
    );
    expect(legacyTextToDoc(docToPlainText(formatted))).toEqual(
      doc(
        p(t("Remember this")),
        ul(li(p(t("Pause"))), li(p(t("Breathe"))), li(p(t("Decide")))),
        ol(3, li(p(t("Third line"))))
      )
    );
  });
});

/* ------------------------------------------------- Links (Release 4, U5) */

const a = (text: string, href: string, ...marks: ("bold" | "italic")[]): RtInline => ({
  type: "text",
  text,
  marks: [...marks.map((type) => ({ type })), { type: "link", attrs: { href } }],
});

describe("docToPlainText: links (D104)", () => {
  it("writes a link as its text and, in brackets, its address", () => {
    expect(docToPlainText(doc(p(t("Read "), a("the guide", "https://example.org/guide"), t(" today."))))).toBe(
      "Read the guide (https://example.org/guide) today."
    );
  });

  it("writes one address for a link whose text changes formatting partway", () => {
    expect(
      docToPlainText(doc(p(a("the ", "https://example.org/guide"), a("guide", "https://example.org/guide", "bold"))))
    ).toBe("the guide (https://example.org/guide)");
  });

  it("gives an email link's bare address: no mailto:, no subject", () => {
    expect(docToPlainText(doc(p(t("Write to "), a("our team", "mailto:help@example.org?subject=Hi"), t("."))))).toBe(
      "Write to our team (help@example.org)."
    );
  });

  it("writes the text alone when it already shows the address", () => {
    expect(docToPlainText(doc(p(a("https://example.org/guide", "https://example.org/guide"))))).toBe(
      "https://example.org/guide"
    );
    // As a quick link would read it: the stored address is normalised.
    expect(docToPlainText(doc(p(a("Example.org: https://Example.org", "https://example.org/"))))).toBe(
      "Example.org: https://Example.org"
    );
    expect(docToPlainText(doc(p(a("Mail help@example.org", "mailto:help@example.org"))))).toBe("Mail help@example.org");
    expect(docToPlainText(doc(p(a("HELP@example.org", "mailto:help@example.org"))))).toBe("HELP@example.org");
  });

  it("keeps spaces at a link's ends outside the brackets", () => {
    expect(docToPlainText(doc(p(t("Read"), a(" the guide ", "https://example.org/g"), t("now"))))).toBe(
      "Read the guide (https://example.org/g) now"
    );
  });

  it("writes neighbouring links to different addresses each with its own", () => {
    expect(docToPlainText(doc(p(a("one", "https://example.org/a"), a("two", "https://example.org/b"))))).toBe(
      "one (https://example.org/a)two (https://example.org/b)"
    );
  });

  it("writes links in list points, nested ones too", () => {
    expect(
      docToPlainText(
        doc(
          ul(
            li(p(t("See "), a("the guide", "https://example.org/guide")), ul(li(p(a("us", "mailto:team@example.org"))))),
            li(p(t("Plain")))
          )
        )
      )
    ).toBe("• See the guide (https://example.org/guide)\n• us (team@example.org)\n• Plain");
  });

  it("reads back, by Round 1's rules, with the address a quick link", () => {
    const text = docToPlainText(doc(p(t("Read "), a("the guide", "https://example.org/guide"), t(" today."))));
    expect(legacyTextToDoc(text)).toEqual(doc(p(t("Read the guide (https://example.org/guide) today."))));
  });
});
