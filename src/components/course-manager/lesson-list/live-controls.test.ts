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
  anyAddAllowed,
  choiceState,
  predictionId,
  reusesStandard,
  rowControls,
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
  sections,
  enrolled,
});

const STANDARD = meta(null);

describe("a draft course: everything is offered", () => {
  it("offers every change; a move at either end is natively disabled", () => {
    const c = ctx(STANDARD);
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
  });

  it("says when an addition makes the course one to publish from Release 2", () => {
    const c = ctx(STANDARD);
    // A free quick check in its usual place keeps the course standard.
    expect(choiceState(c, "quiz", null)).toEqual({ control: { kind: "enabled" }, nonStandard: false });
    // The same at the start is a new order.
    expect(choiceState(c, "quiz", 0).nonStandard).toBe(true);
    // A lesson of the course's own always is.
    expect(choiceState(c, "text", null).nonStandard).toBe(true);
    // Practice is taken (it has a saved exercise): a second one is the course's own.
    expect(reusesStandard("practice", STANDARD)).toBe(false);
    expect(choiceState(c, "practice", null).nonStandard).toBe(true);
  });

  it("deleting needs nobody enrolled, whatever the status", () => {
    expect(rowControls(ctx(STANDARD, "draft", 3), "concept").delete).toEqual({
      kind: "learners",
      count: 3,
    });
  });
});

describe("a published standard course (G3)", () => {
  const live = ctx(STANDARD, "published");

  it("locks reordering, hiding and deleting a standard text lesson, with the reason", () => {
    const row = rowControls(live, "concept");
    expect(row.moveUp).toEqual({ kind: "locked", why: "live" });
    expect(row.moveDown).toEqual({ kind: "locked", why: "live" });
    expect(row.hide).toEqual({ kind: "locked", why: "live" });
    expect(row.delete).toEqual({ kind: "locked", why: "live" });
  });

  it("still allows renaming, and deleting an exercise lesson while nobody is enrolled", () => {
    expect(rowControls(live, "concept").rename).toEqual({ kind: "enabled" });
    expect(rowControls(live, "simulation").delete).toEqual({ kind: "enabled" });
  });

  it("allows only a free practice, scenario or quick check, in its usual place", () => {
    expect(choiceState(live, "scenario", null).control).toEqual({ kind: "enabled" });
    expect(choiceState(live, "quiz", null).control).toEqual({ kind: "enabled" });
    expect(choiceState(live, "quiz", 0).control).toEqual({ kind: "locked", why: "live" });
    for (const choice of ["blank", "text", "reflectionRating", "practice"] as const) {
      expect(choiceState(live, choice, null).control, choice).toEqual({ kind: "locked", why: "live" });
    }
    expect(anyAddAllowed(live)).toEqual({ kind: "enabled" });
  });

  it("locks Add lesson when no addition is allowed", () => {
    const rows: SectionFacts[] = [
      ...STANDARD_ROWS,
      { stageKey: "scenario", structure: { kind: "scenario" } },
      { stageKey: "assessment", structure: { kind: "assessment" } },
    ];
    expect(anyAddAllowed(ctx(meta(null, rows), "published"))).toEqual({ kind: "locked", why: "live" });
  });
});

describe("a course published past the guard can be cleaned up", () => {
  const stored: StoredOutline = {
    v: 1,
    sections: [
      { id: "context", template: "context" },
      { id: "s-abcdefgh", template: "text" },
      { id: "concept", template: "concept", hidden: true },
      { id: "behaviour", template: "behaviour" },
      { id: "simulation", template: "simulation" },
      { id: "reflection", template: "reflection" },
    ],
  };
  const bypass = ctx(meta(stored), "published");

  it("allows deleting its own lesson and showing the hidden one", () => {
    expect(rowControls(bypass, "s-abcdefgh").delete).toEqual({ kind: "enabled" });
    expect(rowControls(bypass, "concept").hide).toEqual({ kind: "enabled" });
  });

  it("refuses hiding another lesson", () => {
    expect(rowControls(bypass, "behaviour").hide).toEqual({ kind: "locked", why: "live" });
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
    expect(anyAddAllowed(full)).toEqual({ kind: "locked", why: "max" });
    expect(choiceState(full, "text", null).control).toEqual({ kind: "locked", why: "max" });
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
    expect(anyAddAllowed(broken)).toEqual({ kind: "locked", why: "unreadable" });
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
