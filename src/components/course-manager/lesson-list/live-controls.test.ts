import { describe, it, expect } from "vitest";
import { newOnlyReasons } from "@/lib/cms/sections/guard";
import {
  freeInteractiveKeys,
  outlineVersion,
  resolveOutline,
} from "@/lib/cms/sections/outline";
import type { SectionFacts, SectionsMeta, StoredOutline } from "@/lib/cms/sections/contract";
import type { CourseStatus } from "@/lib/cms/course-status";
import {
  addChoices,
  addControl,
  choiceState,
  predictionId,
  reusesStandard,
  rowControls,
  visibleAfterAdd,
  type ListContext,
} from "./live-controls";

const para = (text: string) => ({ kind: "paragraph", text });
const text = { en: { title: "T", blocks: [para("x")] } };
const sim = {
  kind: "simulation",
  prompt: { en: "Hi" },
  instruction: {},
  options: [
    { id: "a", isBest: true, text: { en: "A" }, feedback: {} },
    { id: "b", isBest: false, text: { en: "B" }, feedback: {} },
  ],
};

/** The four text lessons written, and a saved practice. */
const STANDARD_ROWS: SectionFacts[] = [
  { stageKey: "context", narrative: text },
  { stageKey: "concept", narrative: text },
  { stageKey: "behaviour", narrative: text },
  { stageKey: "simulation", structure: sim },
  { stageKey: "reflection", narrative: text },
];

function meta(raw: StoredOutline | null, rows: SectionFacts[] = STANDARD_ROWS): SectionsMeta {
  const resolved = resolveOutline("cms", raw, rows);
  return {
    version: outlineVersion(resolved),
    resolved,
    reasons: newOnlyReasons("cms", resolved, rows),
    freeKeys: freeInteractiveKeys(resolved, rows),
    hasLabels: false,
    max: 15,
    warnAbove: 12,
  };
}

const ctx = (sections: SectionsMeta, status: CourseStatus = "draft", enrolled = 0): ListContext => ({
  kind: "cms",
  status,
  sections: { ...sections, learners: enrolled, finished: 0, restructureClosed: false, closedFrom: null },
  enrolled,
});

/** The same course from the 1 December cut-off (D67). */
const closed = (c: ListContext): ListContext => ({
  ...c,
  sections: { ...c.sections, restructureClosed: true, closedFrom: "2026-11-30T23:00:00.000Z" },
});

const STANDARD = meta(null);
const SHOWN = ["context", "concept", "behaviour", "simulation", "reflection"];

describe("a course nobody is taking: everything is offered", () => {
  it("offers every change, published or not; a move at either end is natively disabled", () => {
    for (const status of ["draft", "published"] as const) {
      const c = ctx(STANDARD, status);
      expect(rowControls(c, "context")).toEqual({
        moveUp: { kind: "edge" },
        moveDown: { kind: "enabled" },
        hide: { kind: "enabled" },
        rename: { kind: "enabled" },
        addAfter: { kind: "enabled" },
        delete: { kind: "enabled" },
      });
      expect(rowControls(c, "reflection").moveDown).toEqual({ kind: "edge" });
      expect(rowControls(c, "reflection").moveUp).toEqual({ kind: "enabled" });
    }
  });

  it("offers any lesson to add, anywhere, on a live course too (Release 1 refused most, D57)", () => {
    const live = ctx(STANDARD, "published");
    for (const choice of ["blank", "text", "reflectionRating", "practice", "quiz"] as const) {
      expect(choiceState(live, choice, null), choice).toEqual({ kind: "enabled" });
      expect(choiceState(live, choice, 0), choice).toEqual({ kind: "enabled" });
    }
    expect(addControl(live)).toEqual({ kind: "enabled" });
    // Practice is taken (it has a saved exercise): a second one is the course's own.
    expect(reusesStandard("practice", STANDARD)).toBe(false);
    // The cut-off changes nothing while nobody is taking it.
    expect(rowControls(closed(live), "concept").moveUp).toEqual({ kind: "enabled" });
  });

  it("keeps a published course's last lesson learners see from being hidden or deleted (last-lesson)", () => {
    const live = { ...ctx(STANDARD, "published"), learnerKeys: ["concept"] };
    expect(rowControls(live, "concept").hide).toEqual({ kind: "locked", why: "last-lesson" });
    expect(rowControls(live, "concept").delete).toEqual({ kind: "locked", why: "last-lesson" });
    // Another lesson, or a draft, is free.
    expect(rowControls(live, "context").hide).toEqual({ kind: "enabled" });
    expect(rowControls({ ...live, status: "draft" }, "concept").hide).toEqual({ kind: "enabled" });
  });
});

describe("a course with learners (D66, spec 7.2)", () => {
  it("asks first before adding, moving, hiding or showing a lesson; a rename never asks", () => {
    for (const status of ["draft", "published"] as const) {
      const c = { ...ctx(STANDARD, status, 3), learnerKeys: SHOWN };
      const row = rowControls(c, "concept");
      expect(row.moveUp).toEqual({ kind: "enabled", confirm: true });
      expect(row.moveDown).toEqual({ kind: "enabled", confirm: true });
      expect(row.hide).toEqual({ kind: "enabled", confirm: true });
      expect(row.addAfter).toEqual({ kind: "enabled", confirm: true });
      expect(row.rename).toEqual({ kind: "enabled" });
      expect(choiceState(c, "text", null)).toEqual({ kind: "enabled", confirm: true });
    }
  });

  it("refuses a delete on a published course whatever the lesson, offering Hide", () => {
    const c = { ...ctx(STANDARD, "published", 3), withData: { concept: 0, "s-abcdefgh": 0 } };
    expect(rowControls(c, "concept").delete).toEqual({ kind: "learners", count: 3 });
  });

  it("on an unpublished course, deletes a lesson nobody has anything in, without asking", () => {
    const c = { ...ctx(STANDARD, "draft", 3), withData: { concept: 2, behaviour: 0 } };
    expect(rowControls(c, "concept").delete).toEqual({ kind: "learners", count: 2 });
    expect(rowControls(c, "behaviour").delete).toEqual({ kind: "enabled" });
    // Not told who has what: refused, as the server would until it counts.
    expect(rowControls(c, "context").delete).toEqual({ kind: "learners", count: 3 });
  });

  it("from the cut-off, keeps a published course's lessons where they are but lets Hide and Show through (D67)", () => {
    const c = closed({ ...ctx(STANDARD, "published", 2), learnerKeys: SHOWN });
    const row = rowControls(c, "concept");
    expect(row.moveUp).toEqual({ kind: "locked", why: "closed" });
    expect(row.moveDown).toEqual({ kind: "locked", why: "closed" });
    expect(row.addAfter).toEqual({ kind: "locked", why: "closed" });
    expect(addControl(c)).toEqual({ kind: "locked", why: "closed" });
    expect(row.hide).toEqual({ kind: "enabled", confirm: true });
    expect(row.rename).toEqual({ kind: "enabled" });
    // An unpublished course is never closed.
    expect(rowControls(closed(ctx(STANDARD, "draft", 2)), "concept").moveUp).toEqual({ kind: "enabled", confirm: true });
  });

  it("counts the learners SectionsMeta sent over the page's enrolment count", () => {
    const c: ListContext = { ...ctx(STANDARD, "draft", 0), enrolled: 0, sections: { ...STANDARD, learners: 2 } };
    expect(rowControls(c, "concept").hide).toEqual({ kind: "enabled", confirm: true });
  });
});

describe("the picker's warning (Q7)", () => {
  const own = (n: number, hidden = 0) =>
    meta(
      {
        v: 1,
        sections: Array.from({ length: n }, (_, i) => ({
          id: `s-${String(i).padStart(8, "0")}` as const,
          template: "text" as const,
          ...(i < hidden ? { hidden: true as const } : {}),
        })),
        removed: ["context", "concept", "behaviour", "reflection"],
      },
      []
    );

  it("counts the lessons learners would see once one more is added, hidden ones left out", () => {
    expect(visibleAfterAdd(own(11))).toBe(12);
    // The 13th visible lesson is the one to warn about (Release 1 warned from the 14th).
    expect(visibleAfterAdd(own(12))).toBe(13);
    expect(visibleAfterAdd(own(12)) > 12).toBe(true);
    expect(visibleAfterAdd(own(14, 3))).toBe(12);
  });
});

describe("limits and unreadable lists", () => {
  it("refuses adding at 15 lessons, hidden ones counted", () => {
    const sections = Array.from({ length: 15 }, (_, i) => ({
      id: `s-${String(i).padStart(8, "0")}` as const,
      template: "text" as const,
    }));
    const full = ctx(meta({ v: 1, sections, removed: ["context", "concept", "behaviour", "reflection"] }, []));
    expect(full.sections.resolved.sections).toHaveLength(15);
    expect(addControl(full)).toEqual({ kind: "locked", why: "max" });
    expect(choiceState(full, "text", null)).toEqual({ kind: "locked", why: "max" });
    expect(rowControls(full, sections[3].id).addAfter).toEqual({ kind: "locked", why: "max" });
    // A prediction id never collides with a lesson the page has.
    expect(sections.map((s) => s.id)).not.toContain(predictionId(full.sections));
  });

  it("locks every change while the list can't be read", () => {
    const broken = ctx(meta("not an outline" as unknown as StoredOutline));
    expect(broken.sections.resolved.unreadable).toBe(true);
    const row = rowControls(broken, "concept");
    expect(row.hide).toEqual({ kind: "locked", why: "unreadable" });
    expect(row.rename).toEqual({ kind: "locked", why: "unreadable" });
    expect(row.delete).toEqual({ kind: "locked", why: "unreadable" });
    expect(addControl(broken)).toEqual({ kind: "locked", why: "unreadable" });
  });

  it("offers each deleted standard lesson back, after the six kinds", () => {
    const stored: StoredOutline = {
      v: 1,
      sections: [
        { id: "context", template: "context" },
        { id: "behaviour", template: "behaviour" },
        { id: "reflection", template: "reflection" },
      ],
      removed: ["concept"],
    };
    expect(addChoices(meta(stored))).toEqual([
      "blank",
      "text",
      "practice",
      "scenario",
      "quiz",
      "reflectionRating",
      "restore:concept",
    ]);
    expect(reusesStandard("restore:concept", meta(stored))).toBe(true);
  });
});
