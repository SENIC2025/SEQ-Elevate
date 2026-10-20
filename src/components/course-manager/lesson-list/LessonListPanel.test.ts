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
const { LiveChangeConfirm } = await import("./LiveChangeConfirm");

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
  learnerKeys: o.lessons.filter((l) => l.section && l.live).map((l) => l.key),
  withData: Object.fromEntries(
    o.lessons.flatMap((l) => (l.learnersWithData === undefined ? [] : [[l.key, l.learnersWithData]]))
  ),
});

function row(
  o: CourseOutline,
  key: string,
  mode: "actions" | "rename" | "delete" | "confirm" = "actions",
  extra: { deleteBlocked?: string; confirm?: ReturnType<typeof createElement>; onDeleteHide?: () => void } = {}
) {
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
      describe: (c) =>
        c.kind === "locked"
          ? `why-${c.why}`
          : c.kind === "learners"
            ? "why-learners"
            : c.kind === "enabled" && c.confirm
              ? "learners"
              : undefined,
      rename: { lang: "en", initial: "", placeholder: "Skill concept" },
      ...extra,
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
    // Its icon has a tooltip and the words, and the link is described by them.
    const status = /<span id="([^"]+-concept-status)" role="img" aria-label="Learners get this lesson" title="Learners get this lesson"/.exec(
      html
    );
    expect(status).toBeTruthy();
    expect(status![1]).toMatch(/-concept-status$/);
    const link = /<a ([^>]*href="#lesson-concept"[^>]*)>/.exec(html)![1];
    expect(link).toContain(`aria-describedby="${status![1]}"`);
    // The name is marked with the content language.
    expect(html).toContain('<span lang="en" class="min-w-0 break-words font-medium">2. Skill concept</span>');
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
    // "Hidden" is part of the link's name, and no "Learners get this lesson" beside it.
    const link = /<a [^>]*href="#lesson-context"[^>]*>(.*?)<\/a>/.exec(html)![0];
    expect(link).toContain(">Hidden</span>");
    // Not numbered: learners wouldn't see it. The dash has a tooltip, the link a description.
    expect(link).toMatch(/<span aria-hidden="true" title="Not numbered: learners wouldn&#x27;t see it"[^>]*>–<\/span>/);
    const described = /aria-describedby="([^"]+)"/.exec(link)![1];
    expect(described.split(" ")).toHaveLength(1);
    expect(html).toContain(`<span id="${described}" hidden="">Not numbered: learners wouldn&#x27;t see it</span>`);
    expect(html).not.toMatch(/id="[^"]*-context-status"/);
    // A lesson of the course's own with text is numbered like any other.
    expect(html).toContain('aria-label="Actions for 2. Wrap-up"');
  });

  it("describes the changes that ask first by how many learners take the course and how many finished", () => {
    const html = panel(createdOutline(null, { status: "published", enrolled: 2, finished: 1 }));
    // Both of the message's values are given: never its key instead.
    expect(html).not.toContain("liveChanges.");
    const id = /aria-describedby="([^"]+)"/.exec(button(html, "Add lesson"))![1];
    expect(html).toContain(`<p id="${id}" hidden="">2 learners are taking this course (1 finished).</p>`);
  });

  /** The words that say why learners keep `key` from being deleted (its Delete's description), if any. */
  const deleteWhy = (html: string, key: string) =>
    new RegExp(`<span id="[^"]*-${key}-deleteWhy" hidden="">([^<]*)</span>`).exec(html)?.[1]?.replaceAll("&#x27;", "'");

  it("on a published course with learners, says why no lesson can be deleted, offering Hide only where it can be pressed", () => {
    const stored: StoredOutline = {
      v: 1,
      sections: [
        { id: "context", template: "context" },
        { id: "concept", template: "concept", hidden: true },
        { id: "behaviour", template: "behaviour" },
        { id: "simulation", template: "simulation" },
        { id: "reflection", template: "reflection" },
      ],
    };
    const html = panel(createdOutline(stored, { status: "published", enrolled: 2 }));
    expect(deleteWhy(html, "context")).toBe(
      "2 learners have started this course, so this lesson can't be deleted. You can hide it instead."
    );
    // Hidden already: there is nothing to hide it with.
    expect(deleteWhy(html, "concept")).toBe("2 learners have started this course, so this lesson can't be deleted.");

    // The last lesson learners see can't be hidden either (last-lesson).
    const last: StoredOutline = {
      v: 1,
      sections: [
        { id: "context", template: "context" },
        ...(["concept", "behaviour", "simulation", "reflection"] as const).map((id) => ({
          id,
          template: id,
          hidden: true as const,
        })),
      ],
    };
    const one = panel(createdOutline(last, { status: "published", enrolled: 1 }));
    expect(deleteWhy(one, "context")).toBe("1 learner has started this course, so this lesson can't be deleted.");
  });

  it("on a course that isn't published, names only the learners with something in that lesson", () => {
    const html = panel(createdOutline(null, { enrolled: 3, withData: { context: 1 } }));
    expect(deleteWhy(html, "context")).toBe(
      "1 learner has already worked on this lesson, so it can't be deleted. You can hide it instead."
    );
    // Nobody has anything in it: it deletes, so nothing says it can't.
    expect(deleteWhy(html, "concept")).toBeUndefined();
    expect(html).not.toContain("3 learners have started this course");
  });

  it("with the Release 2 player switched off, doesn't call a lesson of the course's own empty (spec 3.4)", () => {
    const stored: StoredOutline = {
      v: 1,
      sections: [
        { id: "context", template: "context" },
        { id: "s-abcdefgh", template: "text", label: { en: "Wrap-up" } },
        { id: "s-empty000", template: "text", label: { en: "Later" } },
        { id: "concept", template: "concept" },
        { id: "behaviour", template: "behaviour" },
        { id: "simulation", template: "simulation" },
        { id: "reflection", template: "reflection" },
      ],
    };
    const rows = [...STANDARD_ROWS, { stageKey: "s-abcdefgh", narrative: TEXT }];
    const html = panel(createdOutline(stored, { rows, switchedOff: true }));
    for (const own of ["s-abcdefgh", "s-empty000"]) {
      // Not "No content yet" (it has some), nor "Learners get this lesson as
      // soon as it has content" (they don't while the switch is off) ...
      expect(html, own).not.toMatch(new RegExp(`id="[^"]*-${own}-(status|emptyNote)"`));
      // ... but, unnumbered, "Not numbered: learners wouldn't see it".
      const link = new RegExp(`<a ([^>]*href="#lesson-${own}"[^>]*)>`).exec(html)![1];
      expect(link, own).toMatch(/aria-describedby="[^"]*-unnumbered"/);
    }
    // With the player on, an own lesson with nothing in it says how it will appear.
    expect(panel(createdOutline(stored, { rows }))).toMatch(/id="[^"]*-s-empty000-emptyNote"/);
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
    expect(button(html, "Hide")).not.toContain("aria-pressed");
    for (const name of ["Rename", "Add lesson after", "Delete"]) {
      expect(button(html, name)).not.toContain('aria-disabled="true"');
    }
  });

  it("says nothing about Release 2: no change marks the course (D66)", () => {
    const html = row(createdOutline(null), "concept");
    expect(html).not.toContain("Release 2");
    expect(html).not.toContain("nonStandard");
    for (const name of ["Move up", "Move down", "Hide", "Rename", "Delete"]) {
      expect(button(html, name), name).not.toContain("aria-describedby");
    }
  });

  it("offers Show for a hidden lesson, in words", () => {
    const stored: StoredOutline = {
      v: 1,
      sections: [
        { id: "context", template: "context" },
        { id: "concept", template: "concept", hidden: true },
        { id: "behaviour", template: "behaviour" },
        { id: "simulation", template: "simulation" },
        { id: "reflection", template: "reflection" },
      ],
    };
    const html = row(createdOutline(stored), "concept");
    const show = button(html, "Show");
    expect(show).not.toContain("aria-pressed");
    // Showing it again puts the standard back: nothing to warn about.
    expect(show).not.toContain("aria-describedby");
    expect(html).not.toContain(">Hide</button>");
  });

  it("on a live course nobody is taking, offers every change (Release 1 locked them, D57)", () => {
    const html = row(createdOutline(null, { status: "published" }), "concept");
    for (const name of ["Move up", "Move down", "Hide", "Rename", "Add lesson after", "Delete"]) {
      expect(button(html, name), name).not.toContain('aria-disabled="true"');
    }
  });

  it("with learners, the changes that ask first are described by how many learners there are", () => {
    const html = row(createdOutline(null, { status: "published", enrolled: 2 }), "concept");
    for (const name of ["Move up", "Move down", "Hide", "Add lesson after"]) {
      const b = button(html, name);
      expect(b, name).not.toContain('aria-disabled="true"');
      expect(b, name).toContain('aria-describedby="learners"');
    }
    expect(button(html, "Rename")).not.toContain("aria-describedby");
    // Delete stays pressable: its confirmation says why it can't, and offers Hide.
    const del = button(html, "Delete");
    expect(del).not.toContain('aria-disabled="true"');
    expect(del).toContain('aria-describedby="why-learners"');
    // Given the row's own words (the panel's), Delete is described by them.
    const blocked = "2 learners have started this course, so this lesson can't be deleted. You can hide it instead.";
    const own = row(createdOutline(null, { status: "published", enrolled: 2 }), "concept", "actions", { deleteBlocked: blocked });
    expect(button(own, "Delete")).toContain('aria-describedby="r-concept-deleteWhy"');
    expect(own).toContain(`<span id="r-concept-deleteWhy" hidden="">${blocked.replaceAll("'", "&#x27;")}</span>`);
  });

  it("from 1 December, a published course with learners keeps its order; Hide stays (D67)", () => {
    const html = row(createdOutline(null, { status: "published", enrolled: 2, closed: true }), "concept");
    for (const name of ["Move up", "Move down", "Add lesson after"]) {
      const b = button(html, name);
      expect(b, name).toContain('aria-disabled="true"');
      expect(b, name).toContain('aria-describedby="why-closed"');
      expect(b, name).not.toContain('disabled=""');
    }
    expect(button(html, "Hide")).toContain('aria-describedby="learners"');
    expect(button(html, "Hide")).not.toContain('aria-disabled="true"');
  });

  it("asks first in place of the buttons, with the learners and what they will notice", () => {
    const o = createdOutline(null, { status: "published", enrolled: 3, finished: 1 });
    const confirm = createElement(LiveChangeConfirm, {
      change: { kind: "move", name: "Skill concept" },
      nameLang: "en",
      learners: 3,
      finished: 1,
      busy: false,
      onConfirm: () => {},
      onCancel: () => {},
    });
    const html = row(o, "concept", "confirm", { confirm });
    expect(html).not.toContain('role="group" aria-label="Actions for 2. Skill concept"');
    expect(html).toMatch(
      /<h3 [^>]*tabindex="-1"[^>]*>Move “<span lang="en">Skill concept<\/span>” in a course learners are taking\?<\/h3>/
    );
    expect(html).toContain("3 learners are taking this course (1 finished).");
    expect(html).toContain(en.liveChanges.effect.move.replaceAll("'", "&#x27;"));
    expect(html).toContain(">Move it</button>");
    expect(html).toContain(">Cancel</button>");
  });

  it("a delete learners keep from happening says why in its confirmation and offers Hide", () => {
    const o = createdOutline(null, { status: "published", enrolled: 2 });
    const blocked = "2 learners have started this course, so this lesson can't be deleted. You can hide it instead.";
    const html = row(o, "concept", "delete", { deleteBlocked: blocked, onDeleteHide: () => {} });
    const del = button(html, "Delete lesson");
    expect(del).toContain('aria-disabled="true"');
    const why = /aria-describedby="([^"]+)"/.exec(del)![1];
    expect(html).toMatch(new RegExp(`<p id="${why}"[^>]*>.*learners have started this course`));
    expect(html).toContain("Hide it</button>");
    // What would go isn't listed: nothing goes.
    expect(html).not.toContain("<li>Its text in English</li>");
  });

  it("notes that learners get a lesson of the course's own once it has content", () => {
    const stored: StoredOutline = {
      v: 1,
      sections: [
        { id: "context", template: "context" },
        { id: "s-abcdefgh", template: "text", label: { en: "Wrap-up" } },
        { id: "concept", template: "concept" },
        { id: "behaviour", template: "behaviour" },
        { id: "simulation", template: "simulation" },
        { id: "reflection", template: "reflection" },
      ],
    };
    const html = panel(createdOutline(stored));
    const link = /<a ([^>]*href="#lesson-s-abcdefgh"[^>]*)>/.exec(html)![1];
    const described = /aria-describedby="([^"]+)"/.exec(link)![1].split(" ");
    const note = described.find((id) => id.endsWith("-emptyNote"))!;
    expect(html).toContain(`<p id="${note}" class="mb-1 pl-2 text-xs text-[var(--muted-foreground)]">${en.liveChanges.emptyNote}</p>`);
    // A lesson with something in it has no such note.
    expect(html).not.toMatch(/-concept-emptyNote/);
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
    expect(html).toMatch(
      /<h3 [^>]*tabindex="-1"[^>]*>Delete “<span lang="en">Skill concept<\/span>” in all languages\?<\/h3>/
    );
    expect(html).toContain("<li>Its text in English</li>");
    expect(html).toContain("<li>1 text</li>");
    expect(html).toContain("<li>Its video</li>");
    expect(html).toContain("<li>2 documents</li>");
    expect(html).toContain(">Delete lesson</button>");
    expect(html).toContain(">Keep it</button>");
  });
});

describe("Add a lesson", () => {
  const picker = (
    o: CourseOutline,
    from: number | null = null,
    extra: { confirming?: { learners: number; finished: number } } = {}
  ) =>
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
        ...extra,
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
    // One choice of several: native radios in a group with its question.
    expect(html).toContain('<fieldset class="mt-1"><legend class="text-xs text-[var(--muted-foreground)]">Choose what to add:</legend>');
    expect([...html.matchAll(/<input type="radio"/g)]).toHaveLength(7);
    // Nothing chosen yet: Add says so.
    const add = button(html, "Add this lesson");
    expect(add).toContain('aria-disabled="true"');
    const why = /aria-describedby="([^"]+)"/.exec(add)![1];
    expect(html).toContain(`<p id="${why}" hidden="">Choose what to add first.</p>`);
  });

  const radios = (html: string) => [...html.matchAll(/<input([^>]*type="radio"[^>]*)\/>/g)].map((m) => m[1]);

  it("on a live course, offers every kind (Release 1 offered only what kept it standard, D57)", () => {
    const html = picker(createdOutline(null, { status: "published" }));
    for (const [i, choice] of radios(html).entries()) expect(choice, String(i)).not.toContain('aria-disabled="true"');
    expect(html).not.toContain("Release 2");
  });

  it("from 1 December, a published course with learners takes no new lesson, saying why (D67)", () => {
    const html = picker(createdOutline(null, { status: "published", enrolled: 1, closed: true }));
    for (const choice of radios(html)) {
      expect(choice).toContain('aria-disabled="true"');
      expect(choice).toContain("why-closed");
    }
  });

  it("asks first on a course with learners, in place of its buttons", () => {
    const html = picker(createdOutline(null, { enrolled: 4, finished: 2 }), null, {
      confirming: { learners: 4, finished: 2 },
    });
    // Nothing is chosen in a fresh picker: the confirmation waits for a choice.
    expect(html).toContain(">Add this lesson</button>");
    expect(html).not.toContain("Add a lesson to a course learners are taking?");
  });

  const visible = (n: number, hidden = 0) =>
    createdOutline(
      {
        v: 1,
        sections: Array.from({ length: n }, (_, i) => ({
          id: `s-${String(i).padStart(8, "0")}` as const,
          template: "text" as const,
          ...(i < hidden ? { hidden: true as const } : {}),
        })),
        removed: ["context", "concept", "behaviour", "reflection"],
      },
      { rows: [] }
    );

  it("warns when the lesson added would be the 13th learners see (Q7)", () => {
    const many = "Learners would see more than 12 lessons in this course.";
    // 12 visible: the next is the 13th (Release 1 waited for the 14th).
    const html = picker(visible(12));
    expect(html).toContain(many);
    // The course has 12 now: it is the lesson being added that makes it more.
    expect(html).not.toContain("has more than 12 lessons");
    const why = /<p id="([^"]+)"[^>]*><svg[^>]*>.*?<\/svg>Learners would see more than 12 lessons/.exec(html)?.[1];
    expect(why).toBeTruthy();
    expect(picker(visible(11))).not.toContain(many);
    // Hidden lessons don't count towards the warning (they do towards the 15).
    expect(picker(visible(14, 3))).not.toContain(many);
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
