import { describe, it, expect } from "vitest";
import {
  introducedReasons,
  liveWriteAllowed,
  newOnlyReasons,
  outlineReasons,
  predictOutlineOp,
  predictPartOp,
} from "./guard";
import { applyOutlineOp, freeInteractiveKeys, resolveOutline } from "./outline";
import { applyPartOp, emptyPart, MAIN_PART, partsOf, prefillParts, storedPartsValue } from "./section-parts";
import {
  NEW_SECTION_TEMPLATES,
  type AddSectionChoice,
  type ExtraPartId,
  type NewOnlyReason,
  type OutlineOp,
  type PartDefaults,
  type PartOp,
  type ResolvedOutline,
  type SectionFacts,
  type SectionId,
  type StoredPart,
} from "./contract";
import type { CourseStatus } from "../course-status";

/*
 * When does the editor's layout differ from what learners get (D57)? The
 * learner reader is frozen in Release 1, so a course may only be published
 * while the answer is "nowhere", and a live course may only change in ways
 * that don't add a difference. The course page asks the same questions with
 * the same functions before the server does, to grey out what it would
 * refuse.
 */

const scenario = { kind: "scenario", setup: { en: "S" } };
const extra = (id: ExtraPartId = "p-aaaaaaaa") => ({
  v: 1,
  items: [MAIN_PART, { id, type: "text", blocks: {} }],
});
const legacy = (...keys: string[]) => keys.map((id) => ({ id, template: id }));
const stored = (sections: unknown[], removed?: string[]) => ({ v: 1, sections, ...(removed ? { removed } : {}) });

describe("newOnlyReasons", () => {
  it("has nothing to say about a built-in course", () => {
    const o = resolveOutline("bundled", null, []);
    expect(newOnlyReasons("bundled", o, [{ stageKey: "concept", parts: extra() }])).toEqual([]);
  });

  it("has nothing to say about a course in today's layout", () => {
    const lessons = [{ stageKey: "scenario", structure: scenario }];
    expect(newOnlyReasons("cms", resolveOutline("cms", null, lessons), lessons)).toEqual([]);
  });

  it("names each difference, in the order of spec 2.2", () => {
    const lessons: SectionFacts[] = [
      { stageKey: "behaviour", parts: extra() },
      { stageKey: "s-abcdefgh", parts: extra("p-bbbbbbbb") },
      // Not a lesson of the list: its content counts for nothing.
      { stageKey: "s-zzzzzzzz", parts: extra() },
    ];
    const o = resolveOutline(
      "cms",
      stored(
        [
          { id: "concept", template: "concept", hidden: true },
          { id: "context", template: "context" },
          { id: "s-abcdefgh", template: "text", hidden: true },
          ...legacy("behaviour"),
        ],
        ["reflection"]
      ),
      lessons
    );
    expect(newOnlyReasons("cms", o, lessons)).toEqual([
      { code: "hidden-section", sectionId: "concept" },
      { code: "custom-section", sectionId: "s-abcdefgh" },
      { code: "hidden-section", sectionId: "s-abcdefgh" },
      { code: "removed-section", sectionId: "reflection" },
      { code: "reordered" },
      { code: "extra-parts", sectionId: "s-abcdefgh" },
      { code: "extra-parts", sectionId: "behaviour" },
    ]);
  });

  it("names a list it can't read, and nothing else", () => {
    const lessons = [{ stageKey: "s-abcdefgh", parts: extra() }];
    expect(newOnlyReasons("cms", resolveOutline("cms", "garbage", lessons), lessons)).toEqual([
      { code: "unreadable" },
    ]);
    const broken = [{ stageKey: "concept", parts: { v: 7 } }, { stageKey: "context", parts: extra() }];
    const o = resolveOutline("cms", stored([...legacy("context", "concept"), { id: "s-abcdefgh", template: "text" }]), broken);
    expect(newOnlyReasons("cms", o, broken)).toEqual([{ code: "unreadable" }]);
    expect(outlineReasons("cms", resolveOutline("cms", "garbage", []))).toEqual([{ code: "unreadable" }]);
  });

  it("ignores what can't be read in a row that isn't a lesson of the list", () => {
    const lessons = [{ stageKey: "s-zzzzzzzz", parts: "garbage" }, { stageKey: "nonsense", parts: { v: 3 } }];
    expect(newOnlyReasons("cms", resolveOutline("cms", null, lessons), lessons)).toEqual([]);
  });

  it("never counts step names", () => {
    const o = resolveOutline(
      "cms",
      stored([
        { id: "context", template: "context", label: { en: "Start", de: "Anfang" } },
        ...legacy("concept", "behaviour"),
        { id: "reflection", template: "reflection", label: { el: "Πίσω" } },
      ]),
      []
    );
    expect(newOnlyReasons("cms", o, [])).toEqual([]);
  });

  it("doesn't count an empty standard exercise lesson learners simply don't get yet", () => {
    const o = resolveOutline("cms", stored(legacy("context", "concept", "behaviour", "simulation", "reflection", "assessment")), []);
    expect(newOnlyReasons("cms", o, [])).toEqual([]);
  });

  it("counts the main content alone, stored as a list, as no extra content", () => {
    const lessons = [{ stageKey: "concept", parts: { v: 1, items: [MAIN_PART] } }];
    expect(newOnlyReasons("cms", resolveOutline("cms", null, lessons), lessons)).toEqual([]);
  });

  it("splits off the reasons the outline alone gives", () => {
    const lessons = [{ stageKey: "concept", parts: extra() }];
    const o = resolveOutline("cms", stored([{ id: "s-abcdefgh", template: "quiz" }, ...legacy("context", "concept", "behaviour", "reflection")]), lessons);
    expect(outlineReasons("cms", o)).toEqual([{ code: "custom-section", sectionId: "s-abcdefgh" }]);
    expect(newOnlyReasons("cms", o, lessons)).toEqual([
      { code: "custom-section", sectionId: "s-abcdefgh" },
      { code: "extra-parts", sectionId: "concept" },
    ]);
    expect(outlineReasons("bundled", o)).toEqual([]);
  });
});

describe("liveWriteAllowed", () => {
  const custom: NewOnlyReason = { code: "custom-section", sectionId: "s-abcdefgh" };
  const hidden: NewOnlyReason = { code: "hidden-section", sectionId: "concept" };

  it("allows a change to a standard live course only while it stays standard", () => {
    expect(liveWriteAllowed([], [])).toBe(true);
    expect(liveWriteAllowed([], [custom])).toBe(false);
  });

  it("allows any change that adds no difference, so a bypassed course can be cleaned up", () => {
    expect(liveWriteAllowed([custom, hidden], [custom])).toBe(true);
    expect(liveWriteAllowed([custom, hidden], [hidden, custom])).toBe(true);
    expect(liveWriteAllowed([custom], [custom, hidden])).toBe(false);
    // The same kind of difference on another lesson is a new one.
    expect(liveWriteAllowed([hidden], [{ code: "hidden-section", sectionId: "context" }])).toBe(false);
    expect(introducedReasons([custom], [custom, hidden])).toEqual([hidden]);
  });
});

/* ------------------------- the page predicts the server ------------------------- */

const DEFAULTS: PartDefaults = {
  reflectionPrompts: [{ id: "p1", label: { en: "Q" } }],
  ratingLabels: { min: { en: "1" }, max: { en: "5" } },
};
const NEW = "s-newnew00" as const;

interface Fixture {
  name: string;
  raw: unknown;
  lessons: SectionFacts[];
}

const FIXTURES: Fixture[] = [
  { name: "today's layout, nothing stored", raw: null, lessons: [] },
  {
    name: "standard, stored, with step names and an empty quick check",
    raw: stored([
      { id: "context", template: "context", label: { en: "Start" } },
      ...legacy("concept", "behaviour", "scenario", "reflection", "assessment"),
    ]),
    lessons: [
      { stageKey: "scenario", structure: scenario },
      { stageKey: "simulation", structureDraft: { kind: "simulation" } },
    ],
  },
  {
    name: "already different (published past the guard)",
    raw: stored(
      [
        { id: "concept", template: "concept", hidden: true },
        { id: "s-abcdefgh", template: "text" },
        ...legacy("behaviour", "context", "reflection"),
      ],
      []
    ),
    lessons: [
      { stageKey: "behaviour", parts: extra() },
      { stageKey: "s-abcdefgh", narrative: { en: { title: "Own" } } },
      { stageKey: "assessment", video: { provider: "file", src: "x" } },
    ],
  },
  {
    name: "a deleted text lesson",
    raw: stored(legacy("concept", "behaviour", "reflection"), ["context"]),
    lessons: [],
  },
];

/** Every lesson-list change the page offers, for one list. */
function opsFor(o: ResolvedOutline): OutlineOp[] {
  const choices: AddSectionChoice[] = [...NEW_SECTION_TEMPLATES, "restore:context", "restore:reflection"];
  const ops: OutlineOp[] = [];
  for (const choice of choices) {
    for (const at of [null, 0, o.sections.length]) ops.push({ op: "add", choice, at, newId: NEW });
  }
  for (const s of o.sections) {
    ops.push({ op: "move", id: s.id, dir: -1 }, { op: "move", id: s.id, dir: 1 });
    ops.push({ op: "hide", id: s.id, hidden: !s.hidden });
    ops.push({ op: "rename", id: s.id, locale: "de", label: "Neu" });
    ops.push({ op: "delete", id: s.id });
  }
  return ops;
}

/** The rows after a lesson-list change, as the server writes them. */
function rowsAfter(lessons: SectionFacts[], op: OutlineOp, id: SectionId): SectionFacts[] {
  if (op.op === "delete") return lessons.filter((l) => l.stageKey !== id);
  if (op.op === "add" && op.choice === "reflectionRating" && id === NEW) {
    let n = 0;
    const parts = prefillParts("reflectionRating", () => `p-0000000${++n}` as ExtraPartId, DEFAULTS);
    return [...lessons, { stageKey: id, parts: storedPartsValue(parts) }];
  }
  return lessons;
}

/** G3 as the server decides it: the change, then the reasons before and after. */
function server(status: CourseStatus, o: ResolvedOutline, lessons: SectionFacts[], op: OutlineOp) {
  const before = newOnlyReasons("cms", o, lessons);
  const r = applyOutlineOp(o, op, lessons);
  if (!r.ok) return { allowed: false, introduced: [] };
  const after = newOnlyReasons("cms", r.outline, rowsAfter(lessons, op, r.id));
  const introduced = introducedReasons(before, after);
  return { allowed: status !== "published" || liveWriteAllowed(before, after), introduced };
}

describe("predictOutlineOp", () => {
  for (const f of FIXTURES) {
    for (const status of ["draft", "published"] as const) {
      it(`agrees with the server for every change: ${f.name}, ${status}`, () => {
        const o = resolveOutline("cms", f.raw, f.lessons);
        const reasons = newOnlyReasons("cms", o, f.lessons);
        const freeKeys = freeInteractiveKeys(o, f.lessons);
        const ops = opsFor(o);
        expect(ops.length).toBeGreaterThan(20);
        for (const op of ops) {
          expect(
            predictOutlineOp({ kind: "cms", status, outline: o, reasons, freeKeys, op }),
            JSON.stringify(op)
          ).toEqual(server(status, o, f.lessons, op));
        }
      });
    }
  }

  it("lets a live standard course take a renamed step and an exercise in its standard place", () => {
    const o = resolveOutline("cms", null, []);
    const ask = (op: OutlineOp) =>
      predictOutlineOp({ kind: "cms", status: "published", outline: o, reasons: [], freeKeys: ["simulation", "scenario", "assessment"], op });
    expect(ask({ op: "rename", id: "context", locale: "en", label: "Start" }).allowed).toBe(true);
    expect(ask({ op: "add", choice: "practice", at: null, newId: NEW }).allowed).toBe(true);
    expect(ask({ op: "add", choice: "practice", at: 0, newId: NEW })).toEqual({
      allowed: false,
      introduced: [{ code: "reordered" }],
    });
    expect(ask({ op: "add", choice: "text", at: null, newId: NEW })).toEqual({
      allowed: false,
      introduced: [{ code: "custom-section", sectionId: NEW }],
    });
    expect(ask({ op: "delete", id: "concept" })).toEqual({
      allowed: false,
      introduced: [{ code: "removed-section", sectionId: "concept" }],
    });
    expect(ask({ op: "hide", id: "concept", hidden: true }).allowed).toBe(false);
    expect(ask({ op: "move", id: "concept", dir: 1 }).allowed).toBe(false);
  });

  it("offers nothing for a built-in course or a list that can't be read", () => {
    const op: OutlineOp = { op: "rename", id: "context", locale: "en", label: "x" };
    expect(
      predictOutlineOp({ kind: "bundled", status: "draft", outline: resolveOutline("bundled", null, []), reasons: [], freeKeys: [], op })
    ).toEqual({ allowed: false, introduced: [] });
    const broken = resolveOutline("cms", "garbage", []);
    expect(
      predictOutlineOp({ kind: "cms", status: "draft", outline: broken, reasons: [{ code: "unreadable" }], freeKeys: [], op })
    ).toEqual({ allowed: false, introduced: [] });
  });
});

describe("predictPartOp", () => {
  const fixtures: { name: string; raw: unknown; lessons: SectionFacts[] }[] = [
    { name: "standard", raw: null, lessons: [{ stageKey: "concept", narrative: { en: { title: "C" } } }] },
    {
      name: "with extra content already",
      raw: null,
      lessons: [
        { stageKey: "concept", parts: extra() },
        { stageKey: "context", parts: { v: 1, items: [MAIN_PART, { id: "p-aaaaaaaa", type: "text", blocks: {} }, { id: "p-bbbbbbbb", type: "text", blocks: {} }] } },
      ],
    },
  ];

  /** Every content change on one lesson's list. */
  function partOps(items: StoredPart[]): PartOp[] {
    const ops: PartOp[] = [
      { op: "add", part: emptyPart("quiz", "p-cccccccc", DEFAULTS), after: null },
      { op: "add", part: emptyPart("text", "p-cccccccc", DEFAULTS), after: "main" },
    ];
    for (const p of items) {
      ops.push({ op: "move", id: p.id, dir: -1 }, { op: "move", id: p.id, dir: 1 }, { op: "remove", id: p.id });
    }
    return ops;
  }

  for (const f of fixtures) {
    for (const status of ["draft", "published"] as const) {
      it(`agrees with the server for every content change: ${f.name}, ${status}`, () => {
        const o = resolveOutline("cms", f.raw, f.lessons);
        const reasons = newOnlyReasons("cms", o, f.lessons);
        for (const section of o.sections) {
          const row = f.lessons.find((l) => l.stageKey === section.id);
          const items = partsOf(row?.parts);
          if (items === "unreadable") throw new Error("fixture");
          for (const op of partOps(items)) {
            const r = applyPartOp(items, op);
            if (!r.ok) continue;
            const lessons = [
              ...f.lessons.filter((l) => l.stageKey !== section.id),
              { ...row, stageKey: section.id, parts: storedPartsValue(r.items) },
            ];
            const after = newOnlyReasons("cms", o, lessons);
            const serverAllowed = status !== "published" || liveWriteAllowed(reasons, after);
            expect(
              predictPartOp({ status, reasons, sectionId: section.id, op: op.op, extraPartsAfter: r.items.length - 1 }),
              `${section.id} ${JSON.stringify(op)}`
            ).toEqual({ allowed: serverAllowed });
          }
        }
      });
    }
  }

  it("refuses every content change while something can't be read", () => {
    expect(
      predictPartOp({ status: "draft", reasons: [{ code: "unreadable" }], sectionId: "concept", op: "remove", extraPartsAfter: 0 })
    ).toEqual({ allowed: false });
  });
});
