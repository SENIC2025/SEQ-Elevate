import { describe, it, expect, vi, beforeEach } from "vitest";
import { STAGES } from "@/data/course";
import { presentStageKeys } from "../course-derive";
import type { CourseContent } from "../types";
import { LEGACY_FIXTURES, ROW_STATES, STRAY_ROWS } from "./fixtures";
import { newOnlyReasons } from "./guard";
import { applyOutlineOp, canonicalInsertIndex, resolveOutline, toStoredOutline } from "./outline";
import { MAIN_PART } from "./section-parts";
import type { SectionFacts, StoredOutline } from "./contract";

/**
 * The golden properties of Release 1 (spec §3.1–3.3): before any editor
 * screen changes, prove that every course as Release 0 left it is, for the
 * flexible editor, exactly the course its learners get — same lessons, same
 * order, nothing that would block publishing — and that its preview is the
 * learner view itself.
 *
 * "What learners get" is not assumed here: it is the real learner reader
 * (getDbCourse) run on the same rows, alongside presentStageKeys, the rule
 * the dashboard and the course page count by.
 */

vi.mock("server-only", () => ({}));

const state: {
  course: { meta: unknown; status: string; outline: unknown } | null;
  lessons: SectionFacts[];
} = { course: null, lessons: [] };

/** Like Prisma: with a `select`, only the selected columns come back. */
function rowsFor(args: { select?: Record<string, unknown>; include?: Record<string, unknown> } = {}) {
  return state.lessons.map((l) => {
    const full = { documents: [], ...l } as Record<string, unknown>;
    return args.select
      ? Object.fromEntries(Object.entries(full).filter(([k]) => args.select![k]))
      : full;
  });
}

const courseRow = () =>
  state.course && {
    id: "course-1",
    slug: "golden",
    cluster: "communication",
    durationMinutes: 15,
    badge: null,
    copyOverride: null,
    ...state.course,
  };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    course: {
      findFirst: async () => courseRow(),
      findUnique: async () => courseRow(),
    },
    lesson: { findMany: async (args?: { select?: Record<string, unknown> }) => rowsFor(args) },
  },
}));

const { getDbCourse } = await import("../db-course");
const { getPreviewCourse } = await import("../preview-course");

const META = { en: { title: "Golden", tagline: "t", clusterLabel: "c" } };
const ids = (lessons: SectionFacts[], raw: unknown = null) =>
  resolveOutline("cms", raw, lessons).sections.map((s) => s.id);

/** What learners get today: the stages the learner reader plays, in order. */
async function learnerKeys(lessons: SectionFacts[]): Promise<string[]> {
  state.course = { meta: META, status: "published", outline: null };
  state.lessons = lessons;
  const course = await getDbCourse("seq-elevate", "golden", "en");
  return course?.stages.map((s) => s.key) ?? [];
}

/** A seeded generator, so a failure names a combination that can be re-run. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rows for one course: each key in a random state of ROW_STATES, sometimes strays. */
function generated(seed: number): { name: string; lessons: SectionFacts[] } {
  const random = mulberry32(seed);
  const states = Object.keys(ROW_STATES);
  const picked: string[] = [];
  const lessons: SectionFacts[] = [];
  for (const key of STAGES) {
    const s = states[Math.floor(random() * states.length)];
    picked.push(`${key}:${s}`);
    const row = ROW_STATES[s](key);
    if (row) lessons.push(row);
  }
  if (random() < 0.3) lessons.push(STRAY_ROWS[Math.floor(random() * STRAY_ROWS.length)]);
  // The order rows come back in means nothing.
  lessons.sort(() => random() - 0.5);
  return { name: `seed ${seed} (${picked.join(", ")})`, lessons };
}

const GENERATED = Array.from({ length: 400 }, (_, i) => generated(i + 1));
const SINGLE_ROWS = STAGES.flatMap((key) =>
  Object.entries(ROW_STATES).map(([s, make]) => ({
    name: `${key} ${s}`,
    lessons: [make(key)].filter((r): r is SectionFacts => r !== null),
  }))
);
const ALL = [...LEGACY_FIXTURES, ...SINGLE_ROWS, ...GENERATED];

beforeEach(() => {
  state.course = null;
  state.lessons = [];
});

/* ---------------------------------- §3.1 ---------------------------------- */

describe("§3.1 a course as Release 0 left it", () => {
  it("covers every Release 0 test's row shapes and many more", () => {
    expect(LEGACY_FIXTURES.length).toBeGreaterThanOrEqual(20);
    expect(SINGLE_ROWS).toHaveLength(7 * Object.keys(ROW_STATES).length);
  });

  it.each(ALL.map((f) => [f.name, f.lessons] as const))(
    "lists the lessons presentStageKeys counts, and nothing blocks publishing: %s",
    (_name, lessons) => {
      const o = resolveOutline("cms", null, lessons);
      expect(o.sections.map((s) => s.id)).toEqual(presentStageKeys("cms", lessons));
      expect(newOnlyReasons("cms", o, lessons)).toEqual([]);
      expect(o.sections.every((s) => !s.custom && !s.hidden && !s.recovered && s.template === s.id)).toBe(true);
      expect(o).toMatchObject({ materialised: false, removed: [] });
      expect(o.unreadable).toBeUndefined();
    }
  );

  it.each(ALL.filter((_, i) => i % 3 === 0).map((f) => [f.name, f.lessons] as const))(
    "lists exactly the lessons the learner reader plays, in its order: %s",
    async (_name, lessons) => {
      expect(ids(lessons)).toEqual(await learnerKeys(lessons));
    }
  );

  it("gives a built-in course all seven lessons and no reasons, whatever its rows", () => {
    for (const f of ALL) {
      const o = resolveOutline("bundled", null, f.lessons);
      expect(o.sections.map((s) => s.id)).toEqual(presentStageKeys("bundled", f.lessons));
      expect(newOnlyReasons("bundled", o, f.lessons)).toEqual([]);
    }
  });
});

/* ---------------------------------- §3.2 ---------------------------------- */

describe("§3.2 a stored list that only differs in what learners don't see", () => {
  it.each(ALL.map((f) => [f.name, f.lessons] as const))(
    "stays standard stored as derived, with step names, and with empty exercise lessons: %s",
    (_name, lessons) => {
      const derived = resolveOutline("cms", null, lessons);
      const stored = toStoredOutline(derived);

      // Stored exactly as derived (what a rename or "full template" writes).
      const same = resolveOutline("cms", stored, lessons);
      expect(same.sections.map((s) => s.id)).toEqual(presentStageKeys("cms", lessons));
      expect(newOnlyReasons("cms", same, lessons)).toEqual([]);

      // With step names in every language.
      const named: StoredOutline = {
        ...stored,
        sections: stored.sections.map((s, i) => ({
          ...s,
          label: { en: `Step ${i + 1}`, de: `Schritt ${i + 1}`, ...(i % 2 ? { el: `Βήμα ${i + 1}` } : {}) },
        })),
      };
      expect(newOnlyReasons("cms", resolveOutline("cms", named, lessons), lessons)).toEqual([]);

      // With the standard exercise lessons that learners don't get yet
      // listed in their place (the "full" layout).
      const full = { ...stored, sections: [...stored.sections] };
      for (const key of ["simulation", "scenario", "assessment"] as const) {
        if (full.sections.some((s) => s.id === key)) continue;
        full.sections.splice(canonicalInsertIndex(full.sections, key), 0, { id: key, template: key });
      }
      const withPlaceholders = resolveOutline("cms", full, lessons);
      expect(withPlaceholders.sections.map((s) => s.id)).toEqual([...STAGES]);
      expect(newOnlyReasons("cms", withPlaceholders, lessons)).toEqual([]);
    }
  );

  it.each(GENERATED.slice(0, 100).map((f) => [f.name, f.lessons] as const))(
    "stays standard when a page or deploy left a standard lesson out of the stored list: %s",
    (_name, lessons) => {
      const stored = toStoredOutline(resolveOutline("cms", null, lessons));
      for (let drop = 0; drop < stored.sections.length; drop++) {
        const partial = { ...stored, sections: stored.sections.filter((_, i) => i !== drop) };
        const o = resolveOutline("cms", partial, lessons);
        expect(o.sections.map((s) => s.id)).toEqual(presentStageKeys("cms", lessons));
        expect(newOnlyReasons("cms", o, lessons)).toEqual([]);
      }
    }
  );

  it("stays standard after a rename, and after adding an exercise in its standard place", () => {
    const lessons: SectionFacts[] = [];
    let o = resolveOutline("cms", null, lessons);
    const renamed = applyOutlineOp(o, { op: "rename", id: "concept", locale: "de", label: "Die Idee" }, lessons);
    expect(renamed.ok && newOnlyReasons("cms", renamed.outline, lessons)).toEqual([]);
    if (renamed.ok) o = renamed.outline;
    for (const choice of ["practice", "scenario", "quiz"] as const) {
      const added = applyOutlineOp(o, { op: "add", choice, at: null, newId: "s-unused00" }, lessons);
      expect(added.ok && newOnlyReasons("cms", added.outline, lessons)).toEqual([]);
      if (added.ok) o = added.outline;
    }
    expect(o.sections.map((s) => s.id)).toEqual([...STAGES]);
  });

  it("does notice every way a list can differ (the checks above can fail)", () => {
    const lessons = LEGACY_FIXTURES[1].lessons;
    const stored = toStoredOutline(resolveOutline("cms", null, lessons));
    const variants: [string, unknown][] = [
      ["custom", { ...stored, sections: [...stored.sections, { id: "s-abcdefgh", template: "text" }] }],
      ["hidden", { ...stored, sections: stored.sections.map((s, i) => (i === 0 ? { ...s, hidden: true } : s)) }],
      ["removed", { ...stored, sections: stored.sections.slice(1), removed: ["context"] }],
      ["reordered", { ...stored, sections: [...stored.sections].reverse() }],
      ["unreadable", { v: 2 }],
    ];
    for (const [name, raw] of variants) {
      expect(newOnlyReasons("cms", resolveOutline("cms", raw, lessons), lessons), name).not.toEqual([]);
    }
    const extra = [...lessons, { stageKey: "concept", parts: { v: 1, items: [MAIN_PART, { id: "p-aaaaaaaa", type: "text", blocks: {} }] } }];
    expect(newOnlyReasons("cms", resolveOutline("cms", null, extra), extra)).toEqual([
      { code: "extra-parts", sectionId: "concept" },
    ]);
  });

  it("keeps a standard exercise with extra content listed, and blocked, without its exercise (addendum 3)", () => {
    const lessons = [
      { stageKey: "scenario", structure: null, parts: { v: 1, items: [MAIN_PART, { id: "p-aaaaaaaa", type: "text", blocks: {} }] } },
    ];
    const o = resolveOutline("cms", null, lessons);
    expect(o.sections.map((s) => s.id)).toEqual(["context", "concept", "behaviour", "scenario", "reflection"]);
    expect(newOnlyReasons("cms", o, lessons)).toEqual([{ code: "extra-parts", sectionId: "scenario" }]);
  });
});

/* ---------------------------------- §3.3 ---------------------------------- */

const learner = (slug = "golden"): CourseContent => ({
  slug,
  locale: "en",
  cluster: "communication",
  title: "Golden",
  clusterLabel: "c",
  tagline: "t",
  durationMinutes: 15,
  badge: { slug: `${slug}-complete`, name: "Golden", meaning: "t" },
  stages: [],
  completion: { title: "Done", body: "t" },
});

describe("§3.3 the preview of a course learners get as built", () => {
  it.each(LEGACY_FIXTURES.map((f) => [f.name, f.lessons] as const))(
    "is the learner view itself, for a standard draft course: %s",
    async (_name, lessons) => {
      for (const outline of [null, toStoredOutline(resolveOutline("cms", null, lessons))]) {
        state.course = { meta: META, status: "draft", outline };
        state.lessons = lessons;
        const shown = learner();
        for (const locale of ["en", "de", "el"] as const) {
          await expect(getPreviewCourse("seq-elevate", "golden", locale, shown)).resolves.toBe(shown);
        }
      }
    }
  );

  it("is the learner view itself for a built-in course", async () => {
    state.course = { meta: null, status: "published", outline: null };
    const shown = learner("workplace-conflict");
    await expect(getPreviewCourse("seq-elevate", "workplace-conflict", "en", shown)).resolves.toBe(shown);
    state.course = null;
    await expect(getPreviewCourse("seq-elevate", "workplace-conflict", "de", shown)).resolves.toBe(shown);
  });

  it("is the learner view itself for a published course, even one published past the guard", async () => {
    state.course = {
      meta: META,
      status: "published",
      outline: { v: 1, sections: [{ id: "s-abcdefgh", template: "text" }, { id: "concept", template: "concept", hidden: true }] },
    };
    state.lessons = [{ stageKey: "s-abcdefgh", narrative: { en: { title: "Own", blocks: [{ kind: "paragraph", text: "x" }] } } }];
    const shown = learner();
    await expect(getPreviewCourse("seq-elevate", "golden", "en", shown)).resolves.toBe(shown);
  });
});
