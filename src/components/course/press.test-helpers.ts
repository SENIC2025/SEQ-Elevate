/**
 * Pressing the buttons of a statically rendered screen, for the player's
 * tests (vitest runs without a DOM). Mock "@/components/ui/button" with
 * `buttonMock` before importing the screen; every Button rendered is caught
 * with its props, and `press(name)` calls its onClick. A stand-in document
 * and window record what focus and scrolling do.
 */
import { createElement, isValidElement, type ReactNode } from "react";

export type CaughtButton = {
  onClick?: () => void;
  children?: ReactNode;
  disabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
};

export const caught: CaughtButton[] = [];

/** The mock's Button: a plain <button> with the props that matter in markup, caught. */
export function MockButton(props: CaughtButton & Record<string, unknown>) {
  caught.push(props);
  const { onClick: _onClick, variant: _variant, size: _size, ...rest } = props;
  void _onClick;
  void _variant;
  void _size;
  return createElement("button", { type: "button", ...rest }, props.children);
}

/** A button's name: its text, icons left out. */
export function nameOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nameOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nameOf(node.props.children);
  return "";
}

/** Press the last button rendered named `name`. */
export function press(name: string) {
  const button = [...caught].reverse().find((b) => nameOf(b.children) === name);
  if (!button?.onClick) throw new Error(`no button "${name}"`);
  button.onClick();
}

/** What focus and scrolling did, in order. */
export const did: string[] = [];

/** A stand-in document and window: focus is recorded by element id; nothing needs scrolling. */
export function fakePage() {
  did.length = 0;
  caught.length = 0;
  const element = (id: string) => ({
    focus: (o?: FocusOptions) => did.push(`focus ${id}${o?.preventScroll ? " preventScroll" : ""}`),
    getBoundingClientRect: () => ({ top: 300, height: 30 }),
  });
  return {
    document: {
      getElementById: (id: string) => element(id),
      querySelectorAll: () => [],
      defaultView: null,
    },
    window: {
      scrollY: 0,
      innerHeight: 800,
      scrollTo: (o: ScrollToOptions) => did.push(`scrollTo ${o.top}`),
      matchMedia: () => ({ matches: false }),
    },
  };
}

/** The learner store's course progress, as DEFAULT_STATE has it, with `over` in place. */
export function fakeCourse(over: Record<string, unknown> = {}) {
  return {
    courseSlug: null,
    courseTitle: null,
    stagesCompleted: [] as string[],
    simulation: null,
    scenario: { root: null, followup: null, rootLabel: null, followupLabel: null },
    reflection: { p1: "", p2: "", p3: "" },
    assessment: { answers: {}, checked: false },
    sectionsCompleted: [] as string[],
    responses: {},
    completedAt: null,
    ...over,
  };
}
