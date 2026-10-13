import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";

// Only the completion screen (the learner player's own) may use the store:
// the in-memory one the route wraps the preview in.
const storeUsed = vi.fn();
vi.mock("@/store/demo-state", () => ({
  useDemoState: () => {
    storeUsed();
    return {
      state: { course: { courseSlug: null, completedAt: null }, badges: [] },
      dispatch: () => {},
    };
  },
}));
// Links render as the app's would: the given locale, else the page's.
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: ({ href, locale, ...rest }: { href: string; locale?: string }) =>
      h("a", { href: `/${locale ?? "en"}${href}`, ...rest }),
  };
});

import type { SectionedCourseContent, SectionStage } from "@/lib/cms/sections/contract";
import { SectionedPreviewPlayer } from "./SectionedPreviewPlayer";
import { quizPart, ratingPart, textPart } from "./test-fixtures";
import { attr, elements, renderIn, textOf } from "./render.test-helpers";

const stage = (
  key: SectionStage["key"],
  label: string,
  parts: SectionStage["parts"] = [textPart]
): SectionStage => ({
  key,
  label,
  title: label,
  parts,
  skipped: 0,
});

const course: SectionedCourseContent = {
  sectioned: true,
  slug: "speak-up",
  locale: "en",
  cluster: "communication",
  title: "Speak up",
  clusterLabel: "Communication",
  tagline: "",
  durationMinutes: 20,
  badge: { slug: "speak-up", name: "Clear voice", meaning: "Says what matters" },
  completion: { title: "Course complete", body: "Well done." },
  // As the loader hands it over: the lesson list's order, hidden ones gone.
  stages: [
    stage("s-abcd1234", "Warm-up"),
    stage("concept", "The idea", [textPart, quizPart, ratingPart]),
    stage("scenario", "Try it"),
  ],
};

type Props = Parameters<typeof SectionedPreviewPlayer>[0];
const render = (props: Partial<Props> = {}, locale: "en" | "de" = "en") =>
  renderIn(
    createElement(SectionedPreviewPlayer, { course, draftPreview: true, canEdit: true, ...props }),
    locale
  );

const stepNames = (html: string) =>
  elements(html.slice(html.indexOf('aria-label="Course stages"')), "button")
    .slice(0, course.stages.length)
    .map((b) => ({ name: textOf(b.inner), current: attr(b.attrs, "aria-current") === "step" }));

describe("SectionedPreviewPlayer", () => {
  it("says it's a draft preview, and that learners get this layout from Release 2", () => {
    const text = textOf(render());
    expect(text).toContain("Draft preview.");
    expect(text).toContain(
      "This preview shows the new layout. Learners get it from Release 2, so the course can't be published yet."
    );
  });

  it("lists the course's own lessons in its order, by their step names, starting at the first", () => {
    expect(stepNames(render())).toEqual([
      { name: "1Warm-up", current: true },
      { name: "2The idea", current: false },
      { name: "3Try it", current: false },
    ]);
  });

  it("opens at the lesson asked for, with every step reachable", () => {
    const html = render({ initialSection: "concept" });
    expect(stepNames(html).find((s) => s.current)?.name).toBe("2The idea");
    const nav = html.slice(html.indexOf('aria-label="Course stages"'), html.indexOf("</nav>"));
    expect(nav).not.toMatch(/\sdisabled=""/);
    expect(textOf(html)).toContain("2 / 3 · The idea");
    // Back is named by the lesson it goes to.
    const back = elements(html, "button").find((b) => textOf(b.inner) === "Warm-up");
    expect(back?.attrs).not.toMatch(/\sdisabled=""/);
  });

  it("ignores a lesson it hasn't got", () => {
    const html = render({ initialSection: "context" });
    expect(stepNames(html)[0].current).toBe(true);
    expect(textOf(html)).toContain("1 / 3 · Warm-up");
  });

  it("links Edit this lesson and Back to editing to the lesson on the course page", () => {
    const html = render({ initialSection: "s-abcd1234" });
    const links = elements(html, "a").map((a) => ({ text: textOf(a.inner), href: attr(a.attrs, "href") }));
    const href = "/en/content/courses/speak-up?lesson=s-abcd1234&amp;lang=en";
    expect(links).toContainEqual({ text: "Edit this lesson", href });
    expect(links).toContainEqual({ text: "Back to editing", href });
  });

  it("links back in the editor's own menu language", () => {
    const html = render({ initialSection: "concept", editLocale: "de" });
    expect(html).toContain('href="/de/content/courses/speak-up?lesson=concept&amp;lang=en"');
  });

  it("has no edit links for a viewer who can't edit", () => {
    expect(textOf(render({ canEdit: false }))).not.toMatch(/Edit this lesson|Back to editing/);
  });

  it("names things in the page's language", () => {
    const html = render({}, "de");
    expect(textOf(html)).toContain("Diese Vorschau zeigt den neuen Aufbau.");
    expect(textOf(html)).toContain("Diese Lektion bearbeiten");
    expect(html).toContain('aria-label="Kursschritte"');
  });

  it("plays the current lesson's content and never the learner store", () => {
    storeUsed.mockClear();
    const html = render({ initialSection: "concept" });
    expect(elements(html, "h2").map((h) => textOf(h.inner))).toEqual(["The idea"]);
    expect(html.match(/<fieldset/g)).toHaveLength(3);
    expect(storeUsed).not.toHaveBeenCalled();
  });

  it("goes straight to the completion screen when no lesson has anything to show", () => {
    storeUsed.mockClear();
    const html = render({ course: { ...course, stages: [] } });
    expect(textOf(html)).toContain("Course complete");
    expect(textOf(html)).toContain("Clear voice");
    expect(html).not.toContain('aria-label="Course stages"');
    expect(html).not.toContain("NaN");
  });
});
