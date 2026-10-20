import { describe, it, expect, vi } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import type { CourseStatus } from "@/lib/cms/course-status";
import type { LessonOutline } from "@/lib/cms/course-admin-types";
import type { NewOnlyReason, PartView } from "@/lib/cms/sections/contract";

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
  opts: {
    status?: CourseStatus;
    reasons?: NewOnlyReason[];
    messages?: typeof en;
    lang?: "en" | "de" | "el";
    live?: { learners: number; finished: number; closed: boolean; closedFrom: string | null };
  } = {}
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
          lang: opts.lang ?? "en",
          reasons: opts.reasons ?? [],
          ...(opts.live ? { live: opts.live } : {}),
          main: createElement("p", null, "MAIN EDITOR"),
          onOutline: () => {},
          announce: () => {},
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

  it("names Move up, Move down and Remove with their content, starting with the words shown", () => {
    expect(html).toContain('aria-label="Move up content 3: Quick check"');
    expect(html).toContain('aria-label="Move down content 1: Text"');
    expect(html).toContain('aria-label="Remove content 3: Quick check"');
    expect(html).not.toContain('aria-label="Remove content 2: Text"');
    const removes = [...html.matchAll(/aria-label="(Remove content [^"]+)"/g)].map((m) => m[1]);
    expect(new Set(removes).size).toBe(removes.length);
  });

  it("shows each content's status in words: written or not, draft, not ready", () => {
    expect(html).toContain("Written in English");
    expect(html).toContain(">Draft<");
    expect(html).toContain("Not ready (2)");
  });

  it("says nothing about Release 2: learners get added content (D63)", () => {
    expect(html).not.toContain("Release 2");
  });

  it("has an Add content after every item, and no live region of its own", () => {
    expect((html.match(/>Add content</g) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="Add content after content 3: Quick check"');
    // It speaks through the page's one polite live region (spec 11.3).
    expect(html).not.toMatch(/<p role="status" aria-live="polite" class="sr-only">/);
  });

  it("edits each question in its own region, named by its place", () => {
    expect(html).toContain("Quick check · 3 of 3");
    // The text's editor is the lesson text editor, without title or "Remove".
    expect(html).toContain("Text · 1 of 3 (English)");
    expect(html).not.toContain("Remove English text");
    expect(html).not.toContain("Lesson title");
  });
});

const LIVE_QUIZ: PartView = {
  ...QUIZ,
  id: "p-quiz0009",
  data: { kind: "assessment", questions: [] } as never,
  draft: null,
} as PartView;
const learners = (n: number, closed = false) => ({
  learners: n,
  finished: 0,
  closed,
  closedFrom: "2026-11-30T23:00:00.000Z",
});

describe("PartList — on a live course (D66)", () => {
  it("lets a live course nobody is taking gain added content (Release 1 refused it, D57)", () => {
    const html = render(lesson([MAIN]), { status: "published" });
    expect(tagWith(html, 'aria-label="Add content after content 1: Text"')).not.toContain('aria-disabled="');
    expect(render(lesson([MAIN, QUIZ]), { status: "published", live: learners(0) })).not.toContain('aria-disabled="');
  });

  it("with learners, offers every change (each asks first) but keeps a question they may have answered", () => {
    const html = render(lesson([MAIN, TEXT, LIVE_QUIZ]), { status: "published", live: learners(2) });
    expect(tagWith(html, 'aria-label="Add content after content 1: Text"')).not.toContain('aria-disabled="');
    expect(tagWith(html, 'aria-label="Remove content 2: Text"')).not.toContain('aria-disabled="');
    expect(tagWith(html, 'aria-label="Move up content 3: Quick check"')).not.toContain('aria-disabled="');
    const remove = tagWith(html, 'aria-label="Remove content 3: Quick check"')!;
    expect(remove).toContain('aria-disabled="true"');
    const why = /aria-describedby="([^"]+)"/.exec(remove)![1];
    expect(html).toContain(`<p id="${why}" class="text-sm text-[var(--muted-foreground)]">${en.liveChanges.hasLearners.part.replace(/'/g, "&#x27;")}</p>`);
  });

  it("from 1 December, a published course with learners takes no content change, saying why (D67)", () => {
    const html = render(lesson([MAIN, TEXT]), { status: "published", live: learners(2, true) });
    for (const name of ["Add content after content 1: Text", "Move up content 2: Text", "Remove content 2: Text"]) {
      const tag = tagWith(html, `aria-label="${name}"`)!;
      expect(tag, name).toContain('aria-disabled="true"');
      const why = /aria-describedby="([^"]+)"/.exec(tag)![1];
      expect(html, name).toContain(`<p id="${why}"`);
    }
    expect(html).toContain("From 1 December 2026, lessons and content in a course with learners");
  });

  it("from 1 December, an unpublished course with learners takes none either, saying why (D67)", () => {
    // Unpublishing a course to rework it doesn't get around the cut-off.
    const html = render(lesson([MAIN, TEXT]), { status: "draft", live: learners(2, true) });
    for (const name of ["Add content after content 1: Text", "Move up content 2: Text", "Remove content 2: Text"]) {
      expect(tagWith(html, `aria-label="${name}"`), name).toContain('aria-disabled="true"');
    }
    expect(html).toContain("even while it isn&#x27;t published");
  });
});

describe("PartList — limits and unreadable content", () => {
  it("says it is the unreadable course, not the date, that stops changes", () => {
    const html = render(lesson([MAIN, QUIZ]), { reasons: [{ code: "unreadable" }] });
    expect(html).toContain(en.lessonBlocks.courseUnreadable.replace(/'/g, "&#x27;"));
    expect(html).not.toContain("From 1 December");
    expect(tagWith(html, 'aria-label="Add content after content 2: Quick check"')).toContain(
      'aria-disabled="true"'
    );
  });

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

describe("PartList — a text in the added content, in German", () => {
  const german = { ...TEXT, blocks: { en: TEXT.blocks.en } };
  const html = render(lesson([german, MAIN]), { messages: de as unknown as typeof en, lang: "de" });

  it("names the language in the menu language, and says in German it isn't written yet", () => {
    expect(html).toContain("Text · 1 von 2 (Deutsch)");
    expect(html).not.toContain("(German)");
    expect(html).toContain("Auf Deutsch noch nicht geschrieben");
    expect(html).not.toContain("Not written in German yet");
    expect(html).not.toContain("Text learners read here");
    expect(html).toContain(de.lessonBlocks.textEditor.description);
  });

  it("has its controls in German too, naming the language in German", () => {
    expect(html).toContain("Inhaltsblöcke");
    expect(html).toContain("Auf Deutsch speichern");
    expect(html).not.toContain("Content blocks");
    expect(html).not.toContain("Save German");
  });
});
