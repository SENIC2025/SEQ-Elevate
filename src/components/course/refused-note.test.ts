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
import { RefusedNote } from "./refused-note";
import { renderIn, textOf } from "./sectioned/render.test-helpers";

/** D62.d: an answer refused per key is kept on screen, "and the learner is told". */

const note = (props: Parameters<typeof RefusedNote>[0], locale: "en" | "de" | "el" = "en") =>
  textOf(renderIn(createElement(RefusedNote, props), locale));

beforeEach(() => {
  announced.length = 0;
});

describe("RefusedNote", () => {
  it("says the answer wasn't saved, whatever the server's reason, in every language", () => {
    const en = "This answer couldn't be saved. You can carry on, but it won't be there after a reload or on another device.";
    expect(note({ reason: "row-full" })).toBe(en);
    expect(note({ reason: "invalid" })).toBe(en);
    expect(note({ reason: "too-long" })).toBe(en);
    expect(note({ reason: "invalid" }, "de")).toMatch(/^Diese Antwort konnte nicht gespeichert werden\./);
    expect(note({ reason: "invalid" }, "el")).toMatch(/^Αυτή η απάντηση δεν μπόρεσε να αποθηκευτεί\./);
  });

  it("says nothing without a refusal, nor for a reflection held back as too long (its box says so)", () => {
    expect(note({ reason: undefined })).toBe("");
    expect(note({ reason: "too-long", reflection: true })).toBe("");
    expect(note({ reason: "row-full", reflection: true })).not.toBe("");
  });

  it("isn't announced when the item opens with it already there: it is read in place", () => {
    note({ reason: "row-full" });
    expect(announced).toEqual([]);
  });
});
