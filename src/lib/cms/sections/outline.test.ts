import { describe, it, expect } from "vitest";
import { STAGES } from "@/data/course";
import { presentStageKeys } from "../course-derive";
import {
  applyOutlineOp,
  canonicalInsertIndex,
  freeInteractiveKeys,
  parseStoredOutline,
  resolveOutline,
  toStoredOutline,
} from "./outline";
import { labelVersion, outlineVersion } from "./versions";
import {
  SECTION_LIMITS,
  type ResolvedOutline,
  type SectionFacts,
  type StoredOutline,
} from "./contract";

/*
 * Course.outline: the lesson list of a course created here (D56). Null —
 * every course before Release 1 — means today's layout, derived from the
 * lesson rows exactly as the learner reader derives it. A stored list never
 * loses a lesson: what learners would get is put back at its standard place.
 */

const scenario = { kind: "scenario", setup: { en: "S" } };
const ids = (o: ResolvedOutline) => o.sections.map((s) => s.id);
const stored = (sections: StoredOutline["sections"], removed?: StoredOutline["removed"]) => ({
  v: 1,
  sections,
  ...(removed ? { removed } : {}),
});
const legacy = (...keys: (typeof STAGES)[number][]) =>
  keys.map((id) => ({ id, template: id }));

describe("parseStoredOutline", () => {
  it("reads an empty column as no stored list", () => {
    expect(parseStoredOutline(null)).toBeNull();
    expect(parseStoredOutline(undefined)).toBeNull();
  });

  it("calls a value it can't read unreadable", () => {
    for (const raw of ["x", 1, [], { v: 2, sections: [] }, { v: 1 }, { v: 1, sections: {} }]) {
      expect(parseStoredOutline(raw), JSON.stringify(raw)).toBe("unreadable");
    }
  });

  it("drops entries with a bad id, and repeats", () => {
    const parsed = parseStoredOutline({
      v: 1,
      sections: [
        { id: "context", template: "context" },
        { id: "s-abcdefgh", template: "text" },
        { id: "context", template: "context" },
        { id: "s-abcdefgh", template: "blank" },
        { id: "s-ABCDEFGH", template: "text" },
        { id: "s-abc", template: "text" },
        { id: "intro", template: "text" },
        { id: "s-abcdefgh/x", template: "text" },
        { template: "text" },
        "concept",
        null,
      ],
    });
    expect(parsed).toEqual({
      v: 1,
      sections: [
        { id: "context", template: "context" },
        { id: "s-abcdefgh", template: "text" },
      ],
    });
  });

  it("forces a standard lesson's template to its own key, and names unknown templates text", () => {
    const parsed = parseStoredOutline({
      v: 1,
      sections: [
        { id: "concept", template: "quiz" },
        { id: "simulation" },
        { id: "s-aaaaaaaa", template: "video" },
        { id: "s-bbbbbbbb", template: "context" },
        { id: "s-cccccccc", template: "quiz" },
        { id: "s-dddddddd" },
      ],
    });
    expect(parsed !== "unreadable" && parsed?.sections).toEqual([
      { id: "concept", template: "concept" },
      { id: "simulation", template: "simulation" },
      { id: "s-aaaaaaaa", template: "text" },
      { id: "s-bbbbbbbb", template: "text" },
      { id: "s-cccccccc", template: "quiz" },
      { id: "s-dddddddd", template: "text" },
    ]);
  });

  it("keeps hidden only when it is true, and step names only where written", () => {
    const parsed = parseStoredOutline({
      v: 1,
      sections: [
        { id: "context", template: "context", hidden: true, label: { en: "Start", de: " ", el: 3, fr: "x" } },
        { id: "concept", template: "concept", hidden: "yes", label: { de: "" } },
        { id: "behaviour", template: "behaviour", label: "Start" },
      ],
    });
    expect(parsed !== "unreadable" && parsed?.sections).toEqual([
      { id: "context", template: "context", hidden: true, label: { en: "Start" } },
      { id: "concept", template: "concept" },
      { id: "behaviour", template: "behaviour" },
    ]);
  });

  it("keeps only deleted standard text lessons that aren't listed", () => {
    const parsed = parseStoredOutline({
      v: 1,
      sections: legacy("concept"),
      removed: ["context", "context", "concept", "simulation", "s-abcdefgh", 4],
    });
    expect(parsed !== "unreadable" && parsed?.removed).toEqual(["context"]);
  });

  it("never cuts a long list short", () => {
    const sections = Array.from({ length: 20 }, (_, i) => ({
      id: `s-${String(i).padStart(8, "0")}`,
      template: "text",
    }));
    const parsed = parseStoredOutline({ v: 1, sections });
    expect(parsed !== "unreadable" && parsed?.sections).toHaveLength(20);
  });
});

describe("resolveOutline", () => {
  it("gives a built-in course all seven lessons, whatever is stored", () => {
    for (const raw of [null, stored(legacy("concept")), "garbage"]) {
      const o = resolveOutline("bundled", raw, []);
      expect(ids(o)).toEqual([...STAGES]);
      expect(o.materialised).toBe(false);
      expect(o.unreadable).toBeUndefined();
      expect(o.sections.every((s) => s.template === s.id && !s.custom)).toBe(true);
    }
  });

  it("derives today's lessons from the rows while nothing is stored", () => {
    const lessons: SectionFacts[] = [
      { stageKey: "scenario", structure: scenario },
      { stageKey: "simulation", structureDraft: { kind: "simulation" } },
      { stageKey: "assessment", structure: null },
    ];
    const o = resolveOutline("cms", null, lessons);
    expect(ids(o)).toEqual(presentStageKeys("cms", lessons));
    expect(ids(o)).toEqual(["context", "concept", "behaviour", "scenario", "reflection"]);
    expect(o).toMatchObject({ materialised: false, removed: [] });
    expect(o.sections.every((s) => !s.custom && !s.recovered && !s.hidden)).toBe(true);
  });

  it("keeps a standard practice lesson with extra content, even with no exercise saved", () => {
    // Otherwise "Remove stage" would hide the content and its publish
    // blocker until the exercise came back (addendum 3).
    const lessons: SectionFacts[] = [
      {
        stageKey: "scenario",
        structure: null,
        parts: {
          v: 1,
          items: [
            { id: "main", type: "main" },
            { id: "p-aaaaaaaa", type: "text", blocks: {} },
          ],
        },
      },
    ];
    expect(ids(resolveOutline("cms", null, lessons))).toEqual([
      "context",
      "concept",
      "behaviour",
      "scenario",
      "reflection",
    ]);
    // Main content alone stored as a list is no extra content.
    const mainOnly = [{ stageKey: "scenario", parts: { v: 1, items: [{ id: "main", type: "main" }] } }];
    expect(ids(resolveOutline("cms", null, mainOnly))).toEqual(presentStageKeys("cms", mainOnly));
  });

  it("falls back to today's lessons, marked unreadable, when the stored list can't be read", () => {
    const lessons = [{ stageKey: "assessment", structure: { kind: "assessment" } }];
    const o = resolveOutline("cms", { v: 9 }, lessons);
    expect(ids(o)).toEqual(presentStageKeys("cms", lessons));
    expect(o).toMatchObject({ unreadable: true, materialised: true });
  });

  it("reads a stored list in its order, with its own lessons", () => {
    const o = resolveOutline(
      "cms",
      stored([
        { id: "concept", template: "concept", label: { en: "Idea" } },
        { id: "context", template: "context", hidden: true },
        { id: "s-abcdefgh", template: "quiz" },
        ...legacy("behaviour", "reflection"),
      ]),
      []
    );
    expect(ids(o)).toEqual(["concept", "context", "s-abcdefgh", "behaviour", "reflection"]);
    expect(o.materialised).toBe(true);
    expect(o.sections[0]).toEqual({ id: "concept", template: "concept", custom: false, label: { en: "Idea" } });
    expect(o.sections[1]).toMatchObject({ hidden: true, custom: false });
    expect(o.sections[2]).toMatchObject({ custom: true, template: "quiz" });
  });

  it("puts back, at the standard place, a text lesson missing from the list", () => {
    const o = resolveOutline("cms", stored(legacy("context", "behaviour", "reflection")), []);
    expect(ids(o)).toEqual(["context", "concept", "behaviour", "reflection"]);
    expect(o.sections[1]).toMatchObject({ id: "concept", recovered: true });
  });

  it("doesn't put back a text lesson an editor deleted", () => {
    const o = resolveOutline(
      "cms",
      stored(legacy("concept", "behaviour", "reflection"), ["context"]),
      [{ stageKey: "context", narrative: { en: { title: "Back from an old tab" } } }]
    );
    expect(ids(o)).toEqual(["concept", "behaviour", "reflection"]);
    expect(o.removed).toEqual(["context"]);
  });

  it("puts back an exercise saved for learners from an old page", () => {
    const o = resolveOutline(
      "cms",
      stored([...legacy("context", "concept", "behaviour"), { id: "s-abcdefgh", template: "text" }, ...legacy("reflection")]),
      [{ stageKey: "scenario", structure: scenario }]
    );
    expect(ids(o)).toEqual(["context", "concept", "behaviour", "scenario", "s-abcdefgh", "reflection"]);
    expect(o.sections[3]).toMatchObject({ id: "scenario", recovered: true, custom: false });
  });

  it("doesn't make a lesson of an exercise that is only a draft", () => {
    const o = resolveOutline(
      "cms",
      stored(legacy("context", "concept", "behaviour", "reflection")),
      [{ stageKey: "assessment", structureDraft: { kind: "assessment" } }]
    );
    expect(ids(o)).toEqual(["context", "concept", "behaviour", "reflection"]);
  });

  it("ignores rows that no listed lesson owns", () => {
    // The video and document actions upsert any key (lesson.ts), so such
    // rows exist; they are never adopted as lessons.
    const lessons: SectionFacts[] = [
      { stageKey: "s-abcdefgh", narrative: { en: { title: "Stray" } } },
      { stageKey: "whatever", video: { provider: "file", src: "x" } },
    ];
    expect(ids(resolveOutline("cms", null, lessons))).toEqual(presentStageKeys("cms", lessons));
    expect(ids(resolveOutline("cms", stored(legacy("context", "concept", "behaviour", "reflection")), lessons))).toEqual([
      "context",
      "concept",
      "behaviour",
      "reflection",
    ]);
  });

  it("shows every lesson of a list longer than the limit", () => {
    const sections = Array.from({ length: 18 }, (_, i) => ({
      id: `s-${String(i).padStart(8, "0")}` as const,
      template: "text" as const,
    }));
    const o = resolveOutline("cms", stored([...sections, ...legacy("context", "concept", "behaviour", "reflection")]), []);
    expect(o.sections).toHaveLength(22);
  });
});

describe("canonicalInsertIndex", () => {
  it("goes right after the last standard lesson that comes before it", () => {
    expect(canonicalInsertIndex([{ id: "context" }, { id: "concept" }, { id: "reflection" }], "scenario")).toBe(2);
    expect(
      canonicalInsertIndex([{ id: "context" }, { id: "s-aaaaaaaa" }, { id: "concept" }, { id: "s-bbbbbbbb" }], "behaviour")
    ).toBe(3);
  });

  it("goes before the first one that comes after it when none comes before", () => {
    expect(canonicalInsertIndex([{ id: "s-aaaaaaaa" }, { id: "concept" }, { id: "reflection" }], "context")).toBe(1);
  });

  it("goes at the end with no standard lesson around", () => {
    expect(canonicalInsertIndex([], "context")).toBe(0);
    expect(canonicalInsertIndex([{ id: "s-aaaaaaaa" }, { id: "s-bbbbbbbb" }], "scenario")).toBe(2);
  });
});

/* ------------------------------- applyOutlineOp ------------------------------- */

const draftCourse = (lessons: SectionFacts[] = []) => resolveOutline("cms", null, lessons);
const NEW = "s-newnew00" as const;

describe("applyOutlineOp: add", () => {
  it("adds a practice question in today's place when the standard practice lesson is free", () => {
    const r = applyOutlineOp(draftCourse(), { op: "add", choice: "practice", at: null, newId: NEW }, []);
    expect(r.ok && r.id).toBe("simulation");
    expect(r.ok && ids(r.outline)).toEqual(["context", "concept", "behaviour", "simulation", "reflection"]);
    expect(r.ok && r.outline.sections[3]).toEqual({ id: "simulation", template: "simulation", custom: false });
    expect(r.ok && r.outline.materialised).toBe(true);
  });

  it("reuses the standard key for scenario and quick check too", () => {
    const s = applyOutlineOp(draftCourse(), { op: "add", choice: "scenario", at: null, newId: NEW }, []);
    expect(s.ok && s.id).toBe("scenario");
    const q = applyOutlineOp(draftCourse(), { op: "add", choice: "quiz", at: null, newId: NEW }, []);
    expect(q.ok && ids(q.outline)).toEqual(["context", "concept", "behaviour", "reflection", "assessment"]);
  });

  it("takes over a standard lesson that so far exists only as a draft", () => {
    // The course page shows it as an "Add …" row marked Draft; a second
    // practice lesson next to it would only confuse (addendum 8).
    const lessons = [{ stageKey: "simulation", structureDraft: { kind: "simulation" } }];
    expect(freeInteractiveKeys(draftCourse(lessons), lessons)).toEqual(["simulation", "scenario", "assessment"]);
    const r = applyOutlineOp(draftCourse(lessons), { op: "add", choice: "practice", at: null, newId: NEW }, lessons);
    expect(r.ok && r.id).toBe("simulation");
  });

  it("makes a lesson of its own when the standard key holds anything else", () => {
    for (const row of [
      { narrative: { en: { title: "x" } } },
      { video: { provider: "file", src: "x" } },
      { documentCount: 1 },
      { parts: { v: 1, items: [{ id: "main", type: "main" }, { id: "p-aaaaaaaa", type: "text", blocks: {} }] } },
      { parts: "unreadable" },
    ]) {
      const lessons: SectionFacts[] = [{ stageKey: "simulation", ...row }];
      const o = resolveOutline("cms", stored(legacy("context", "concept", "behaviour", "reflection")), lessons);
      expect(freeInteractiveKeys(o, lessons), JSON.stringify(row)).not.toContain("simulation");
      const r = applyOutlineOp(o, { op: "add", choice: "practice", at: null, newId: NEW }, lessons);
      expect(r.ok && r.id, JSON.stringify(row)).toBe(NEW);
      expect(r.ok && r.outline.sections.at(-1)).toEqual({ id: NEW, template: "practice", custom: true });
    }
  });

  it("makes a lesson of its own when the standard one is already in the list", () => {
    const lessons = [{ stageKey: "scenario", structure: scenario }];
    const r = applyOutlineOp(draftCourse(lessons), { op: "add", choice: "scenario", at: null, newId: NEW }, lessons);
    expect(r.ok && r.id).toBe(NEW);
  });

  it("puts a reused key where the editor asked, even out of the standard order", () => {
    const r = applyOutlineOp(draftCourse(), { op: "add", choice: "quiz", at: 0, newId: NEW }, []);
    expect(r.ok && ids(r.outline)[0]).toBe("assessment");
  });

  it("adds a lesson of its own at the end, or where asked", () => {
    for (const choice of ["blank", "text", "reflectionRating"] as const) {
      const end = applyOutlineOp(draftCourse(), { op: "add", choice, at: null, newId: NEW }, []);
      expect(end.ok && end.outline.sections.at(-1)).toEqual({ id: NEW, template: choice, custom: true });
    }
    const at = applyOutlineOp(draftCourse(), { op: "add", choice: "text", at: 1, newId: NEW }, []);
    expect(at.ok && ids(at.outline)).toEqual(["context", NEW, "concept", "behaviour", "reflection"]);
    const last = applyOutlineOp(draftCourse(), { op: "add", choice: "text", at: 4, newId: NEW }, []);
    expect(last.ok && ids(last.outline).at(-1)).toBe(NEW);
  });

  it("refuses a place outside the list, an unknown choice or a bad id", () => {
    for (const at of [-1, 5, 1.5, NaN]) {
      expect(applyOutlineOp(draftCourse(), { op: "add", choice: "text", at, newId: NEW }, [])).toEqual({
        ok: false,
        error: "bad-input",
      });
    }
    expect(
      applyOutlineOp(draftCourse(), { op: "add", choice: "video" as never, at: null, newId: NEW }, [])
    ).toEqual({ ok: false, error: "bad-input" });
    expect(
      applyOutlineOp(draftCourse(), { op: "add", choice: "text", at: null, newId: "s-x" as never }, [])
    ).toEqual({ ok: false, error: "bad-input" });
  });

  it("never adopts a row or lesson that already has the new id", () => {
    const withRow = [{ stageKey: NEW, narrative: { en: { title: "Stray" } } }];
    expect(applyOutlineOp(draftCourse(withRow), { op: "add", choice: "text", at: null, newId: NEW }, withRow)).toEqual({
      ok: false,
      error: "bad-input",
    });
    const listed = resolveOutline("cms", stored([...legacy("context"), { id: NEW, template: "text" }]), []);
    expect(applyOutlineOp(listed, { op: "add", choice: "text", at: null, newId: NEW }, [])).toEqual({
      ok: false,
      error: "bad-input",
    });
  });

  it("adds back a deleted standard text lesson, empty, at its place", () => {
    const o = resolveOutline("cms", stored(legacy("concept", "behaviour", "reflection"), ["context"]), []);
    const r = applyOutlineOp(o, { op: "add", choice: "restore:context", at: null, newId: NEW }, []);
    expect(r.ok && r.id).toBe("context");
    expect(r.ok && ids(r.outline)).toEqual(["context", "concept", "behaviour", "reflection"]);
    expect(r.ok && r.outline.removed).toEqual([]);
  });

  it("refuses to add back a lesson that wasn't deleted", () => {
    expect(
      applyOutlineOp(draftCourse(), { op: "add", choice: "restore:context", at: null, newId: NEW }, [])
    ).toEqual({ ok: false, error: "not-restorable" });
    expect(
      applyOutlineOp(draftCourse(), { op: "add", choice: "restore:scenario" as never, at: null, newId: NEW }, [])
    ).toEqual({ ok: false, error: "bad-input" });
  });

  it("stops at 15 lessons, hidden ones counted", () => {
    const sections = Array.from({ length: SECTION_LIMITS.maxSections - 4 }, (_, i) => ({
      id: `s-${String(i).padStart(8, "0")}` as const,
      template: "text" as const,
      hidden: true as const,
    }));
    const full = resolveOutline("cms", stored([...legacy("context", "concept", "behaviour", "reflection"), ...sections]), []);
    expect(full.sections).toHaveLength(15);
    for (const choice of ["text", "practice", "restore:context"] as const) {
      expect(applyOutlineOp(full, { op: "add", choice, at: null, newId: NEW }, [])).toEqual({
        ok: false,
        error: "too-many-sections",
      });
    }
    const fourteen = resolveOutline(
      "cms",
      stored([...legacy("context", "concept", "behaviour", "reflection"), ...sections.slice(1)]),
      []
    );
    expect(applyOutlineOp(fourteen, { op: "add", choice: "text", at: null, newId: NEW }, []).ok).toBe(true);
  });
});

describe("applyOutlineOp: move, hide, rename, delete", () => {
  it("swaps a lesson with its neighbour", () => {
    const r = applyOutlineOp(draftCourse(), { op: "move", id: "concept", dir: -1 }, []);
    expect(r.ok && ids(r.outline)).toEqual(["concept", "context", "behaviour", "reflection"]);
    expect(r.ok && r.id).toBe("concept");
  });

  it("refuses to move past either end", () => {
    expect(applyOutlineOp(draftCourse(), { op: "move", id: "context", dir: -1 }, [])).toEqual({
      ok: false,
      error: "at-edge",
    });
    expect(applyOutlineOp(draftCourse(), { op: "move", id: "reflection", dir: 1 }, [])).toEqual({
      ok: false,
      error: "at-edge",
    });
    expect(applyOutlineOp(draftCourse(), { op: "move", id: "context", dir: 2 as never }, [])).toEqual({
      ok: false,
      error: "bad-input",
    });
  });

  it("refuses a lesson that isn't in the list", () => {
    for (const op of [
      { op: "move", id: "scenario", dir: 1 },
      { op: "hide", id: "s-abcdefgh", hidden: true },
      { op: "rename", id: "simulation", locale: "en", label: "x" },
      { op: "delete", id: "assessment" },
    ] as const) {
      expect(applyOutlineOp(draftCourse(), op, [])).toEqual({ ok: false, error: "unknown-section" });
    }
  });

  it("hides and shows a lesson", () => {
    const hidden = applyOutlineOp(draftCourse(), { op: "hide", id: "concept", hidden: true }, []);
    expect(hidden.ok && hidden.outline.sections[1]).toEqual({
      id: "concept",
      template: "concept",
      custom: false,
      hidden: true,
    });
    const shown = hidden.ok && applyOutlineOp(hidden.outline, { op: "hide", id: "concept", hidden: false }, []);
    expect(shown && shown.ok && shown.outline.sections[1]).toEqual({
      id: "concept",
      template: "concept",
      custom: false,
    });
  });

  it("stores a step name cleaned and trimmed, per language", () => {
    const r = applyOutlineOp(
      draftCourse(),
      { op: "rename", id: "concept", locale: "de", label: "  Die\u202E Idee\n " },
      []
    );
    expect(r.ok && r.outline.sections[1].label).toEqual({ de: "Die Idee" });
  });

  it("removes a language's step name when it is left blank", () => {
    const named = resolveOutline(
      "cms",
      stored([{ id: "context", template: "context", label: { en: "Start", de: "Anfang" } }, ...legacy("concept", "behaviour", "reflection")]),
      []
    );
    const r = applyOutlineOp(named, { op: "rename", id: "context", locale: "de", label: "   " }, []);
    expect(r.ok && r.outline.sections[0].label).toEqual({ en: "Start" });
    const none = r.ok && applyOutlineOp(r.outline, { op: "rename", id: "context", locale: "en", label: "" }, []);
    expect(none && none.ok && none.outline.sections[0]).toEqual({ id: "context", template: "context", custom: false });
  });

  it("refuses a step name over 40 characters instead of cutting it", () => {
    const forty = "x".repeat(SECTION_LIMITS.labelChars);
    expect(applyOutlineOp(draftCourse(), { op: "rename", id: "context", locale: "en", label: forty }, []).ok).toBe(true);
    expect(
      applyOutlineOp(draftCourse(), { op: "rename", id: "context", locale: "en", label: `${forty}y` }, [])
    ).toEqual({ ok: false, error: "label-too-long" });
    // Spaces around it don't count.
    expect(applyOutlineOp(draftCourse(), { op: "rename", id: "context", locale: "en", label: ` ${forty} ` }, []).ok).toBe(true);
  });

  it("refuses a language or name that isn't one", () => {
    expect(
      applyOutlineOp(draftCourse(), { op: "rename", id: "context", locale: "fr" as never, label: "x" }, [])
    ).toEqual({ ok: false, error: "bad-input" });
    expect(
      applyOutlineOp(draftCourse(), { op: "rename", id: "context", locale: "en", label: 5 as never }, [])
    ).toEqual({ ok: false, error: "bad-input" });
  });

  it("remembers a deleted standard text lesson, so learners don't get it back empty", () => {
    for (const id of ["context", "concept", "behaviour", "reflection"] as const) {
      const r = applyOutlineOp(draftCourse(), { op: "delete", id }, []);
      expect(r.ok && ids(r.outline)).not.toContain(id);
      expect(r.ok && r.outline.removed).toEqual([id]);
    }
  });

  it("doesn't record a deleted exercise or lesson of its own", () => {
    const lessons = [{ stageKey: "scenario", structure: scenario }];
    const withOwn = resolveOutline(
      "cms",
      stored([...legacy("context", "concept", "behaviour", "scenario"), { id: "s-abcdefgh", template: "text" }, ...legacy("reflection")]),
      lessons
    );
    for (const id of ["scenario", "s-abcdefgh"] as const) {
      const r = applyOutlineOp(withOwn, { op: "delete", id }, lessons);
      expect(r.ok && ids(r.outline)).not.toContain(id);
      expect(r.ok && r.outline.removed).toEqual([]);
    }
  });

  it("refuses to change a list it can't read", () => {
    const o = resolveOutline("cms", "garbage", []);
    expect(applyOutlineOp(o, { op: "move", id: "concept", dir: 1 }, [])).toEqual({ ok: false, error: "bad-input" });
  });

  it("leaves the outline it was given as it was", () => {
    const o = draftCourse();
    const before = JSON.stringify(o);
    applyOutlineOp(o, { op: "move", id: "concept", dir: 1 }, []);
    applyOutlineOp(o, { op: "hide", id: "concept", hidden: true }, []);
    applyOutlineOp(o, { op: "rename", id: "concept", locale: "en", label: "x" }, []);
    applyOutlineOp(o, { op: "delete", id: "concept" }, []);
    applyOutlineOp(o, { op: "add", choice: "text", at: 0, newId: NEW }, []);
    expect(JSON.stringify(o)).toBe(before);
  });
});

describe("toStoredOutline", () => {
  it("stores what was resolved, put-back lessons included, and reads back the same", () => {
    const o = resolveOutline(
      "cms",
      stored([{ id: "context", template: "context", hidden: true, label: { en: "Start" } }, ...legacy("behaviour", "reflection")], ["concept"]),
      [{ stageKey: "scenario", structure: scenario }]
    );
    const s = toStoredOutline(o);
    expect(s).toEqual({
      v: 1,
      sections: [
        { id: "context", template: "context", hidden: true, label: { en: "Start" } },
        { id: "behaviour", template: "behaviour" },
        { id: "scenario", template: "scenario" },
        { id: "reflection", template: "reflection" },
      ],
      removed: ["concept"],
    });
    const again = resolveOutline("cms", s, []);
    expect(again.sections.map((x) => x.id)).toEqual(ids(o));
    expect(again.sections.some((x) => x.recovered)).toBe(false);
    expect(toStoredOutline(again)).toEqual(s);
  });

  it("leaves out an empty list of deleted lessons", () => {
    expect(toStoredOutline(draftCourse())).toEqual({ v: 1, sections: legacy("context", "concept", "behaviour", "reflection") });
  });
});

describe("outline versions", () => {
  const base = draftCourse();

  it("changes with the order, hidden lessons and lessons added", () => {
    const v = outlineVersion(base);
    expect(v).toEqual(expect.any(String));
    const moved = applyOutlineOp(base, { op: "move", id: "concept", dir: 1 }, []);
    const hidden = applyOutlineOp(base, { op: "hide", id: "concept", hidden: true }, []);
    const added = applyOutlineOp(base, { op: "add", choice: "text", at: null, newId: NEW }, []);
    for (const r of [moved, hidden, added]) expect(r.ok && outlineVersion(r.outline)).not.toBe(v);
  });

  it("ignores step names, so a rename never conflicts with a move", () => {
    const renamed = applyOutlineOp(base, { op: "rename", id: "concept", locale: "en", label: "Idea" }, []);
    expect(renamed.ok && outlineVersion(renamed.outline)).toBe(outlineVersion(base));
    // …and a stored copy of the derived list is the same list.
    expect(outlineVersion(resolveOutline("cms", toStoredOutline(base), []))).toBe(outlineVersion(base));
  });

  it("gives each language's step name its own version", () => {
    const renamed = applyOutlineOp(base, { op: "rename", id: "concept", locale: "en", label: "Idea" }, []);
    expect(labelVersion(base, "concept", "en")).toBeNull();
    expect(renamed.ok && labelVersion(renamed.outline, "concept", "en")).toEqual(expect.any(String));
    expect(renamed.ok && labelVersion(renamed.outline, "concept", "de")).toBeNull();
    expect(labelVersion(base, "s-abcdefgh", "en")).toBeNull();
  });
});
