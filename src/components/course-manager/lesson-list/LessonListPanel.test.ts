import { describe, it, expect, vi } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { CourseOutline } from "@/lib/cms/course-admin-types";
import type { StoredOutline } from "@/lib/cms/sections/contract";
import { DirtyProvider } from "../dirty-registry";
import { rowControls, type ListContext } from "./live-controls";
import { createdOutline, NAMES, STANDARD_ROWS, TEXT } from "./test-fixtures";

// The actions run on the server; these tests only render.
vi.mock("@/app/actions/sections", () => ({
  addSection: vi.fn(),
  deleteSection: vi.fn(),
  moveSection: vi.fn(),
  renameSection: vi.fn(),
  setSectionHidden: vi.fn(),
}));

const { LessonListPanel } = await import("./LessonListPanel");
const { SectionRow } = await import("./SectionRow");
const { AddLessonPicker } = await import("./AddLessonPicker");
const { DeleteConfirm, deleteLines } = await import("./DeleteConfirm");

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone?: string;
  children?: ReactNode;
}>;

function render(node: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(
    createElement(IntlProvider, { locale: "en", messages: en, timeZone: "UTC" }, createElement(DirtyProvider, null, node))
  ).replaceAll("<!-- -->", "");
}

const label = (o: CourseOutline) => (key: string) => {
  const l = o.lessons.find((x) => x.key === key);
  const name = l?.section?.name.en.text ?? en.course.stageLabel[key as "context"] ?? key;
  const n = l?.section?.number;
  return n ? `${n}. ${name}` : name;
};

function panel(o: CourseOutline) {
  return render(
    createElement(LessonListPanel, {
      slug: o.slug,
      kind: o.kind,
      status: o.status,
      sections: o.sections!,
      lessons: o.lessons,
      enrolled: o.enrolled,
      lang: "en",
      names: NAMES,
      lessonLabel: label(o),
      onAddStage: () => {},
      onOutline: () => {},
      onRenamed: () => {},
      onAdded: () => {},
      refresh: () => {},
      announce: () => {},
    })
  );
}

const ctxOf = (o: CourseOutline): ListContext => ({
  kind: o.kind,
  status: o.status,
  sections: o.sections!,
  enrolled: o.enrolled,
});

function row(o: CourseOutline, key: string, mode: "actions" | "rename" | "delete" = "actions") {
  const lesson = o.lessons.find((l) => l.key === key)!;
  return render(
    createElement(SectionRow, {
      lesson,
      label: label(o)(key),
      name: lesson.section!.name.en.text,
      status: "live",
      idOf: (part) => `r-${key}-${part}`,
      controls: rowControls(ctxOf(o), key as never),
      open: true,
      mode,
      busy: false,
      error: null,
      describe: (c) => (c.kind === "locked" ? `why-${c.why}` : c.kind === "learners" ? "why-learners" : undefined),
      rename: { lang: "en", initial: "", placeholder: "Skill concept", laterNote: null },
      onToggle: () => {},
      onMove: () => {},
      onHide: () => {},
      onStartRename: () => {},
      onAddAfter: () => {},
      onStartDelete: () => {},
      onRenameSave: () => {},
      onRenameCancel: () => {},
      onDeleteConfirm: () => {},
      onDeleteKeep: () => {},
      announce: () => {},
    })
  );
}

/** The <button …>text</button> named `name` (by text or aria-label). */
function button(html: string, name: string): string {
  const all = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)];
  const found = all.find(
    (m) => m[2].replace(/<[^>]+>/g, "").trim() === name || m[1].includes(`aria-label="${name}"`)
  );
  expect(found, `button "${name}"`).toBeTruthy();
  return found![1];
}

describe("the lesson list of a created course", () => {
  const draft = createdOutline(null, {
    rows: [...STANDARD_ROWS, { stageKey: "scenario", structureDraft: { kind: "scenario" } }],
  });

  it("keeps the Lessons landmark, the n. Name links and today's Add slots", () => {
    const html = panel(draft);
    expect(html).toMatch(/<nav aria-label="Lessons"/);
    expect(html).toContain('href="#lesson-context"');
    expect(html).toMatch(/<a [^>]*href="#lesson-concept"[^>]*>.*?2\. Skill concept<\/span><\/a>/);
    // A draft-only scenario is named with "Draft", not offered again.
    expect(html).toMatch(/<button[^>]*>.*?Applied scenario<\/span>.*?Draft<\/span><\/button>/);
    expect(html).toContain(">Add a quick check</button>");
  });

  it("gives each lesson a disclosure named after it, and says whether learners get it in words", () => {
    const html = panel(draft);
    const actions = button(html, "Actions for 2. Skill concept");
    expect(actions).toContain('aria-expanded="false"');
    const controls = /aria-controls="([^"]+)"/.exec(actions)![1];
    expect(html).toContain(`id="${controls}" hidden=""`);
    expect(html).toContain('<span class="sr-only">Learners get this lesson</span>');
    // Narrow screens: "Lessons (5)" opens the list.
    expect(button(html, "Lessons (5)")).toContain('aria-expanded="false"');
    expect(html).toContain(">Add lesson</button>");
  });

  it("marks a hidden lesson and a lesson of the course's own in words", () => {
    const stored: StoredOutline = {
      v: 1,
      sections: [
        { id: "context", template: "context", hidden: true },
        { id: "concept", template: "concept" },
        { id: "s-abcdefgh", template: "text", label: { en: "Wrap-up" } },
        { id: "behaviour", template: "behaviour" },
        { id: "simulation", template: "simulation" },
        { id: "reflection", template: "reflection" },
      ],
    };
    const html = panel(createdOutline(stored, { rows: [...STANDARD_ROWS, { stageKey: "s-abcdefgh", narrative: TEXT }] }));
    expect(html).toContain(">Hidden</span>");
    // Not numbered: learners wouldn't see it.
    expect(html).toMatch(/href="#lesson-context"[^>]*><span aria-hidden="true"[^>]*>–<\/span>/);
    // A lesson of the course's own with text is numbered like any other.
    expect(html).toContain('aria-label="Actions for 2. Wrap-up"');
  });
});

describe("a lesson's actions", () => {
  it("on a draft: all offered, a move at an end natively disabled", () => {
    const o = createdOutline(null);
    const html = row(o, "context");
    expect(html).toMatch(/<div role="group" aria-label="Actions for 1\. Context"/);
    expect(button(html, "Move up")).toContain('disabled=""');
    const down = button(html, "Move down");
    expect(down).not.toContain('disabled=""');
    expect(button(html, "Hide")).toContain('aria-pressed="false"');
    for (const name of ["Rename", "Add lesson after", "Delete"]) {
      expect(button(html, name)).not.toContain('aria-disabled="true"');
    }
  });

  it("on a live course: refused changes stay focusable, aria-disabled with the reason", () => {
    const o = createdOutline(null, { status: "published" });
    const html = row(o, "concept");
    for (const name of ["Move up", "Move down", "Hide", "Delete"]) {
      const b = button(html, name);
      expect(b, name).toContain('aria-disabled="true"');
      expect(b, name).toContain('aria-describedby="why-live"');
      expect(b, name).not.toContain('disabled=""');
    }
    expect(button(html, "Rename")).not.toContain('aria-disabled="true"');
    expect(html).toContain(en.lessonList.liveLocked);
  });

  it("with learners enrolled, Delete says how many", () => {
    const o = createdOutline(null, { enrolled: 2 });
    const b = button(row(o, "concept"), "Delete");
    expect(b).toContain('aria-disabled="true"');
    expect(b).toContain('aria-describedby="why-learners"');
  });

  it("renames in the content language with a counter out of 40", () => {
    const html = row(createdOutline(null), "concept", "rename");
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>Lesson name in English<\/label><input id="\1"[^>]*lang="en"/);
    expect(html).toContain('placeholder="Skill concept"');
    expect(html).toContain("0 of 40 characters");
    expect(html).toContain(">Save name</button>");
  });

  it("confirms a delete by listing everything that goes", () => {
    const html = row(createdOutline(null), "concept", "delete");
    expect(html).toMatch(/<h3 [^>]*tabindex="-1"[^>]*>Delete “Skill concept” in all languages\?<\/h3>/);
    expect(html).toContain("<li>Its text in English</li>");
    expect(html).toContain("<li>1 text</li>");
    expect(html).toContain("<li>Its video</li>");
    expect(html).toContain("<li>2 documents</li>");
    expect(html).toContain(">Delete lesson</button>");
    expect(html).toContain(">Keep it</button>");
  });
});

describe("Add a lesson", () => {
  const picker = (o: CourseOutline, from: number | null = null) =>
    render(
      createElement(AddLessonPicker, {
        ctx: ctxOf(o),
        from,
        busy: false,
        lessonLabel: label(o),
        restoreName: (k) => NAMES.standard.en[k],
        descriptions: (c) => (c.kind === "locked" ? `why-${c.why}` : undefined),
        error: null,
        onAdd: () => {},
        onClose: () => {},
        onHint: () => {},
      })
    );

  it("lists every kind with its hint, then the deleted standard lessons, and where to put it", () => {
    const stored: StoredOutline = {
      v: 1,
      sections: [
        { id: "context", template: "context" },
        { id: "behaviour", template: "behaviour" },
        { id: "simulation", template: "simulation" },
        { id: "reflection", template: "reflection" },
      ],
      removed: ["concept"],
    };
    const html = picker(createdOutline(stored));
    const names = [...html.matchAll(/<span id="[^"]+-label"[^>]*>(.*?)<\/span>/g)].map((m) => m[1]);
    expect(names).toEqual([
      "Blank",
      "Text",
      "Practice question",
      "Branching scenario",
      "Quick check",
      "Reflection &amp; self-assessment",
      "Add back: Skill concept (empty)",
    ]);
    expect(html).toContain(">Where</span><select");
    expect(html).toContain('<option value="0">At the start</option>');
    expect(html).toContain('<option value="2">After 2. Behaviour model</option>');
    // Nothing chosen yet: Add says so by doing nothing but pointing at the list.
    expect(button(html, "Add this lesson")).toContain('aria-disabled="true"');
  });

  it("on a live course, only the choices that keep it standard are offered", () => {
    const html = picker(createdOutline(null, { status: "published" }));
    const choice = (n: number) => {
      const all = [...html.matchAll(/<button([^>]*aria-pressed[^>]*)>/g)];
      return all[n][1];
    };
    // Blank, Text: refused, with the reason.
    expect(choice(0)).toContain('aria-disabled="true"');
    expect(choice(0)).toContain("why-live");
    expect(choice(1)).toContain('aria-disabled="true"');
    // Practice is taken; Branching scenario and Quick check are free.
    expect(choice(2)).toContain('aria-disabled="true"');
    expect(choice(3)).not.toContain('aria-disabled="true"');
    expect(choice(4)).not.toContain('aria-disabled="true"');
  });

  it("warns above 12 lessons", () => {
    const sections = Array.from({ length: 13 }, (_, i) => ({
      id: `s-${String(i).padStart(8, "0")}` as const,
      template: "text" as const,
    }));
    const o = createdOutline(
      { v: 1, sections, removed: ["context", "concept", "behaviour", "reflection"] },
      { rows: [] }
    );
    expect(picker(o)).toContain("This course has more than 12 lessons.");
  });
});

describe("delete summary lines", () => {
  it("lists only what is there", () => {
    const t = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ""}`;
    expect(
      deleteLines(
        { languages: [], textBlocks: 0, questionBlocks: 2, video: false, documents: 0 },
        t,
        [],
        (x) => x.join("+")
      )
    ).toEqual(['delete.questions{"count":2}']);
    expect(
      deleteLines(
        { languages: ["en", "de"], textBlocks: 1, questionBlocks: 0, video: true, documents: 1 },
        t,
        ["English", "German"],
        (x) => x.join(" and ")
      )
    ).toEqual([
      'delete.textIn{"languages":"English and German"}',
      'delete.textItems{"count":1}',
      "delete.video",
      'delete.documents{"count":1}',
    ]);
  });

  it("renders nothing to remove plainly", () => {
    const html = render(
      createElement(DeleteConfirm, {
        name: "Wrap-up",
        summary: { languages: [], textBlocks: 0, questionBlocks: 0, video: false, documents: 0 },
        busy: false,
        error: null,
        onConfirm: () => {},
        onKeep: () => {},
      })
    );
    expect(html).toContain(en.lessonList.delete.nothing);
  });
});
