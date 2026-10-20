import { describe, it, expect } from "vitest";
import { newOnlyReasons, outlineReasons, predictOutlineOp, predictPartOp } from "./guard";
import { liveRule, outlineLiveOp, type LiveFacts, type LiveOp } from "./live-rules";
import { applyOutlineOp, freeInteractiveKeys, resolveOutline } from "./outline";
import { MAIN_PART } from "./section-parts";
import {
  NEW_SECTION_TEMPLATES,
  type AddSectionChoice,
  type ExtraPartId,
  type OutlineOp,
  type ResolvedOutline,
  type SectionFacts,
} from "./contract";

/*
 * When does the editor's layout differ from the standard one (D57)? Release
 * 1 published a course only while the answer was "nowhere"; Release 2 asks
 * it only under a kill switch (spec 3.4). And the page's forecasts of the
 * rules for changing a course people are taking (D66, D67): the course page
 * asks them before the server does, so it offers what the server takes.
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

/* ------------------------- the page predicts the server ------------------------- */

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

/** Spec 7.2's facts in each of the table's columns, and a published course's last lesson. */
const FACTS: Record<string, LiveFacts> = {
  "no learners, published": { status: "published", learners: 0, closed: true },
  "learners, draft": { status: "draft", learners: 2, closed: true, withData: 1 },
  "learners, draft, nobody in the lesson": { status: "draft", learners: 2, closed: false, withData: 0 },
  "learners, published, before the cut-off": { status: "published", learners: 2, closed: false },
  "learners, published, from the cut-off": { status: "published", learners: 2, closed: true },
  "no learners, published, its last lesson": { status: "published", learners: 0, closed: false, lastVisible: true },
};

/** The server's answer: the change by the list's rules, then guardStructure's rule (live-rules.ts). */
function server(o: ResolvedOutline, lessons: SectionFacts[], op: OutlineOp, facts: LiveFacts) {
  const r = applyOutlineOp(o, op, lessons);
  if (!r.ok) return { allowed: false, verdict: null };
  const live = outlineLiveOp(op);
  const verdict = live ? liveRule(live, facts) : "allowed";
  return { allowed: verdict === "allowed" || verdict === "needs-confirmation", verdict };
}

describe("predictOutlineOp", () => {
  for (const f of FIXTURES) {
    for (const [name, facts] of Object.entries(FACTS)) {
      it(`agrees with the server for every change: ${f.name}, ${name}`, () => {
        const o = resolveOutline("cms", f.raw, f.lessons);
        const reasons = newOnlyReasons("cms", o, f.lessons);
        const freeKeys = freeInteractiveKeys(o, f.lessons);
        const ops = opsFor(o);
        expect(ops.length).toBeGreaterThan(20);
        for (const op of ops) {
          expect(
            predictOutlineOp({ kind: "cms", outline: o, reasons, freeKeys, op, facts }),
            JSON.stringify(op)
          ).toEqual(server(o, f.lessons, op, facts));
        }
      });
    }
  }

  it("lets a live course nobody is taking take any change (Release 1 refused most, D57)", () => {
    const o = resolveOutline("cms", null, []);
    const facts: LiveFacts = { status: "published", learners: 0, closed: true };
    const ask = (op: OutlineOp) =>
      predictOutlineOp({ kind: "cms", outline: o, reasons: [], freeKeys: ["simulation", "scenario", "assessment"], op, facts });
    for (const op of [
      { op: "add", choice: "text", at: null, newId: NEW },
      { op: "add", choice: "practice", at: 0, newId: NEW },
      { op: "delete", id: "concept" },
      { op: "hide", id: "concept", hidden: true },
      { op: "move", id: "concept", dir: 1 },
      { op: "rename", id: "context", locale: "en", label: "Start" },
    ] as OutlineOp[]) {
      expect(ask(op), JSON.stringify(op)).toEqual({ allowed: true, verdict: "allowed" });
    }
  });

  it("asks first with learners, and keeps renames open whatever the date", () => {
    const o = resolveOutline("cms", null, []);
    const facts: LiveFacts = { status: "published", learners: 3, closed: true };
    const ask = (op: OutlineOp) => predictOutlineOp({ kind: "cms", outline: o, reasons: [], freeKeys: [], op, facts });
    expect(ask({ op: "move", id: "concept", dir: 1 })).toEqual({ allowed: false, verdict: "restructure-closed" });
    expect(ask({ op: "hide", id: "concept", hidden: true })).toEqual({ allowed: true, verdict: "needs-confirmation" });
    expect(ask({ op: "delete", id: "concept" })).toEqual({ allowed: false, verdict: "has-learners" });
    expect(ask({ op: "rename", id: "context", locale: "en", label: "Start" })).toEqual({ allowed: true, verdict: "allowed" });
  });

  it("offers nothing for a built-in course or a list that can't be read", () => {
    const op: OutlineOp = { op: "rename", id: "context", locale: "en", label: "x" };
    const facts: LiveFacts = { status: "draft", learners: 0, closed: false };
    expect(
      predictOutlineOp({ kind: "bundled", outline: resolveOutline("bundled", null, []), reasons: [], freeKeys: [], op, facts })
    ).toEqual({ allowed: false, verdict: null });
    const broken = resolveOutline("cms", "garbage", []);
    expect(
      predictOutlineOp({ kind: "cms", outline: broken, reasons: [{ code: "unreadable" }], freeKeys: [], op, facts })
    ).toEqual({ allowed: false, verdict: null });
  });
});

describe("predictPartOp", () => {
  it("follows liveRule for every content change, in every column of spec 7.2", () => {
    const ops: LiveOp[] = ["add-part", "move-part", "remove-part", "remove-question"];
    for (const facts of Object.values(FACTS)) {
      for (const op of ops) {
        const verdict = liveRule(op, facts);
        expect(predictPartOp({ reasons: [], op, facts })).toEqual({
          allowed: verdict === "allowed" || verdict === "needs-confirmation",
          verdict,
        });
      }
    }
  });

  it("refuses every content change while something can't be read", () => {
    expect(
      predictPartOp({ reasons: [{ code: "unreadable" }], op: "remove-part", facts: { status: "draft", learners: 0, closed: false } })
    ).toEqual({ allowed: false, verdict: null });
  });
});
