import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import type { CourseStage } from "@/lib/cms/types";
import { EMPTY_PROGRESS, fitPatch, patchSince } from "@/lib/learner-progress/patch";

// The learner store, as the stage reads it: the three reflection answers.
const store = vi.hoisted(() => ({
  reflection: { p1: "", p2: "", p3: "" },
  refused: {} as Record<string, string>,
}));
// The reflection's help line links /help with the locale-aware Link.
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, ...rest }: { href: string }) => h("a", { href: `/en${href}`, ...rest }) };
});
vi.mock("@/store/demo-state", async () => {
  const { fakeCourse } = await import("./press.test-helpers");
  return {
    useDemoState: () => ({
      state: { course: fakeCourse({ reflection: store.reflection }), refusedKeys: store.refused },
      dispatch: () => {},
    }),
  };
});

import { ReflectionStage } from "./ReflectionStage";
import { answerLengthState } from "./answer-length";
import { elements, attr, renderIn, textOf } from "./sectioned/render.test-helpers";

/**
 * UA5 (spec 5.8): the reflection boxes are named by their questions (Release
 * 1's had no name: a <label> not tied to its box), and an answer past 5,000
 * characters is said to be too long and isn't sent, rather than cut.
 */

const stage: CourseStage = {
  key: "reflection",
  title: "Look back",
  reflection: {
    intro: "Think about the last time you needed help.",
    prompts: [
      { label: "What went well?", placeholder: "A moment…" },
      { label: "What was hard?", placeholder: "" },
      { label: "What will you try next time?", placeholder: "" },
    ],
  },
};

function render(
  reflection = { p1: "", p2: "", p3: "" },
  locale: "en" | "de" = "en",
  refused: Record<string, string> = {}
) {
  store.reflection = reflection;
  store.refused = refused;
  return renderIn(createElement(ReflectionStage, { stage, onContinue: () => {} }), locale);
}

describe("ReflectionStage", () => {
  it("ties each question's label to its box", () => {
    const html = render();
    const labels = elements(html, "label");
    const boxes = [...html.matchAll(/<textarea([^>]*)>/g)].map((m) => m[1]);
    expect(labels.map((l) => textOf(l.inner))).toEqual([
      "What went well?",
      "What was hard?",
      "What will you try next time?",
    ]);
    expect(boxes).toHaveLength(3);
    labels.forEach((l, i) => {
      const id = attr(l.attrs, "for");
      expect(id).toBeTruthy();
      expect(attr(boxes[i], "id")).toBe(id);
    });
    expect(new Set(labels.map((l) => attr(l.attrs, "for"))).size).toBe(3);
  });

  it("never cuts what is typed or pasted (no maxLength), and says nothing while it's short", () => {
    const html = render({ p1: "x".repeat(4_499), p2: "", p3: "" });
    expect(html).not.toMatch(/maxlength/i);
    expect(textOf(html)).not.toMatch(/characters left|too long/);
    expect(html).not.toMatch(/aria-describedby/);
  });

  it("from 4,500 characters, says how many are left, describing the box", () => {
    const html = render({ p1: "x".repeat(4_600), p2: "", p3: "" });
    expect(textOf(html)).toContain("400 characters left");
    const box = [...html.matchAll(/<textarea([^>]*)>/g)][0][1];
    const noteId = attr(box, "aria-describedby");
    expect(html).toContain(`<p id="${noteId}"`);
    expect(render({ p1: "", p2: "x".repeat(4_600), p3: "" }, "de")).toContain("Noch 400 Zeichen");
  });

  it("past 5,000, says the answer is too long to save, and marks the box", () => {
    const html = render({ p1: "", p2: "", p3: "x".repeat(5_001) });
    expect(textOf(html)).toContain("This answer is too long to save. Shorten it to 5000 characters.");
    const box = [...html.matchAll(/<textarea([^>]*)>/g)][2][1];
    expect(attr(box, "aria-invalid")).toBe("true");
  });

  // Review finding 1 on Stream A (D62.d): a refusal other than the length
  // — the server couldn't take the answer at all — was never shown.
  it("says the answers couldn't be saved when the server refused them, under the boxes", () => {
    const html = render({ p1: "Asked early.", p2: "", p3: "" }, "en", { "reflection/main": "invalid" });
    const text = textOf(html);
    expect(text).toContain(
      "This answer couldn't be saved. You can carry on, but it won't be there after a reload or on another device."
    );
    expect(html.indexOf("couldn&#x27;t be saved")).toBeGreaterThan(html.lastIndexOf("<textarea"));
    // Held back as too long: the box's own note says so, once.
    const long = textOf(render({ p1: "x".repeat(5_001), p2: "", p3: "" }, "en", { "reflection/main": "too-long" }));
    expect(long).toContain("This answer is too long to save.");
    expect(long).not.toContain("couldn't be saved");
    expect(textOf(render({ p1: "Asked early.", p2: "", p3: "" }))).not.toContain("couldn't be saved");
  });

  it("an answer past the limit isn't sent, while the others are", () => {
    const latest = {
      ...EMPTY_PROGRESS,
      reflection: { p1: "Fine.", p2: "x".repeat(5_001), p3: "" },
    };
    const fitted = fitPatch(patchSince(EMPTY_PROGRESS, latest)!);
    expect(fitted.held).toEqual([{ key: "reflection/main", reason: "too-long" }]);
    expect(fitted.patch?.answers?.["reflection/main"]).toEqual({ type: "reflection", text: { p1: "Fine." } });
    // The note and the store agree on where the limit is.
    expect(answerLengthState(latest.reflection.p2)).toEqual({ kind: "tooLong", max: 5_000 });
    expect(answerLengthState("x".repeat(5_000))).toEqual({ kind: "left", left: 0 });
  });
});

/*
 * Release 3 (D93, spec 11.3; R3-D1): nobody reads course reflections, so
 * one line after the intro says so and links the help page. Release 2
 * had nothing there.
 */
describe("ReflectionStage: the help line", () => {
  it("follows the intro, before the first question, linking /help", () => {
    const html = render();
    const text = textOf(html);
    const intro = text.indexOf("Think about the last time you needed help.");
    const hint = text.indexOf("Facilitators don't read what you write here.");
    expect(intro).toBeGreaterThan(-1);
    expect(hint).toBeGreaterThan(intro);
    expect(hint).toBeLessThan(text.indexOf("What went well?"));
    expect(html).toContain('href="/en/help"');
    expect(textOf(render(undefined, "de"))).toContain("Die Trainer:innen lesen nicht, was du hier schreibst.");
  });
});
