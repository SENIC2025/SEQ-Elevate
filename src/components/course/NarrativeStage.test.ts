import { describe, it, expect } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { NarrativeBlock } from "@/lib/cms/types";
import { NarrativeBlocks } from "./NarrativeStage";

// The learner's lesson blocks — also what the course page's read view shows.
function render(blocks: NarrativeBlock[]): string {
  return renderToStaticMarkup(createElement(NarrativeBlocks, { blocks }));
}

const rich = (
  ...content: NonNullable<NarrativeBlock["rich"]>["doc"]["content"]
): NarrativeBlock["rich"] => ({ v: 1, doc: { type: "doc", content } });

describe("NarrativeBlocks", () => {
  it("renders a rich paragraph with its formatting", () => {
    const html = render([
      {
        kind: "paragraph",
        text: "Stay calm",
        rich: rich({
          type: "paragraph",
          content: [
            { type: "text", text: "Stay " },
            { type: "text", text: "calm", marks: [{ type: "bold" }] },
          ],
        }),
      },
    ]);
    expect(html).toContain(
      '<div class="seq-prose whitespace-break-spaces text-base leading-relaxed"><p>Stay <strong>calm</strong></p></div>'
    );
  });

  it("renders a plain paragraph as before", () => {
    expect(render([{ kind: "paragraph", text: "One\n• a\n• b" }])).toContain(
      '<div class="seq-prose text-base leading-relaxed"><p>One</p><ul><li>a</li><li>b</li></ul></div>'
    );
  });

  it("renders a rich key message compact, in its pill", () => {
    const html = render([
      {
        kind: "callout",
        text: "Pause",
        rich: rich({
          type: "paragraph",
          content: [{ type: "text", text: "Pause", marks: [{ type: "italic" }] }],
        }),
      },
    ]);
    expect(html).toMatch(
      /<div class="seq-prose seq-prose-compact whitespace-break-spaces inline-block rounded-lg [^"]*"><p><em>Pause<\/em><\/p><\/div>/
    );
  });

  it("falls back to a block's plain text when its rich text can't be used", () => {
    const html = render([
      { kind: "paragraph", text: "Plain", rich: { v: 7 } as never },
    ]);
    expect(html).toContain("<p>Plain</p>");
  });

  it("renders a bulleted list block as a list with bullets", () => {
    const html = render([
      { kind: "list", listStyle: "bullet", items: ["One", "Two"] },
    ]);
    expect(html).toContain(
      '<ul class="space-y-2 list-disc pl-5 marker:text-[var(--accent)]"><li class="text-base">One</li><li class="text-base">Two</li></ul>'
    );
    expect(html).not.toContain("<ol");
  });

  it("numbers a list block without a style, as lists always were", () => {
    for (const listStyle of [undefined, "number", "roman"] as const) {
      const html = render([
        { kind: "list", listStyle: listStyle as never, items: ["One"] },
      ]);
      expect(html).toContain(
        '<ol class="space-y-2 list-decimal pl-5 marker:text-[var(--accent)] marker:font-semibold"><li class="text-base">One</li></ol>'
      );
      expect(html).not.toContain("<ul");
    }
  });

  it("keeps list items and compare sides as plain text", () => {
    const html = render([
      { kind: "list", listStyle: "bullet", items: ["<b>x</b>"] },
      {
        kind: "compare",
        compare: [
          { label: "Before", text: "• a\n• b", tone: "negative" },
          { label: "After", text: "calm", tone: "positive" },
        ],
      },
    ]);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain(
      '<div class="seq-prose text-sm leading-relaxed"><ul><li>a</li><li>b</li></ul></div>'
    );
  });

  it("survives malformed blocks from the CMS or a direct database write", () => {
    const broken = [
      { kind: "paragraph", text: 42 },
      { kind: "callout", text: { oops: true } },
      { kind: "list", items: "not a list" },
      { kind: "list", items: [{ nested: 1 }, "ok"] },
      { kind: "compare", compare: [null, { label: 7, text: ["x"], tone: "positive" }] },
    ] as unknown as NarrativeBlock[];
    const html = render(broken);
    expect(html).toContain("<li class=\"text-base\">ok</li>");
    expect(html).not.toContain("[object Object]");
  });
});

// Quick links: every kind of lesson text links the addresses typed in it.
const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  children?: ReactNode;
}>;

function renderWithMessages(blocks: NarrativeBlock[]): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: en },
      createElement(NarrativeBlocks, { blocks })
    )
  );
}

const link = (href: string, shown: string) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer" class="seq-link">${shown}<span class="sr-only"> (opens in a new tab)</span></a>`;

describe("NarrativeBlocks quick links", () => {
  it("links addresses in a list block's points", () => {
    const html = renderWithMessages([
      {
        kind: "list",
        listStyle: "bullet",
        items: ["Visit https://example.org.", "Mail help@example.org", "None"],
      },
    ]);
    expect(html).toContain(
      `<li class="text-base">Visit ${link("https://example.org/", "https://example.org")}.</li>` +
        `<li class="text-base">Mail ${link("mailto:help@example.org", "help@example.org")}</li>` +
        '<li class="text-base">None</li>'
    );
  });

  it("links addresses in paragraphs, key messages and compare sides", () => {
    const html = renderWithMessages([
      { kind: "paragraph", text: "See https://example.org/a" },
      { kind: "callout", text: "Ask help@example.org" },
      {
        kind: "compare",
        compare: [{ label: "Do", text: "https://example.org/b", tone: "positive" }],
      },
    ]);
    expect(html).toContain(link("https://example.org/a", "https://example.org/a"));
    expect(html).toContain(link("mailto:help@example.org", "help@example.org"));
    expect(html).toContain(link("https://example.org/b", "https://example.org/b"));
  });
});
