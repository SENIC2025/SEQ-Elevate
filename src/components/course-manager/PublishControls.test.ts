import { describe, it, expect, vi } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import el from "@/messages/el.json";
import type { ReadinessIssue } from "@/lib/cms/course-admin-types";
import type { CourseStatus } from "@/lib/cms/course-status";

// The action runs on the server; these tests only render.
vi.mock("@/app/actions/course", () => ({ setCourseStatus: vi.fn(), setCourseLanguageReady: vi.fn() }));

const { PublishControls, LanguagePanel } = await import("./PublishControls");

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
  lessonName: ((id: string) => string) | null = (id) => NAMES[id] ?? id,
  extra: { nameLang?: "en" | "de" | "el"; usualOrder?: string[] } = { usualOrder: ["Context", "Die Idee"] }
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
        ...extra,
      })
    )
  ).replaceAll("<!-- -->", "");
}

/** Release 2's blockers (D66): a lesson whose content can't be read, and no lesson learners see. */
const BLOCKERS: ReadinessIssue[] = [
  { level: "blocker", code: "cannot-publish", blocker: { code: "unreadable", sectionId: "s-abcdefgh" }, stage: "s-abcdefgh" },
  { level: "blocker", code: "cannot-publish", blocker: { code: "no-lessons" } },
];

/** Release 1's, back only under a kill switch (spec 3.4). */
const RELEASE_1: ReadinessIssue[] = [
  { level: "blocker", code: "needs-release-2", reason: { code: "custom-section", sectionId: "s-abcdefgh" }, stage: "s-abcdefgh" },
  { level: "blocker", code: "needs-release-2", reason: { code: "removed-section", sectionId: "concept" }, stage: "concept" },
  { level: "blocker", code: "needs-release-2", reason: { code: "reordered" } },
];

/** As React writes text into markup. */
const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;");

const publishButton = (html: string) => /<button([^>]*)>(?:(?!<\/button>).)*Publish<\/button>/.exec(html)?.[1] ?? "";

describe("PublishControls", () => {
  it("lists the blockers first, each linking to its lesson where there is one (D66)", () => {
    const html = render([{ level: "warning", code: "copy-missing", locale: "de" }, ...BLOCKERS]);
    const blocked = html.indexOf(esc(en.lessonList.publish.blockedTitle));
    expect(blocked).toBeGreaterThan(-1);
    expect(blocked).toBeLessThan(html.indexOf(esc(en.courseManager.page.readiness.title)));
    expect(html).toContain(esc(en.lessonList.publish.blockedIntro));
    expect(html).toContain('<a href="#lesson-s-abcdefgh" class="underline');
    expect(html).toContain(">“Wrap-up” has content that can&#x27;t be read</a>");
    expect(html).toContain("<span>No lesson has anything learners can see yet</span>");
    // The warning still shows, after them.
    expect(html).toContain("No German title and subtitle yet.");
    expect(html).not.toContain("Release 2");
  });

  it("under a kill switch, lists Release 1's reasons the same way, saying the usual order", () => {
    const html = render(RELEASE_1);
    expect(html).toContain(">“Wrap-up” is a new lesson</a>");
    // A deleted lesson isn't on the page: named, not linked.
    expect(html).toContain("<span>“Die Idee” was deleted</span>");
    expect(html).toContain("<span>The lessons are in a new order. Usually: Context, Die Idee</span>");
    expect(publishButton(html)).toContain('aria-disabled="true"');
  });

  it("says the usual order, and marks lesson names with the content language", () => {
    const html = render(RELEASE_1, "draft", (id) => NAMES[id] ?? id, {
      nameLang: "de",
      usualOrder: ["Context", "Die Idee", "Reflexion"],
    });
    expect(html).toContain(
      '<span>The lessons are in a new order. Usually: <span lang="de">Context, Die Idee, Reflexion</span></span>'
    );
    expect(html).toContain('>“<span lang="de">Wrap-up</span>” is a new lesson</a>');
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
    const html = render([{ level: "info", code: "no-interactive" }]);
    expect(publishButton(html)).not.toContain("aria-disabled");
    expect(html).not.toContain(esc(en.lessonList.publish.blockedTitle));
  });

  it("on a live course, says nothing about blockers (Release 1 listed what learners didn't get)", () => {
    const html = render(BLOCKERS, "published");
    expect(html).not.toContain(esc(en.lessonList.publish.blockedTitle));
    expect(html).not.toContain("has content that can");
    expect(html).not.toContain("Release 2");
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
    expect(html).toContain("Learners would see more than 12 lessons in this course.");
  });

  it("marks the lesson names in the warnings with the content language", () => {
    const html = render(
      [
        { level: "warning", code: "lesson-empty", stage: "concept" },
        { level: "warning", code: "part-draft", stage: "concept", part: "p-abcdefgh" },
      ],
      "draft",
      undefined,
      { nameLang: "de" }
    );
    expect(html).toContain('The “<span lang="de">Die Idee</span>” lesson has no content yet.');
    expect(html).toContain('“<span lang="de">Die Idee</span>” has content with a draft');
  });

  it("a built-in course is named as before (standard names)", () => {
    const html = render([{ level: "warning", code: "lesson-empty", stage: "concept" }], "draft", null);
    expect(html).toContain("The “Skill concept” lesson has no content yet.");
  });
});

/*
 * Release 3 (D90, spec 9.4): English is the source language — a created
 * course whose English is incomplete is blocked until its first publish —
 * and German and Greek are switched on for learners on the course page.
 */
describe("PublishControls: English first", () => {
  it("lists English missing as a blocker before the first publish, and keeps Publish described by it", () => {
    const html = render([{ level: "blocker", code: "english-incomplete" }, { level: "warning", code: "copy-missing", locale: "en" }]);
    expect(html).toContain(esc(en.lessonList.publish.blockedTitle));
    expect(html).toContain(`<span>${esc(en.courseManager.languageReady.englishRequired)}</span>`);
    expect(publishButton(html)).toContain('aria-disabled="true"');
    expect(html).toContain("No English title and subtitle yet.");
  });

  it("names the language issues of the list in words", () => {
    const html = render([
      { level: "warning", code: "language-live-incomplete", locale: "de" },
      { level: "info", code: "language-not-live", locale: "el" },
    ]);
    expect(html).toContain(esc("German is live, but some text is missing in it now"));
    expect(html).toContain("Learners using Greek get English until Greek is switched on.");
  });
});

describe("LanguagePanel", () => {
  const coverage = (state: "complete" | "partial" | "missing") => ({ state, covered: 2, total: 4 });
  function panel(
    o: { canSignOff: boolean; ready?: Record<"en" | "de" | "el", boolean>; locale?: "en" | "el"; readiness?: ReadinessIssue[] }
  ) {
    return renderToStaticMarkup(
      createElement(
        IntlProvider,
        { locale: o.locale ?? "en", messages: (o.locale === "el" ? el : en) as typeof en, timeZone: "UTC" },
        createElement(LanguagePanel, {
          slug: "asking-for-help",
          ready: o.ready ?? { en: true, de: true, el: false },
          languages: { en: coverage("complete"), de: coverage("partial"), el: coverage("missing") },
          readiness: o.readiness ?? [],
          canSignOff: o.canSignOff,
        })
      )
    ).replaceAll("<!-- -->", "");
  }

  it("gives a partner admin or an ADMIN one switch per language, its state in words and its coverage beside it", () => {
    const html = panel({ canSignOff: true });
    const switches = [...html.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map((m) => m[0]);
    expect(switches).toHaveLength(2);
    expect(switches[0]).toContain('aria-checked="true"');
    expect(switches[1]).toContain('aria-checked="false"');
    expect(html).toContain("German for learners");
    expect(html).toContain("Live: learners using German get this course in German.");
    expect(html).toContain("Not live: learners using Greek get this course in English.");
    expect(html).toContain("German: 2 of 4 lessons");
    // Live, but not complete: said, not switched off.
    expect(html).toContain("German is live, but some text is missing in it now");
    // What coverage doesn't check, said plainly.
    expect(html).toContain(esc(en.courseManager.languageReady.notChecked));
    expect(html).not.toContain(esc(en.courseManager.languageReady.readOnly));
  });

  it("shows the state read-only to everyone else", () => {
    const html = panel({ canSignOff: false });
    expect(html).not.toContain('role="switch"');
    expect(html).toContain(esc(en.courseManager.languageReady.readOnly));
    expect(html).toContain("Live: learners using German get this course in German.");
  });

  it("writes Greek language names in lower case inside a sentence", () => {
    const html = panel({ canSignOff: true, locale: "el" });
    expect(html).toContain("Γερμανικά για εκπαιδευόμενους");
    expect(html).toContain("βλέπουν αυτό το μάθημα στα γερμανικά");
    expect(html).not.toContain("στα Γερμανικά");
  });

  it("says English is missing on a published course", () => {
    const html = panel({ canSignOff: true, readiness: [{ level: "warning", code: "english-incomplete" }] });
    expect(html).toContain(esc(en.courseManager.languageReady.englishMissing));
  });
});
