import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";

// The learner store, as the player reads it.
const store = vi.hoisted(() => ({
  over: {} as Record<string, unknown>,
  dispatched: [] as unknown[],
  stale: false,
}));
vi.mock("@/store/demo-state", async () => {
  const { fakeCourse } = await import("./press.test-helpers");
  return {
    useDemoState: () => ({
      state: { course: fakeCourse(store.over), refusedKeys: {}, badges: [] },
      dispatch: (a: unknown) => store.dispatched.push(a),
    }),
    useCourseReady: () => false,
    useStaleBuild: () => store.stale,
  };
});
const announced = vi.hoisted(() => [] as string[]);
vi.mock("./PlayerAnnouncer", () => ({
  PlayerAnnouncer: ({ children }: { children: unknown }) => children,
  useAnnounce: () => (t: string) => announced.push(t),
}));
vi.mock("@/components/ui/button", async () => ({ Button: (await import("./press.test-helpers")).MockButton }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "unauthenticated", data: null }) }));
vi.mock("@/app/actions/video", () => ({ recordVideoCueAnswer: vi.fn() }));
vi.mock("@/app/actions/telemetry", () => ({ recordCourseOpened: vi.fn(), recordStageTime: vi.fn() }));
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: ({ href, locale, ...rest }: { href: string; locale?: string }) =>
      h("a", { href: `/${locale ?? "en"}${href}`, ...rest }),
  };
});

import { CoursePlayer, type CoursePlayerProps } from "./CoursePlayer";
import { afterContinue, backFrom } from "./player-nav";
import type { LearnerCourse } from "@/lib/cms/learner-course";
import type { SectionId } from "@/lib/cms/sections/contract";
import { quizPart, sectionStage, textPart } from "./sectioned/test-fixtures";
import { attr, elements, renderIn, textOf } from "./sectioned/render.test-helpers";
import { fakePage, press } from "./press.test-helpers";

/**
 * UA6 (D63, spec 5.2): the one player. Release 1 walked STAGES.filter of
 * the course's stages — the standard lessons only, under their standard
 * names — and fell back to the completion screen for anything else, a
 * course with no lessons included (completing it, badge and all).
 */

const course: LearnerCourse = {
  slug: "speak-up",
  locale: "en",
  cluster: "communication",
  title: "Speak up",
  clusterLabel: "Communication",
  tagline: "",
  durationMinutes: 20,
  badge: { slug: "speak-up-complete", name: "Clear voice", meaning: "Says what matters" },
  completion: { title: "Course complete", body: "Well done." },
  lessons: [
    { kind: "section", id: "s-abcd1234", label: "Warm-up", section: { ...sectionStage, parts: [textPart] } },
    {
      kind: "stage",
      id: "concept",
      label: "The idea",
      stage: { key: "concept", title: "Why it matters", blocks: [{ kind: "paragraph", text: "Speak early." }] },
    },
    {
      kind: "section",
      id: "assessment",
      label: "Check",
      section: { key: "assessment", label: "Check", title: "Check yourself", parts: [quizPart], skipped: 0 },
    },
  ],
  unseen: ["context"],
};

function render(props: Partial<CoursePlayerProps> = {}, locale: "en" | "de" | "el" = "en") {
  return renderIn(createElement(CoursePlayer, { course, ...props }), locale);
}

/** The step bar's buttons: name (as read: number and name, or the done name) and state. */
function steps(html: string) {
  const nav = html.slice(html.indexOf('aria-label="Course stages"'), html.indexOf("</nav>"));
  return elements(nav, "button").map((b) => ({
    name: textOf(b.inner.replace(/<span aria-hidden="true"[^>]*>[^<]*<\/span>/g, "")),
    disabled: /\sdisabled=""/.test(b.attrs),
    current: attr(b.attrs, "aria-current") === "step",
  }));
}

beforeEach(() => {
  store.over = {};
  store.dispatched.length = 0;
  store.stale = false;
  announced.length = 0;
  const page = fakePage();
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("window", page.window);
});
afterEach(() => vi.unstubAllGlobals());

describe("CoursePlayer", () => {
  it("lists the course's lessons in its order, by their step names", () => {
    expect(steps(render()).map((s) => s.name)).toEqual(["1Warm-up", "2The idea", "3Check"]);
  });

  it("draws a lesson of the course's own by the sectioned view", () => {
    const html = render();
    expect(elements(html, "h2").map((h) => textOf(h.inner))).toEqual(["Warm-up"]);
    expect(html).toContain("<section");
  });

  it("draws a standard lesson with only its main content by its stage screen", () => {
    const html = render({ preview: true, initialLesson: "concept" });
    expect(elements(html, "h2").map((h) => textOf(h.inner))).toEqual(["Why it matters"]);
    expect(html).not.toContain("<section");
    expect(textOf(html)).toContain("Speak early.");
  });

  it("names the counter and Back by the step names, and shows the counter on phones too", () => {
    const html = render({ preview: true, initialLesson: "concept" });
    expect(textOf(html)).toContain("2 / 3 · The idea");
    expect(html).toContain('<p class="text-xs text-[var(--muted-foreground)]">2 / 3 · The idea</p>');
    // Back, named by the lesson it goes to.
    const back = elements(html, "button").filter((b) => textOf(b.inner) === "Warm-up");
    expect(back).toHaveLength(1);
    expect(back[0].attrs).not.toMatch(/\sdisabled=""/);
  });

  it("opens a signed-in learner where the server says, done steps said to be done", () => {
    store.over = { courseSlug: "speak-up", stagesCompleted: ["concept"], sectionsCompleted: ["s-abcd1234"] };
    const html = render({ serverResume: "assessment" });
    expect(steps(html)).toEqual([
      { name: "Warm-up, done", disabled: false, current: false },
      { name: "The idea, done", disabled: false, current: false },
      { name: "3Check", disabled: false, current: true },
    ]);
  });

  it("until the learner's progress has loaded, counts what the server said: lessons before its position are done", () => {
    // The store doesn't hold the course yet; the quick check is answered on this page.
    store.over = {
      courseSlug: null,
      responses: { "assessment/p-quizaaaa": { type: "quiz", answers: { q1: "b", q2: "a" }, checked: true } },
    };
    const html = render({ serverResume: "assessment" });
    expect(steps(html).map((s) => s.name)).toEqual(["Warm-up, done", "The idea, done", "3Check"]);
    // The last Continue goes on to the end, not back to a lesson the server has as done.
    press("Continue");
    expect(announced).toEqual([]);
  });

  it("reaches no further than the first lesson not done, even a done one an editor moved past it (Q4)", () => {
    store.over = { courseSlug: "speak-up", sectionsCompleted: ["s-abcd1234"], stagesCompleted: ["assessment"] };
    const got = steps(render({ serverResume: "concept" }));
    expect(got.map((s) => s.disabled)).toEqual([false, false, true]);
    expect(got[2].name).toBe("Check, done");
  });

  it("counts only this course's progress: another course's in the store doesn't tick anything", () => {
    store.over = { courseSlug: "other-course", sectionsCompleted: ["s-abcd1234"] };
    expect(steps(render()).map((s) => s.name)).toEqual(["1Warm-up", "2The idea", "3Check"]);
  });

  it("opens a completed course on its completion screen", () => {
    // The completion screen's animation library wants a real window.
    vi.unstubAllGlobals();
    store.over = { courseSlug: "speak-up", completedAt: "2026-11-10T09:00:00.000Z" };
    const html = render({ serverResume: "complete" });
    expect(textOf(html)).toContain("Course complete");
    expect(steps(html).every((s) => s.name.endsWith(", done"))).toBe(true);
  });

  it("shows a course with no lessons as such: no completion screen, no badge", () => {
    const html = render({ course: { ...course, lessons: [] }, serverResume: "complete" });
    expect(textOf(html)).toContain("This course has no lessons yet.");
    expect(textOf(html)).not.toContain("Course complete");
    expect(textOf(html)).not.toContain("Clear voice");
    expect(html).not.toContain('aria-label="Course stages"');
    expect(html).not.toContain("NaN");
  });

  it("never draws the completion screen for a lesson of a kind it doesn't know", () => {
    const odd = {
      ...course,
      lessons: [{ kind: "stage", id: "concept", label: "Odd", stage: { key: "nonsense", title: "?" } }],
    } as unknown as LearnerCourse;
    const html = render({ course: odd });
    expect(textOf(html)).not.toContain("Course complete");
    expect(store.dispatched.some((a) => (a as { type: string }).type === "completeCourse")).toBe(false);
  });

  it("after the last lesson, says which lesson is still to do", () => {
    store.over = { courseSlug: "speak-up", sectionsCompleted: ["s-abcd1234"] };
    // The quick check, answered and checked, on its own: the idea isn't done.
    store.over.responses = { "assessment/p-quizaaaa": { type: "quiz", answers: { q1: "b", q2: "a" }, checked: true } };
    render({ preview: true, initialLesson: "assessment" });
    press("Continue");
    expect(store.dispatched).toContainEqual({ type: "completeLesson", id: "assessment" });
    expect(announced).toEqual(["Before you finish: “The idea” is still to do."]);
  });

  // Review finding 2 on Stream A: a lesson only moved before done ones was
  // said to have been "added after you started" (spec 7.4: they carry on
  // from the first lesson they haven't done).
  it("says a lesson not done before done ones is still to do, never that it was added", () => {
    store.over = { courseSlug: "speak-up", stagesCompleted: ["concept"] };
    const text = textOf(render({ serverResume: "s-abcd1234" }));
    expect(text).toContain("You haven't done this lesson yet. It's new, or it has moved.");
    expect(text).not.toMatch(/added after you started/);
    // Not for the next lesson in order, nor in a preview.
    store.over = { courseSlug: "speak-up", sectionsCompleted: ["s-abcd1234"] };
    expect(textOf(render({ serverResume: "concept" }))).not.toContain("You haven't done this lesson yet");
    store.over = { courseSlug: "speak-up", stagesCompleted: ["concept"] };
    expect(textOf(render({ preview: true }))).not.toContain("You haven't done this lesson yet");
  });

  // Review finding 6 on Stream A (WCAG 3.1.2).
  it("marks a step name in another language than the page's, in the bar, Back and the counter", () => {
    const greek: LearnerCourse = {
      ...course,
      locale: "el",
      lessons: course.lessons.map((l) => (l.id === "assessment" ? l : { ...l, lang: "en" as const })),
    };
    const html = render({ course: greek, preview: true, initialLesson: "concept" }, "el");
    expect(html).toContain('<span class="sr-only sm:not-sr-only" lang="en">Warm-up</span>');
    expect(html).toContain('<span class="sr-only sm:not-sr-only" lang="en">The idea</span>');
    expect(html).toContain('<span class="sr-only sm:not-sr-only">Check</span>');
    // Back goes to "Warm-up"; the counter names "The idea".
    expect(html).toMatch(/<button[^>]*>.*<span lang="en">Warm-up<\/span><\/button>/);
    expect(html).toContain('<p class="text-xs text-[var(--muted-foreground)]">2 / 3 · <span lang="en">The idea</span></p>');
    // A name in the page's language keeps its markup.
    const plain = render({ preview: true, initialLesson: "concept" });
    expect(plain).toContain('<p class="text-xs text-[var(--muted-foreground)]">2 / 3 · The idea</p>');
    expect(plain).not.toContain(' lang="');
  });

  it("has no Release 2 banner in a preview, and the stale-build alert when saves can't get through", () => {
    const preview = textOf(render({ preview: true, canEdit: true, draftPreview: true }));
    expect(preview).toContain("Draft preview.");
    expect(preview).not.toMatch(/Release 2|new layout/);
    expect(render()).not.toContain('role="alert"');
    store.stale = true;
    const html = render();
    expect(html).toMatch(/<div role="alert"[^>]*><p[^>]*>A new version is available\. Reload the page to keep saving your answers\.<\/p><button[^>]*>.*Reload<\/button><\/div>/);
  });
});

describe("afterContinue and backFrom", () => {
  const ids: SectionId[] = ["s-abcd1234", "concept", "assessment"];

  it("goes to the next lesson in order", () => {
    expect(afterContinue(ids, new Set(), "s-abcd1234", false)).toEqual({ to: "concept" });
  });

  it("after the last lesson goes to the first still to do, saying so; else to the completion", () => {
    expect(afterContinue(ids, new Set(["s-abcd1234"]), "assessment", false)).toEqual({
      to: "concept",
      stillToDo: "concept",
    });
    expect(afterContinue(ids, new Set(["s-abcd1234", "concept"]), "assessment", false)).toEqual({ to: "complete" });
  });

  it("ends a course already completed on its completion screen, a lesson added since or not (D50)", () => {
    expect(afterContinue(ids, new Set(["s-abcd1234"]), "assessment", true)).toEqual({ to: "complete" });
  });

  it("Back: the previous lesson, the last one from the completion screen, none at the first", () => {
    expect(backFrom(ids, "concept")).toBe("s-abcd1234");
    expect(backFrom(ids, "complete")).toBe("assessment");
    expect(backFrom(ids, "s-abcd1234")).toBeNull();
    expect(backFrom([], "empty")).toBeNull();
  });
});
