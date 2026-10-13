import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * A button that goes away when pressed ("Try another", "Try different
 * choices", "Check answers", "Try again") first moves focus to its part's
 * heading, which stays, so focus never drops to the page (WCAG 2.4.3). The
 * buttons are caught as they render, then pressed with a stand-in document.
 */
type ButtonProps = { onClick?: () => void; children?: ReactNode; disabled?: boolean };
const rendered: ButtonProps[] = [];
vi.mock("@/components/ui/button", () => ({
  Button: (props: ButtonProps) => {
    rendered.push(props);
    return createElement("button", { type: "button", disabled: props.disabled }, props.children);
  },
}));

import { PracticePart } from "./PracticePart";
import { ScenarioPart } from "./ScenarioPart";
import { QuizPart } from "./QuizPart";
import { practicePart, quizPart, scenarioPart } from "./test-fixtures";
import { renderIn } from "./render.test-helpers";
import { focusThen } from "./focus";

const HEADING = "part-heading";
/** What happened, in order: focus moves and answers. */
const log: string[] = [];

beforeEach(() => {
  log.length = 0;
  rendered.length = 0;
  vi.stubGlobal("document", {
    getElementById: (id: string) => ({ focus: () => log.push(`focus ${id}`) }),
  });
});
afterEach(() => vi.unstubAllGlobals());

function label(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(label).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return label(node.props.children);
  return "";
}

/** Render, then press the button named `name`. */
function press(element: ReactElement, name: string) {
  renderIn(element);
  const button = rendered.find((p) => label(p.children) === name);
  if (!button?.onClick) throw new Error(`no button "${name}"`);
  button.onClick();
}

const props = (part: unknown, answer: unknown) =>
  ({ part, answer, headingId: HEADING, onAnswer: () => log.push("answer") }) as never;

describe("focusThen", () => {
  it("focuses the element first, then acts", () => {
    focusThen("x", () => log.push("act"));
    expect(log).toEqual(["focus x", "act"]);
  });

  it("still acts when the element is gone", () => {
    vi.stubGlobal("document", { getElementById: () => null });
    focusThen("x", () => log.push("act"));
    expect(log).toEqual(["act"]);
  });
});

describe("a pressed button that goes away leaves focus on its part's heading", () => {
  const cases: [string, () => ReactElement][] = [
    ["Try another", () => createElement(PracticePart, props(practicePart, { type: "practice", optionId: "o2" }))],
    [
      "Try different choices",
      () => createElement(ScenarioPart, props(scenarioPart, { type: "scenario", rootId: "private" })),
    ],
    [
      "Check answers",
      () =>
        createElement(QuizPart, props(quizPart, { type: "quiz", answers: { q1: "b", q2: "a" }, checked: false })),
    ],
    [
      "Try again",
      () =>
        createElement(QuizPart, props(quizPart, { type: "quiz", answers: { q1: "b", q2: "a" }, checked: true })),
    ],
  ];

  for (const [name, element] of cases) {
    it(`${name}: the heading takes focus before the answer changes`, () => {
      press(element(), name);
      expect(log).toEqual([`focus ${HEADING}`, "answer"]);
    });
  }
});
