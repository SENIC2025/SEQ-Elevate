import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";

// The learner store, as the view reads it: legacy fields and responses.
const store = vi.hoisted(() => ({
  over: {} as Record<string, unknown>,
  dispatched: [] as unknown[],
}));
vi.mock("@/store/demo-state", async () => {
  const { fakeCourse } = await import("../press.test-helpers");
  return {
    useDemoState: () => ({
      state: { course: fakeCourse(store.over), refusedKeys: {} },
      dispatch: (a: unknown) => store.dispatched.push(a),
    }),
  };
});
const announced = vi.hoisted(() => [] as string[]);
vi.mock("../PlayerAnnouncer", () => ({ useAnnounce: () => (t: string) => announced.push(t) }));
vi.mock("@/components/ui/button", async () => ({ Button: (await import("../press.test-helpers")).MockButton }));
// The video, as SectionView hands it over: its props are kept.
const video = vi.hoisted(() => ({ props: null as null | { onCueAnswered?: (id: string, ok: boolean) => void } }));
vi.mock("../InteractiveVideoPlayer", () => ({
  InteractiveVideoPlayer: (props: { onCueAnswered?: (id: string, ok: boolean) => void }) => {
    video.props = props;
    return null;
  },
}));

import { SectionView, answerToStore } from "./SectionView";
import { practicePart, quizPart, quizPart2, reflectionPart, scenarioPart, sectionStage, textPart } from "./test-fixtures";
import { attr, elements, renderIn, textOf } from "./render.test-helpers";
import { did, fakePage, press } from "../press.test-helpers";
import type { SectionStage } from "@/lib/cms/sections/contract";

/**
 * UA7 (D63, spec 5.3, 5.7): the sectioned view in the learner player.
 * Release 1 had it in the editor's preview only, with answers in the
 * preview's memory and a "answer this first" that named nothing.
 */

let continued = 0;
const cues: unknown[] = [];
function render(
  stage: SectionStage,
  o: { locale?: "en" | "de"; replacedPrompts?: { id: "p1" | "p2" | "p3"; label: string }[] } = {}
) {
  return renderIn(
    createElement(SectionView, {
      stage,
      stageNumber: 2,
      onContinue: () => continued++,
      onCueAnswered: (cue) => cues.push(cue),
      replacedPrompts: o.replacedPrompts,
    }),
    o.locale ?? "en"
  );
}

beforeEach(() => {
  store.over = {};
  store.dispatched.length = 0;
  announced.length = 0;
  cues.length = 0;
  continued = 0;
  const page = fakePage();
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("window", page.window);
});
afterEach(() => vi.unstubAllGlobals());

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
    // Every heading can take focus, for Continue.
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

  it("has no live region of its own: the player's one speaks (spec 5.2)", () => {
    expect(render(sectionStage)).not.toMatch(/aria-live|role="status"/);
  });

  it("always shows one enabled Continue, with what it waits for above it", () => {
    const html = render(sectionStage);
    const buttons = elements(html, "button").filter((b) => textOf(b.inner) === "Continue");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].attrs).not.toMatch(/\sdisabled=""|aria-disabled="true"/);
    // Practice, two quick checks: three items still need an answer.
    const hintId = attr(buttons[0].attrs, "aria-describedby");
    expect(html).toContain(`<p id="${hintId}" class="text-sm text-[var(--muted-foreground)] sm:text-right">3 questions above still need an answer.</p>`);
  });

  it("says what the one item left needs, in the page's language", () => {
    store.over = { responses: { "s-abcd1234/p-quizaaaa": { type: "quiz", answers: { q1: "b" }, checked: false } } };
    expect(textOf(render({ ...sectionStage, parts: [textPart, quizPart] }))).toContain(
      "Answer 1 more question, then select “Check answers”."
    );
    expect(textOf(render({ ...sectionStage, parts: [textPart, scenarioPart] }, { locale: "de" }))).toContain(
      "Wähle, was du tun würdest, um weiterzumachen."
    );
  });

  it("pressed early: names the first item and its need, focuses its heading without the browser's scroll, doesn't go on", () => {
    const html = render(sectionStage);
    const practiceHeading = attr(elements(html, "h3")[1].attrs, "id");
    press("Continue");
    expect(continued).toBe(0);
    expect(announced).toEqual(["Practice question: Choose an answer to continue."]);
    expect(did).toEqual([`focus ${practiceHeading} preventScroll`]);
  });

  it("pressed with a quick check answered but not checked: focuses its Check answers", () => {
    store.over = { responses: { "s-abcd1234/p-quizaaaa": { type: "quiz", answers: { q1: "b", q2: "a" }, checked: false } } };
    const html = render({ ...sectionStage, parts: [quizPart] });
    const check = html.match(/<button[^>]*id="([^"]+)"[^>]*>Check answers/)?.[1];
    expect(check).toBeTruthy();
    press("Continue");
    expect(announced).toEqual(["Quick check: Select “Check answers” to see how you did."]);
    expect(did).toEqual([`focus ${check} preventScroll`]);
  });

  it("goes on once every item is answered", () => {
    store.over = {
      responses: {
        "s-abcd1234/p-practc01": { type: "practice", optionId: "o2", correct: false },
      },
    };
    render({ ...sectionStage, parts: [textPart, practicePart, reflectionPart] });
    press("Continue");
    expect(continued).toBe(1);
  });

  // Release 1: answers lived in the preview's memory, gone with the tab.
  it("shows the learner's saved answers, from the store, by part key", () => {
    store.over = {
      responses: {
        "s-abcd1234/p-quizaaaa": { type: "quiz", answers: { q1: "b" }, checked: false },
        "s-abcd1234/p-practc01": { type: "practice", optionId: "o1", correct: true },
        "s-abcd1234/p-reflct01": { type: "reflection", text: { r1: "Spoke up once." } },
      },
    };
    const html = render(sectionStage);
    const sections = html.split("<section").slice(1);
    expect(sections[1]).toContain("Clear and calm.");
    expect(sections[2].match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(sections[3]).not.toContain('aria-pressed="true"');
    expect(sections[4]).toContain(">Spoke up once.</textarea>");
  });

  it("'Try another' asks again on screen only: the saved answer stays, focus goes to the heading", () => {
    store.over = { responses: { "s-abcd1234/p-practc01": { type: "practice", optionId: "o2", correct: false } } };
    const html = render({ ...sectionStage, parts: [practicePart] });
    const heading = attr(elements(html, "h3")[0].attrs, "id");
    press("Try another");
    expect(did).toEqual([`focus ${heading}`]);
    expect(store.dispatched).toEqual([]);
  });

  it("a quick check's Check answers saves its answers checked, under its own key", () => {
    store.over = { responses: { "s-abcd1234/p-quizbbbb": { type: "quiz", answers: { q1: "b", q2: "a" }, checked: false } } };
    render({ ...sectionStage, parts: [quizPart2] });
    press("Check answers");
    expect(store.dispatched).toEqual([
      { type: "answerPart", key: "s-abcd1234/p-quizbbbb", answer: { type: "quiz", answers: { q1: "b", q2: "a" }, checked: true } },
    ]);
  });

  it("saves a practice answer with whether it was the best, and a scenario with its choices' texts", () => {
    expect(answerToStore(practicePart, { type: "practice", optionId: "o1" })).toEqual([
      { type: "practice", optionId: "o1", correct: true },
      undefined,
    ]);
    expect(answerToStore(practicePart, { type: "practice", optionId: "o2" })[0]).toMatchObject({ correct: false });
    expect(answerToStore(scenarioPart, { type: "scenario", rootId: "private", followupId: "boundary" })).toEqual([
      { type: "scenario", rootId: "private", followupId: "boundary" },
      { root: "Talk to Sam later", followup: "Set a boundary" },
    ]);
  });

  it("tells editors how much content was left out, and nothing when none was (learners always get 0)", () => {
    expect(textOf(render({ ...sectionStage, skipped: 2 }))).toContain(
      "For editors: 2 pieces of content aren't shown here — only a draft so far, or not ready yet."
    );
    expect(textOf(render(sectionStage))).not.toContain("For editors");
    expect(textOf(render({ ...sectionStage, skipped: 1 }, { locale: "de" }))).toContain(
      "Für die Redaktion: Ein Inhalt wird hier nicht gezeigt"
    );
  });

  it("puts the video and documents above the lesson's title, and records an in-video answer with the lesson's id", () => {
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
    expect(html.indexOf("Checklist.pdf")).toBeGreaterThan(-1);
    expect(html.indexOf("<h2")).toBeGreaterThan(html.indexOf("Checklist.pdf"));
    video.props?.onCueAnswered?.("cue-1", true);
    expect(cues).toEqual([{ cueId: "cue-1", correct: true, lessonId: "s-abcd1234" }]);
  });

  it("shows a lesson with no content of its own (only media) without a stray region", () => {
    const html = render({ ...sectionStage, parts: [] });
    expect(html).not.toContain("<section");
    expect(textOf(html)).toContain("Continue");
  });

  it("shows the standard reflection answers its own questions replaced, read only, under 'Your earlier answers'", () => {
    const replacedPrompts = [
      { id: "p1" as const, label: "What went well?" },
      { id: "p2" as const, label: "What was hard?" },
      { id: "p3" as const, label: "What next?" },
    ];
    const stage = { ...sectionStage, key: "reflection" as const, parts: [reflectionPart] };
    store.over = { reflection: { p1: "Asked early.", p2: " ", p3: "" } };
    const html = render(stage, { replacedPrompts });
    const details = elements(html, "details")[0];
    expect(details).toBeTruthy();
    expect(textOf(details.inner)).toContain("Your earlier answers");
    expect(textOf(details.inner)).toContain("What went well?Asked early.");
    expect(textOf(details.inner)).not.toContain("What was hard?");
    expect(details.inner).not.toMatch(/<textarea|<input/);
    // Nothing written earlier: nothing to show.
    store.over = {};
    expect(render(stage, { replacedPrompts })).not.toContain("<details");
  });
});
