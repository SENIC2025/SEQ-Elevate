import { describe, it, expect, vi } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import type { CourseStatus } from "@/lib/cms/course-status";
import type { LessonOutline } from "@/lib/cms/course-admin-types";
import type { NewOnlyReason } from "@/lib/cms/sections/contract";

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/actions/parts", () => ({}));
vi.mock("@/app/actions/structure", () => ({}));
vi.mock("@/app/actions/lesson", () => ({}));

import { DirtyProvider } from "../dirty-registry";
import { PartList } from "./PartList";
import { MAIN, QUIZ, TEXT, lesson } from "./fixtures";

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone: string;
  children?: ReactNode;
}>;

function render(
  l: LessonOutline,
  opts: { status?: CourseStatus; reasons?: NewOnlyReason[]; messages?: typeof en } = {}
) {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: opts.messages ?? en, timeZone: "UTC" },
      createElement(
        DirtyProvider,
        null,
        createElement(PartList, {
          lesson: l,
          label: "2. Skill concept",
          slug: "my-course",
          kind: "cms",
          status: opts.status ?? "draft",
          lang: "en",
          reasons: opts.reasons ?? [],
          main: createElement("p", null, "MAIN EDITOR"),
          onOutline: () => {},
        })
      )
    )
  );
}

/** The opening tag of the element with this attribute fragment. */
const tagWith = (html: string, fragment: string) =>
  html.match(new RegExp(`<[a-z]+[^>]*${fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*>`))?.[0];

describe("PartList — a lesson with only its main content", () => {
  const html = render(lesson([MAIN]));

  it("shows the main content's editor as today, with no content header", () => {
    expect(html).toContain("MAIN EDITOR");
    expect(html).not.toContain('role="group"');
    expect(html).not.toContain("Move up");
    expect(html).not.toContain(en.lessonBlocks.notInLearnerView);
  });

  it("offers Add content after it, named by what it follows", () => {
    const add = tagWith(html, 'aria-label="Add content after content 1: Text"');
    expect(add).toBeDefined();
    expect(add).toContain('aria-expanded="false"');
    expect(add).not.toContain('aria-disabled="');
    expect(html).toContain(">Add content<");
  });
});

describe("PartList — a lesson with added content", () => {
  const html = render(lesson([TEXT, MAIN, QUIZ]));

  it("names each content by place and type, in a group with its controls", () => {
    expect(html).toContain("Content 1 of 3: Text");
    expect(html).toContain("Content 2 of 3: Text");
    expect(html).toContain("Content 3 of 3: Quick check");
    expect((html.match(/role="group"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("has Move up and Move down for every item, disabled at the ends, and Remove except for the main content", () => {
    expect((html.match(/>Move up</g) ?? []).length).toBe(3);
    expect((html.match(/>Remove</g) ?? []).length).toBe(2);
    const ups = [...html.matchAll(/<button[^>]*>(?:(?!<\/button>).)*Move up<\/button>/g)].map((m) => m[0]);
    expect(ups[0]).toContain('disabled=""');
    expect(ups[1]).not.toContain('disabled=""');
    const downs = [...html.matchAll(/<button[^>]*>(?:(?!<\/button>).)*Move down<\/button>/g)].map((m) => m[0]);
    expect(downs[2]).toContain('disabled=""');
  });

  it("shows each content's status in words: written or not, draft, not ready", () => {
    expect(html).toContain("Written in English");
    expect(html).toContain(">Draft<");
    expect(html).toContain("Not ready (2)");
  });

  it("says learners get the added content from Release 2", () => {
    expect(html).toContain(en.lessonBlocks.notInLearnerView);
  });

  it("has an Add content after every item, and one polite status line", () => {
    expect((html.match(/>Add content</g) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="Add content after content 3: Quick check"');
    expect((html.match(/role="status"/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(html).toMatch(/<p role="status" aria-live="polite" class="sr-only">/);
  });

  it("edits each question in its own region, named by its place", () => {
    expect(html).toContain("Quick check · 3 of 3");
    // The text's editor is the lesson text editor, without title or "Remove".
    expect(html).toContain("Text · 1 of 3 (English)");
    expect(html).not.toContain("Remove English text");
    expect(html).not.toContain("Lesson title");
  });
});

describe("PartList — on a live course", () => {
  it("doesn't let a standard lesson gain added content: Add content is aria-disabled, with the reason", () => {
    const html = render(lesson([MAIN]), { status: "published" });
    const add = tagWith(html, 'aria-label="Add content after content 1: Text"')!;
    expect(add).toContain('aria-disabled="true"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(add)![1];
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toContain(en.lessonBlocks.liveLocked);
  });

  it("lets a lesson that already has added content keep changing it", () => {
    const html = render(lesson([MAIN, QUIZ]), {
      status: "published",
      reasons: [{ code: "extra-parts", sectionId: "concept" }],
    });
    expect(html).not.toContain('aria-disabled="');
    expect(html).not.toContain(en.lessonBlocks.liveLocked);
  });
});

describe("PartList — limits and unreadable content", () => {
  it("stops adding at the most content a lesson can hold, saying why", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      ...TEXT,
      id: `p-text${String(i).padStart(4, "0")}` as `p-${string}`,
    }));
    const html = render(lesson([MAIN, ...many]));
    expect(html).toContain("A lesson can hold at most 12 pieces of content");
    expect(tagWith(html, 'aria-label="Add content after content 12: Text"')).toContain(
      'aria-disabled="true"'
    );
  });

  it("keeps the main content editable when the added content can't be read", () => {
    const html = render({ ...lesson([MAIN]), parts: null });
    expect(html).toContain("MAIN EDITOR");
    expect(html).toContain(en.lessonBlocks.unreadable.replace(/'/g, "&#x27;"));
    expect(html).not.toContain("Add content");
  });
});

describe("PartList — in German", () => {
  it("calls content Inhalt", () => {
    const html = render(lesson([MAIN, QUIZ]), { messages: de as unknown as typeof en });
    expect(html).toContain("Inhalt 2 von 2: Schnellcheck");
    expect(html).toContain("Inhalt hinzufügen");
  });
});
