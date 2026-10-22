import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import en from "@/messages/en.json";
import de from "@/messages/de.json";

/*
 * Release 4 spec 5.4 (D109): the completion screen links to the course's
 * references and bibliography, in the same tab (no ?from=lesson, so the
 * page offers "Back to the course"), and only when the course has a list:
 * a course without one shows exactly what it showed before. In an editor's
 * preview the link keeps the preview (?preview=1).
 */

vi.mock("@/store/demo-state", () => ({
  useDemoState: () => ({
    state: { course: { courseSlug: "speak-up", completedAt: "2026-11-26T09:00:00Z" }, badges: ["speak-up-complete"] },
    dispatch: () => {},
  }),
}));
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: ({ href, locale, ...rest }: { href: string; locale?: string }) => h("a", { href: `/${locale ?? "en"}${href}`, ...rest }),
  };
});

const { CompletionStage } = await import("./CompletionStage");
const { renderIn, elements, attr, textOf } = await import("./sectioned/render.test-helpers");

const course = {
  slug: "speak-up",
  locale: "en",
  cluster: "communication",
  title: "Speak up",
  clusterLabel: "Communication",
  tagline: "",
  durationMinutes: 20,
  badge: { slug: "speak-up-complete", name: "Clear voice", meaning: "Says what matters" },
  completion: { title: "Course complete", body: "Well done." },
  stages: [],
} as unknown as Parameters<typeof CompletionStage>[0]["course"];

const links = (html: string) => elements(html, "a").map((a) => ({ href: attr(a.attrs, "href"), text: textOf(a.inner), attrs: a.attrs }));

describe("CompletionStage's link to the references", () => {
  it("is there when the course has a list: same tab, back to the course from there", () => {
    const html = renderIn(createElement(CompletionStage, { course, hasReferences: true }));
    const refs = links(html).find((l) => l.href === "/en/learner/course/speak-up/references");
    expect(refs, "the link to the references").toBeDefined();
    expect(refs!.text).toBe(en.courseReferences.title);
    expect(refs!.attrs).not.toContain("target=");
    // The other ways on stay where they were.
    expect(links(html).map((l) => l.href)).toEqual([
      "/en/learner/comp-card",
      "/en/learner/course/speak-up/references",
      "/en/learner",
    ]);
  });

  it("is one link that looks like a button, with no button inside it: one Tab stop, one name", () => {
    const html = renderIn(createElement(CompletionStage, { course, hasReferences: true }));
    const refs = elements(html, "a").find((a) => attr(a.attrs, "href") === "/en/learner/course/speak-up/references");
    expect(refs, "the link to the references").toBeDefined();
    expect(refs!.inner).not.toMatch(/<button/);
    expect(attr(refs!.attrs, "class")).toMatch(/\binline-flex\b.*\brounded-lg\b/);
  });

  it("keeps an editor's preview", () => {
    const html = renderIn(createElement(CompletionStage, { course, hasReferences: true, preview: true }));
    expect(links(html).map((l) => l.href)).toContain("/en/learner/course/speak-up/references?preview=1");
  });

  it("speaks the page's language", () => {
    const html = renderIn(createElement(CompletionStage, { course, hasReferences: true }), "de");
    expect(links(html).find((l) => l.href?.endsWith("/references"))?.text).toBe(de.courseReferences.title);
  });

  it("isn't there without a list: the screen is as it was", () => {
    const before = renderIn(createElement(CompletionStage, { course }));
    expect(before).not.toContain("/references");
    expect(renderIn(createElement(CompletionStage, { course, hasReferences: false }))).toBe(before);
    expect(links(before).map((l) => l.href)).toEqual(["/en/learner/comp-card", "/en/learner"]);
  });
});
