import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";

vi.mock("@/store/demo-state", () => ({
  useDemoState: () => {
    throw new Error("the sectioned preview must not use the learner store");
  },
}));

import { SectionView, type PreviewAnswers } from "./SectionView";
import { quizPart, quizPart2, sectionStage, textPart } from "./test-fixtures";
import { attr, elements, renderIn, textOf } from "./render.test-helpers";
import type { SectionStage } from "@/lib/cms/sections/contract";

function render(stage: SectionStage, answers: PreviewAnswers = {}, locale: "en" | "de" = "en") {
  return renderIn(
    createElement(SectionView, {
      stage,
      stageNumber: 2,
      answers,
      onAnswer: () => {},
      onContinue: () => {},
    }),
    locale
  );
}

describe("SectionView", () => {
  it("titles the lesson with an h2 and each piece of content with an h3 that names its region", () => {
    const html = render(sectionStage);
    expect(elements(html, "h2").map((h) => textOf(h.inner))).toEqual(["Warm-up"]);
    const sections = [...html.matchAll(/<section([^>]*)>/g)].map((m) => m[1]);
    const h3s = elements(html, "h3");
    expect(sections).toHaveLength(6);
    expect(h3s.map((h) => textOf(h.inner))).toEqual([
      "Text",
      "Practice question",
      "Quick check",
      "One more check",
      "Reflection questions",
      "How you speak up",
    ]);
    sections.forEach((s, i) => expect(attr(s, "aria-labelledby")).toBe(attr(h3s[i].attrs, "id")));
    // Every heading can take focus, for Continue's "answer this first".
    expect(h3s.every((h) => attr(h.attrs, "tabindex") === "-1")).toBe(true);
    expect(new Set(h3s.map((h) => attr(h.attrs, "id"))).size).toBe(6);
  });

  it("keeps a text heading for screen readers only, and shows a titled question's kind above it", () => {
    const html = render(sectionStage);
    const [text, , , titled] = elements(html, "h3");
    expect(attr(text.attrs, "class")).toContain("sr-only");
    expect(attr(titled.attrs, "class")).not.toContain("sr-only");
    expect(html).toMatch(/>Quick check<\/p><h3[^>]*>One more check<\/h3>/);
  });

  it("shows the subtitle as an eyebrow above the title", () => {
    expect(render(sectionStage)).toMatch(/>Before we start<\/p><h2[^>]*>Warm-up<\/h2>/);
  });

  it("always shows one enabled Continue, even with nothing answered", () => {
    const buttons = elements(render(sectionStage), "button").filter(
      (b) => textOf(b.inner) === "Continue"
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0].attrs).not.toMatch(/\sdisabled=""|aria-disabled="true"/);
  });

  it("has a polite live region for 'answer this first', empty until Continue is pressed", () => {
    const html = render(sectionStage);
    expect(html).toMatch(/<p role="status" aria-live="polite" class="sr-only"><\/p>/);
    expect(textOf(html)).not.toContain("Answer this first to continue.");
  });

  it("keeps two quick checks' answers apart", () => {
    const answers: PreviewAnswers = {
      "s-abcd1234/p-quizaaaa": { type: "quiz", answers: { q1: "b" }, checked: false },
    };
    const html = render({ ...sectionStage, parts: [quizPart, quizPart2] }, answers);
    const sections = html.split("<section").slice(1);
    const pressed = (s: string) => (s.match(/aria-pressed="true"/g) ?? []).length;
    expect(pressed(sections[0])).toBe(1);
    expect(pressed(sections[1])).toBe(0);
  });

  it("tells editors how much content was left out, and nothing when none was", () => {
    expect(textOf(render({ ...sectionStage, skipped: 2 }))).toContain(
      "For editors: 2 pieces of content aren't shown here — only a draft so far, or not ready yet."
    );
    expect(textOf(render({ ...sectionStage, skipped: 1 }))).toContain(
      "one piece of content isn't shown"
    );
    expect(textOf(render(sectionStage))).not.toContain("For editors");
    expect(textOf(render({ ...sectionStage, skipped: 1 }, {}, "de"))).toContain(
      "Für die Redaktion: Ein Inhalt wird hier nicht gezeigt"
    );
  });

  it("puts the video and documents above the lesson's title", () => {
    const html = render({
      ...sectionStage,
      parts: [textPart],
      video: { provider: "youtube", src: "dQw4w9WgXcQ", title: "Watch first" },
      documents: [
        {
          id: "d1",
          name: "Checklist.pdf",
          url: "/files/checklist.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1200,
          published: true,
        },
      ],
    });
    const video = html.indexOf('aria-label="Watch first"');
    const docs = html.indexOf("Checklist.pdf");
    const title = html.indexOf("<h2");
    expect(video).toBeGreaterThan(-1);
    expect(docs).toBeGreaterThan(video);
    expect(title).toBeGreaterThan(docs);
  });

  it("shows a lesson with no content of its own (only media) without a stray region", () => {
    const html = render({ ...sectionStage, parts: [] });
    expect(html).not.toContain("<section");
    expect(textOf(html)).toContain("Continue");
  });
});
