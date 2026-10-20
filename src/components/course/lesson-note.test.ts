import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { LessonNote } from "./lesson-note";
import { renderIn, textOf } from "./sectioned/render.test-helpers";

/**
 * The note above a lesson the learner is taken to out of order (spec 5.2,
 * 5.5). Review finding 3 on Stream A: after the last lesson, Continue went
 * back to a lesson still to do and said why in the live region only — an
 * editor previewing lesson 5 of 5 landed on lesson 1 with nothing on the
 * screen to say why (spec 5.2: "with the message continueHint.stillToDo").
 */

const note = (props: Parameters<typeof LessonNote>[0], locale: "en" | "de" | "el" = "en") =>
  renderIn(createElement(LessonNote, props), locale);

describe("LessonNote", () => {
  it("says which lesson is still to do, on the screen", () => {
    const html = note({ kind: "stillToDo", name: "One" });
    expect(textOf(html)).toBe("Before you finish: “One” is still to do.");
    expect(html).not.toContain("sr-only");
    expect(textOf(note({ kind: "stillToDo", name: "Eins" }, "de"))).toBe("Bevor du abschließt: „Eins“ fehlt noch.");
  });

  it("marks the lesson's name with its language when it isn't the page's (WCAG 3.1.2)", () => {
    const html = note({ kind: "stillToDo", name: "Warm-up", lang: "en" }, "el");
    expect(html).toContain("«<span lang=\"en\">Warm-up</span>»");
    expect(note({ kind: "stillToDo", name: "One" })).not.toContain(" lang=");
  });

  // Review finding 2 on Stream A: a lesson only moved there was said to
  // have been "added after you started".
  it("says a lesson not done before done ones is still to do, never that it was added", () => {
    expect(textOf(note({ kind: "new" }))).toBe("You haven't done this lesson yet. It's new, or it has moved.");
  });
});
