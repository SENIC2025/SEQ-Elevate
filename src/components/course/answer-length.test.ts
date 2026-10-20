import { describe, it, expect, vi, beforeEach } from "vitest";

// Effects run as the component renders, so what a note does when a lesson
// opens can be seen without a DOM (vitest runs in node).
vi.mock("react", async (importOriginal) => {
  const React = await importOriginal<typeof import("react")>();
  return { ...React, useEffect: (effect: () => void) => void effect() };
});
const announced = vi.hoisted(() => [] as string[]);
vi.mock("./PlayerAnnouncer", () => ({ useAnnounce: () => (t: string) => announced.push(t) }));

import { createElement } from "react";
import { AnswerLengthNote, answerLengthState } from "./answer-length";
import { renderIn, textOf } from "./sectioned/render.test-helpers";

/**
 * Spec 5.8 (owner default 7): the note under a written answer near or past
 * 5,000 characters. Review findings 4 and 5 on Stream A: a lesson opening
 * with a long answer already saved said "N characters left" at once, every
 * box replacing the last; and one character left read "1 characters left".
 */

const note = (left: number, locale: "en" | "de" | "el" = "en") =>
  textOf(renderIn(createElement(AnswerLengthNote, { id: "n", state: { kind: "left", left } }), locale));

beforeEach(() => {
  announced.length = 0;
});

describe("AnswerLengthNote", () => {
  it("says nothing when a lesson opens with a long answer already there: only crossing a limit is said", () => {
    renderIn(createElement(AnswerLengthNote, { id: "a", state: answerLengthState("x".repeat(4_700)) }));
    renderIn(createElement(AnswerLengthNote, { id: "b", state: answerLengthState("x".repeat(5_001)) }));
    expect(announced).toEqual([]);
  });

  it("shows the note all the same", () => {
    expect(note(300)).toBe("300 characters left");
  });

  it("counts in the singular and the plural, in every language", () => {
    expect(note(1)).toBe("1 character left");
    expect(note(2)).toBe("2 characters left");
    expect(note(0)).toBe("0 characters left");
    expect(note(1, "de")).toBe("Noch 1 Zeichen");
    expect(note(400, "de")).toBe("Noch 400 Zeichen");
    expect(note(1, "el")).toBe("Απομένει 1 χαρακτήρας");
    expect(note(400, "el")).toBe("Απομένουν 400 χαρακτήρες");
  });
});
