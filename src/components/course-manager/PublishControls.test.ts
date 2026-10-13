import { describe, it, expect, vi } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { ReadinessIssue } from "@/lib/cms/course-admin-types";
import type { CourseStatus } from "@/lib/cms/course-status";

// The action runs on the server; these tests only render.
vi.mock("@/app/actions/course", () => ({ setCourseStatus: vi.fn() }));

const { PublishControls } = await import("./PublishControls");

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone?: string;
  children?: ReactNode;
}>;

const NAMES: Record<string, string> = {
  "s-abcdefgh": "Wrap-up",
  context: "Context",
  concept: "Die Idee",
};

function render(
  readiness: ReadinessIssue[],
  status: CourseStatus = "draft",
  /** null: no names given (a built-in course). */
  lessonName: ((id: string) => string) | null = (id) => NAMES[id] ?? id
): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: en, timeZone: "UTC" },
      createElement(PublishControls, {
        slug: "asking-for-help",
        status,
        enrolled: 0,
        readiness,
        onStatusChange: () => {},
        lessonName: lessonName ?? undefined,
      })
    )
  ).replaceAll("<!-- -->", "");
}

const BLOCKERS: ReadinessIssue[] = [
  { level: "blocker", code: "needs-release-2", reason: { code: "custom-section", sectionId: "s-abcdefgh" }, stage: "s-abcdefgh" },
  { level: "blocker", code: "needs-release-2", reason: { code: "removed-section", sectionId: "concept" }, stage: "concept" },
  { level: "blocker", code: "needs-release-2", reason: { code: "reordered" } },
];

/** As React writes text into markup. */
const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;");

const publishButton = (html: string) => /<button([^>]*)>(?:(?!<\/button>).)*Publish<\/button>/.exec(html)?.[1] ?? "";

describe("PublishControls", () => {
  it("lists the blockers first, each linking to its lesson where it is on the page", () => {
    const html = render([{ level: "warning", code: "copy-missing", locale: "de" }, ...BLOCKERS]);
    const blocked = html.indexOf(esc(en.lessonList.publish.blockedTitle));
    expect(blocked).toBeGreaterThan(-1);
    expect(blocked).toBeLessThan(html.indexOf(esc(en.courseManager.page.readiness.title)));
    expect(html).toContain('<a href="#lesson-s-abcdefgh" class="underline');
    expect(html).toContain(">“Wrap-up” is a new lesson</a>");
    // A deleted lesson isn't on the page: named, not linked.
    expect(html).toContain("<span>“Die Idee” was deleted</span>");
    expect(html).toContain("<span>The lessons are in a new order</span>");
    // The warning still shows, after them.
    expect(html).toContain("No German title and subtitle yet.");
  });

  it("keeps Publish focusable but aria-disabled, described by the list", () => {
    const html = render(BLOCKERS);
    const attrs = publishButton(html);
    expect(attrs).toContain('aria-disabled="true"');
    expect(attrs).not.toContain('disabled=""');
    const list = /aria-describedby="([^"]+)"/.exec(attrs)![1];
    expect(html).toContain(`id="${list}" tabindex="-1"`);
  });

  it("publishes as before without blockers", () => {
    const html = render([{ level: "info", code: "labels-later" }]);
    expect(publishButton(html)).not.toContain("aria-disabled");
    expect(html).not.toContain(esc(en.lessonList.publish.blockedTitle));
    expect(html).toContain(esc(en.lessonList.labelsLater));
  });

  it("on a course live past the guard, says what learners don't get yet", () => {
    const html = render(BLOCKERS, "published");
    expect(html).toContain(esc(en.lessonList.publish.liveBypass));
    expect(html).not.toContain(esc(en.lessonList.publish.blockedTitle));
    expect(html).toContain(">“Wrap-up” is a new lesson</a>");
  });

  it("names the new warnings with the lesson's own name", () => {
    const html = render([
      { level: "warning", code: "part-draft", stage: "s-abcdefgh", part: "p-abcdefgh" },
      { level: "warning", code: "lesson-empty", stage: "concept" },
      { level: "warning", code: "sections-many", count: 13 },
    ]);
    expect(html).toContain(
      '<a href="#lesson-s-abcdefgh" class="underline underline-offset-2 hover:text-[var(--accent)]">“Wrap-up” has content with a draft that learners don&#x27;t see yet.</a>'
    );
    expect(html).toContain("The “Die Idee” lesson has no content yet.");
    expect(html).toContain("This course has more than 12 lessons.");
  });

  it("a built-in course is named as before (standard names)", () => {
    const html = render([{ level: "warning", code: "lesson-empty", stage: "concept" }], "draft", null);
    expect(html).toContain("The “Skill concept” lesson has no content yet.");
  });
});
