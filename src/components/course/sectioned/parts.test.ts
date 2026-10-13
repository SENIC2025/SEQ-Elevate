import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";

// The parts answer into the player's state, never a store: a store hook
// here would throw (no provider), and this mock would be called.
const storeUsed = vi.fn();
vi.mock("@/store/demo-state", () => ({
  useDemoState: () => {
    storeUsed();
    return { state: {}, dispatch: () => {} };
  },
}));

import { PracticePart } from "./PracticePart";
import { ScenarioPart } from "./ScenarioPart";
import { QuizPart } from "./QuizPart";
import { ReflectionPart } from "./ReflectionPart";
import { RatingPart } from "./RatingPart";
import { TextPart } from "./TextPart";
import {
  emptyQuizPart,
  practicePart,
  quizPart,
  ratingPart,
  reflectionPart,
  scenarioPart,
  textPart,
} from "./test-fixtures";
import { attr, elements, renderIn, textOf } from "./render.test-helpers";

const noop = () => {};
const base = { onAnswer: noop, headingId: "h" };

describe("TextPart", () => {
  it("renders text with the learner player's renderer", () => {
    const html = renderIn(createElement(TextPart, { part: textPart }));
    expect(html).toContain("Speaking up starts small.");
  });
});

describe("PracticePart", () => {
  it("says what's needed while nothing is chosen, with no Continue of its own", () => {
    const html = renderIn(createElement(PracticePart, { ...base, part: practicePart, answer: undefined }));
    expect(textOf(html)).toContain("Choose an answer to continue.");
    expect(textOf(html)).not.toContain("Continue");
    expect(html).not.toContain("Clear and calm.");
    expect(elements(html, "button")).toHaveLength(2);
  });

  it("shows the chosen option's feedback and offers another try", () => {
    const html = renderIn(
      createElement(PracticePart, {
        ...base,
        part: practicePart,
        answer: { type: "practice", optionId: "o2" },
      })
    );
    const status = elements(html, "div").find((d) => /role="status"/.test(d.attrs));
    expect(status && textOf(status.inner)).toBe("The pattern goes on.");
    const buttons = elements(html, "button");
    expect(buttons.map((b) => textOf(b.inner))).toEqual([
      "Let me finish, please.",
      "Say nothing.",
      "Try another",
    ]);
    expect(attr(buttons[1].attrs, "aria-pressed")).toBe("true");
    expect(buttons[0].attrs).toMatch(/disabled=""/);
  });
});

describe("ScenarioPart", () => {
  it("asks the follow-up once a first choice that has one is made", () => {
    const html = renderIn(
      createElement(ScenarioPart, {
        ...base,
        part: scenarioPart,
        answer: { type: "scenario", rootId: "private" },
      })
    );
    const text = textOf(html);
    expect(text).toContain("Calm.");
    expect(text).toContain("And then?");
    expect(text).toContain("Set a boundary");
    expect(text).toContain("Answer the follow-up question to continue.");
  });

  it("starts with the first question only", () => {
    const text = textOf(
      renderIn(createElement(ScenarioPart, { ...base, part: scenarioPart, answer: undefined }))
    );
    expect(text).toContain("What do you do?");
    expect(text).not.toContain("And then?");
    expect(text).toContain("To continue, choose what you would do.");
  });
});

describe("QuizPart", () => {
  it("with no questions shows its intro and nothing to check — no NaN, no 0 of 0", () => {
    const html = renderIn(createElement(QuizPart, { ...base, part: emptyQuizPart, answer: undefined }));
    const text = textOf(html);
    expect(text).toContain("Nothing to answer yet.");
    expect(text).not.toMatch(/NaN|Check answers|out of|Try again/);
    expect(html).not.toContain("<button");
  });

  it("keeps Check answers until every question is answered", () => {
    const html = renderIn(
      createElement(QuizPart, {
        ...base,
        part: quizPart,
        answer: { type: "quiz", answers: { q1: "b" }, checked: false },
      })
    );
    const check = elements(html, "button").find((b) => textOf(b.inner) === "Check answers");
    expect(check?.attrs).toMatch(/disabled=""/);
    // Its hint is its description.
    const hintId = attr(check!.attrs, "aria-describedby");
    expect(html).toContain(`id="${hintId}"`);
    // Each question is a group named by the question.
    const groups = elements(html, "div").filter((d) => /role="group"/.test(d.attrs));
    expect(groups.length).toBeGreaterThan(0);
  });

  it("scores checked answers and offers to try again", () => {
    const html = renderIn(
      createElement(QuizPart, {
        ...base,
        part: quizPart,
        answer: { type: "quiz", answers: { q1: "b", q2: "b" }, checked: true },
      })
    );
    expect(textOf(html)).toContain("You got 1 out of 2 right.");
    expect(textOf(html)).toContain("Try again");
    expect(textOf(html)).not.toContain("Check answers");
  });
});

describe("ReflectionPart", () => {
  it("labels every box with its question, any number of them", () => {
    const part = {
      ...reflectionPart,
      prompts: [
        ...reflectionPart.prompts,
        { id: "r3", label: "Who could help?", placeholder: "" },
        { id: "r4", label: "When will you try?", placeholder: "" },
      ],
    };
    const html = renderIn(
      createElement(ReflectionPart, {
        ...base,
        part,
        answer: { type: "reflection", text: { r2: "Ask earlier" } },
      })
    );
    const labels = elements(html, "label");
    const boxes = [...html.matchAll(/<textarea([^>]*)>([^<]*)<\/textarea>/g)];
    expect(labels.map((l) => textOf(l.inner))).toEqual([
      "What went well?",
      "What would you change?",
      "Who could help?",
      "When will you try?",
    ]);
    expect(boxes).toHaveLength(4);
    labels.forEach((l, i) => expect(attr(l.attrs, "for")).toBe(attr(boxes[i][1], "id")));
    expect(boxes[1][2]).toBe("Ask earlier");
    expect(textOf(html)).toContain("Think about last week.");
  });
});

describe("RatingPart", () => {
  const html = renderIn(
    createElement(RatingPart, {
      ...base,
      part: ratingPart,
      answer: { type: "rating", values: { s2: 4 } },
    })
  );
  const fieldsets = elements(html, "fieldset");

  it("is one fieldset per statement, its legend the statement", () => {
    expect(fieldsets.map((f) => textOf(elements(f.inner, "legend")[0].inner))).toEqual([
      "I say when I disagree.",
      "I ask for time to finish.",
      "I name what I need.",
    ]);
  });

  it("has five native radios per statement, named n of 5, one group per statement", () => {
    const names = new Set<string>();
    for (const f of fieldsets) {
      const radios = [...f.inner.matchAll(/<input([^>]*)\/?>/g)].map((m) => m[1]);
      expect(radios).toHaveLength(5);
      expect(radios.every((r) => attr(r, "type") === "radio")).toBe(true);
      expect(radios.map((r) => attr(r, "aria-label"))).toEqual([
        "1 of 5",
        "2 of 5",
        "3 of 5",
        "4 of 5",
        "5 of 5",
      ]);
      const groupNames = new Set(radios.map((r) => attr(r, "name")));
      expect(groupNames.size).toBe(1);
      names.add([...groupNames][0]!);
    }
    expect(names.size).toBe(3);
  });

  it("shows what the ends mean once, as every statement's description", () => {
    const scale = /<p id="([^"]+)"[^>]*>([^<]*)<\/p>/.exec(html);
    expect(scale?.[2]).toBe("1 = Not at all like me · 5 = Very much like me");
    for (const f of fieldsets) expect(attr(f.attrs, "aria-describedby")).toBe(scale?.[1]);
  });

  it("shows the editor's rating as chosen", () => {
    const second = [...fieldsets[1].inner.matchAll(/<input([^>]*)\/?>/g)].map((m) => m[1]);
    expect(second.map((r) => /checked=""/.test(r))).toEqual([false, false, false, true, false]);
  });

  it("gives targets of at least 24 px that wrap on a narrow screen", () => {
    expect(html).toContain("h-6 w-6");
    expect(html).toContain("min-h-11 min-w-11");
    expect(fieldsets[0].inner).toContain("flex flex-wrap");
  });

  it("names the radios in the page's language", () => {
    const de = renderIn(createElement(RatingPart, { ...base, part: ratingPart, answer: undefined }), "de");
    expect(de).toContain('aria-label="3 von 5"');
    const el = renderIn(createElement(RatingPart, { ...base, part: ratingPart, answer: undefined }), "el");
    expect(el).toContain('aria-label="3 από 5"');
  });
});

describe("no store", () => {
  it("no part reads or writes the learner store", () => {
    expect(storeUsed).not.toHaveBeenCalled();
  });
});
