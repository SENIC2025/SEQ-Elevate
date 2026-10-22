import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { STAGES } from "@/data/course";
import { presentStageKeys } from "./course-derive";
import { localProvider } from "./local-provider";
import { LEGACY_FIXTURES } from "./sections/fixtures";
import { newOnlyReasons } from "./sections/guard";
import { resolveOutline, toStoredOutline } from "./sections/outline";
import type { SectionFacts } from "./sections/contract";
import type { CourseContent, Locale } from "./types";

/*
 * U6 (spec 3.2–3.3), golden: the course the learner plays (getLearnerCourse)
 * and the plans every counter uses (getLessonPlans) list the same lessons,
 * in the same order, drawn the same way, under the same names — across
 * every shape a course can have, in every language. And every course
 * Release 1 could publish (no newOnlyReasons) is exactly what its learners
 * got before: presentStageKeys, every lesson by its stage screen, each
 * stage the very object getCourse built.
 *
 * "What learners got" is the real learner reader (getDbCourse) run on the
 * same rows, not an assumption.
 */

vi.mock("server-only", () => ({}));

type Row = SectionFacts & {
  courseSlug?: string;
  documents?: {
    id: string;
    name: string;
    url: string;
    mimeType: string;
    sizeBytes: number;
    published: boolean;
    languages?: string[];
  }[];
};
/** A LessonLink row (Release 4), with the key of its lesson. */
type LinkRow = {
  id: string;
  stageKey: string;
  courseSlug?: string;
  title: string;
  url: string;
  description: string;
  languages: string[];
  published: boolean;
};
const db: {
  courses: { slug: string; meta: unknown; outline: unknown; status: string }[];
  lessons: Row[];
  links: LinkRow[];
  fail: boolean;
} = { courses: [], lessons: [], links: [], fail: false };

/** Like Prisma, for the where and select shapes these readers use. */
function lessonsFor(args: {
  where?: { courseSlug?: string | { in: string[] }; stageKey?: { startsWith: string }; NOT?: { stageKey?: { startsWith: string } } };
  select?: Record<string, unknown>;
}) {
  if (db.fail) throw new Error("db down");
  const w = args.where ?? {};
  return db.lessons
    .filter((l) => {
      const slug = l.courseSlug ?? "golden";
      if (typeof w.courseSlug === "string" && slug !== w.courseSlug) return false;
      if (typeof w.courseSlug === "object" && !w.courseSlug.in.includes(slug)) return false;
      if (w.stageKey && !l.stageKey.startsWith(w.stageKey.startsWith)) return false;
      if (w.NOT?.stageKey && l.stageKey.startsWith(w.NOT.stageKey.startsWith)) return false;
      return true;
    })
    .map((l) => {
      const docs = (l.documents ?? []).filter((d) => d.published);
      const full: Record<string, unknown> = {
        courseSlug: "golden",
        narrative: null,
        structure: null,
        structureDraft: null,
        parts: null,
        video: null,
        ...l,
        documents: docs,
        _count: { documents: docs.length },
      };
      return args.select ? Object.fromEntries(Object.keys(args.select).map((k) => [k, full[k]])) : full;
    });
}

const courseRow = (slug: string) => {
  const c = db.courses.find((x) => x.slug === slug);
  return c && { id: `id-${slug}`, cluster: "communication", durationMinutes: 15, badge: null, copyOverride: null, ...c };
};

const lessonFindMany = vi.fn(async (args) => lessonsFor(args ?? {}));
/** Like Prisma, for the further-reading read: published links of a course's lessons. */
const linkFindMany = vi.fn(async (args: { where: { published?: boolean; lesson: { courseSlug: string } } }) => {
  if (db.fail) throw new Error("db down");
  return db.links
    .filter((l) => (l.courseSlug ?? "golden") === args.where.lesson.courseSlug)
    .filter((l) => args.where.published === undefined || l.published === args.where.published)
    .map((l) => ({
      id: l.id,
      title: l.title,
      url: l.url,
      description: l.description,
      languages: l.languages,
      published: l.published,
      lesson: { stageKey: l.stageKey },
    }));
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    course: {
      findFirst: async (args: { where: { slug: string } }) => {
        if (db.fail) throw new Error("db down");
        return courseRow(args.where.slug) ?? null;
      },
      findMany: async () => db.courses.filter((c) => c.meta !== null).map((c) => courseRow(c.slug)),
    },
    lesson: { findMany: lessonFindMany },
    lessonLink: { findMany: linkFindMany },
    // getLessonPlans: which lessons have a video, as an object (Postgres'
    // jsonb_typeof), without loading it.
    $queryRaw: async (sql: TemplateStringsArray, projectId: string, slugs: string[]) => {
      if (db.fail) throw new Error("db down");
      expect(sql.join("?")).toContain(`jsonb_typeof("video") = 'object'`);
      expect(projectId).toBe("seq-elevate");
      const isObject = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
      return db.lessons
        .filter((l) => slugs.includes(l.courseSlug ?? "golden") && isObject(l.video))
        .map((l) => ({ courseSlug: l.courseSlug ?? "golden", stageKey: l.stageKey }));
    },
  },
}));

const { getDbCourse } = await import("./db-course");
const { getLearnerCourse, getLessonPlans } = await import("./learner-course");

const LOCALES: Locale[] = ["en", "de", "el"];
const META = { en: { title: "Golden", tagline: "t", clusterLabel: "c" }, de: { title: "Golden DE", tagline: "t", clusterLabel: "c" } };
const OWN = "s-abcdefgh";
const OWN2 = "s-00000002";
const para = (text: string) => ({ kind: "paragraph", text });
const MAIN = { id: "main", type: "main" };
const SIM = {
  kind: "simulation",
  prompt: { en: "Hi" },
  instruction: {},
  options: [
    { id: "a", isBest: true, text: { en: "Yes" }, feedback: {} },
    { id: "b", isBest: false, text: { en: "No" }, feedback: {} },
  ],
};
const QUIZ = {
  kind: "assessment",
  intro: { en: "Check" },
  questions: [
    { id: "q1", question: { en: "Why?" }, correctOptionId: "x", options: [{ id: "x", text: { en: "A" } }, { id: "y", text: { en: "B" } }] },
  ],
};
const VIDEO = { provider: "file", src: "https://x/v.mp4", cues: [{ id: "c1", at: 3, question: { en: "Why?" } }] };
const narrative = (title: string) => ({ en: { title, blocks: [para(`${title} text`)] }, de: { title: `${title} DE` } });

/** The lessons a standard created course has. */
const STANDARD: Row[] = [
  { stageKey: "context", narrative: narrative("Context") },
  { stageKey: "concept", narrative: narrative("Concept") },
  { stageKey: "simulation", structure: SIM },
  { stageKey: "assessment", structure: QUIZ },
];
const stored = (rows: Row[]) => toStoredOutline(resolveOutline("cms", null, rows));

interface Case {
  name: string;
  outline: unknown;
  lessons: Row[];
  env?: Record<string, string>;
}

const CASES: Case[] = [
  { name: "null outline", outline: null, lessons: STANDARD },
  { name: "stored as derived", outline: stored(STANDARD), lessons: STANDARD },
  {
    name: "labels only",
    outline: {
      ...stored(STANDARD),
      sections: stored(STANDARD).sections.map((s) => ({ ...s, label: { en: `My ${s.id}`, el: `Το ${s.id}` } })),
    },
    lessons: STANDARD,
  },
  {
    name: "own lesson",
    outline: { v: 1, sections: [...stored(STANDARD).sections.slice(0, 2), { id: OWN, template: "text", label: { en: "Own" } }, ...stored(STANDARD).sections.slice(2)] },
    lessons: [...STANDARD, { stageKey: OWN, narrative: { en: { title: "Own", blocks: [para("Mine")] } } }],
  },
  {
    name: "an own lesson with nothing in it yet",
    outline: { v: 1, sections: [...stored(STANDARD).sections, { id: OWN2, template: "quiz" }] },
    lessons: [...STANDARD, { stageKey: OWN2, structureDraft: QUIZ }],
  },
  {
    name: "hidden",
    outline: { v: 1, sections: stored(STANDARD).sections.map((s) => (s.id === "concept" ? { ...s, hidden: true } : s)) },
    lessons: STANDARD,
  },
  {
    name: "reordered",
    outline: { v: 1, sections: [...stored(STANDARD).sections].reverse() },
    lessons: STANDARD,
  },
  {
    name: "deleted standard",
    outline: { v: 1, sections: stored(STANDARD).sections.filter((s) => s.id !== "behaviour"), removed: ["behaviour"] },
    lessons: STANDARD,
  },
  {
    name: "extra parts",
    outline: stored(STANDARD),
    lessons: STANDARD.map((l) =>
      l.stageKey === "concept"
        ? {
            ...l,
            parts: {
              v: 1,
              items: [MAIN, { id: "p-12345678", type: "text", blocks: { de: [para("Mehr")] } }, { id: "p-quiz0001", type: "quiz", data: QUIZ, draft: null }],
            },
            documents: [{ id: "d1", name: "a.pdf", url: "https://x/a.pdf", mimeType: "application/pdf", sizeBytes: 1, published: true }],
          }
        : l
    ),
  },
  {
    name: "own reflection questions replace the standard ones",
    outline: stored(STANDARD),
    lessons: [
      ...STANDARD,
      {
        stageKey: "reflection",
        parts: {
          v: 1,
          items: [MAIN, { id: "p-reflect1", type: "reflection", data: { kind: "reflection", prompts: [{ id: "r1", label: { en: "Mine?" } }] }, draft: null }],
        },
      },
    ],
  },
  {
    name: "an own lesson with only a video, and one whose video isn't one",
    outline: { v: 1, sections: [...stored(STANDARD).sections, { id: OWN, template: "text" }, { id: OWN2, template: "text" }] },
    lessons: [
      ...STANDARD,
      { stageKey: OWN, narrative: { en: { title: "Watch" } }, video: VIDEO },
      { stageKey: OWN2, narrative: { en: { title: "Broken" } }, video: "not a video" },
    ],
  },
  {
    // Release 4 (D108): languages never change which lessons there are.
    name: "documents for one language only, and a lesson with nothing but further reading",
    outline: { v: 1, sections: [...stored(STANDARD).sections, { id: OWN, template: "text" }, { id: OWN2, template: "text" }] },
    lessons: [
      ...STANDARD.map((l) =>
        l.stageKey === "concept"
          ? {
              ...l,
              parts: { v: 1, items: [MAIN, { id: "p-12345678", type: "text", blocks: { en: [para("More")] } }] },
              documents: [
                { id: "d-de", name: "de.pdf", url: "https://x/de.pdf", mimeType: "application/pdf", sizeBytes: 1, published: true, languages: ["de"] },
                { id: "d-en", name: "en.pdf", url: "https://x/en.pdf", mimeType: "application/pdf", sizeBytes: 1, published: true, languages: ["en"] },
              ],
            }
          : l
      ),
      {
        stageKey: OWN,
        narrative: { en: { title: "Worksheet" } },
        documents: [{ id: "d-only", name: "nur.pdf", url: "https://x/nur.pdf", mimeType: "application/pdf", sizeBytes: 1, published: true, languages: ["de"] }],
      },
      { stageKey: OWN2, narrative: { en: { title: "Reading only" } } },
    ],
  },
  { name: "unreadable outline", outline: { v: 7, sections: "x" }, lessons: STANDARD },
  {
    name: "unreadable parts",
    outline: stored(STANDARD),
    lessons: STANDARD.map((l) => (l.stageKey === "simulation" ? { ...l, parts: "garbage" } : l)),
  },
  {
    name: "kill switch",
    outline: { v: 1, sections: [{ id: OWN, template: "text" }, ...[...stored(STANDARD).sections].reverse()] },
    lessons: [...STANDARD, { stageKey: OWN, narrative: { en: { title: "Own", blocks: [para("Mine")] } } }],
    env: { R2_LEARNER_PLAYER: "off" },
  },
  {
    name: "full template, exercises not written",
    outline: toStoredOutline({
      sections: STAGES.map((id) => ({ id, template: id, custom: false })),
      removed: [],
      materialised: true,
    }),
    lessons: [],
  },
  ...LEGACY_FIXTURES.map((f) => ({ name: `Release 0: ${f.name}`, outline: null, lessons: f.lessons as Row[] })),
];

function setCourse(c: Case) {
  db.courses = [{ slug: "golden", meta: META, outline: c.outline, status: "published" }];
  db.lessons = c.lessons.map((l) => ({ ...l, courseSlug: "golden" }));
}

const savedEnv = { ...process.env };
beforeEach(() => {
  db.courses = [];
  db.lessons = [];
  db.links = [];
  db.fail = false;
  lessonFindMany.mockClear();
  linkFindMany.mockClear();
});
afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("getLearnerCourse and getLessonPlans agree (golden)", () => {
  for (const c of CASES) {
    for (const locale of LOCALES) {
      it(`${c.name} (${locale})`, async () => {
        Object.assign(process.env, c.env ?? {});
        setCourse(c);
        const base = (await getDbCourse("seq-elevate", "golden", locale)) as CourseContent;
        // A stored exercise the reader can't resolve fails the whole course,
        // as it did in Release 0 (getCourse is null: the page is a 404).
        if (!base) return;
        const learner = await getLearnerCourse("seq-elevate", "golden", locale, base);
        const plan = (await getLessonPlans("seq-elevate", locale)).get("golden")!;

        expect(learner.lessons.map((l) => [l.id, l.kind, l.label, l.lang])).toEqual(
          plan.lessons.map((l) => [l.id, l.kind, l.label, l.lang])
        );
        expect(learner.unseen).toEqual(plan.unseen);
        // A stage lesson is the very stage getCourse built.
        for (const l of learner.lessons) {
          if (l.kind === "stage") expect(base.stages).toContain(l.stage);
          else expect(l.section.skipped).toBe(0);
        }

        const rows = c.lessons;
        const standard =
          c.env?.R2_LEARNER_PLAYER === "off" ||
          newOnlyReasons("cms", resolveOutline("cms", c.outline, rows), rows).length === 0;
        if (standard) {
          expect(learner.lessons.map((l) => l.id)).toEqual(presentStageKeys("cms", rows as SectionFacts[]));
          expect(learner.lessons.map((l) => l.id)).toEqual(base.stages.map((s) => s.key));
          expect(learner.lessons.every((l) => l.kind === "stage")).toBe(true);
        }
      });
    }
  }

  it("covers both kinds of lesson and both outcomes of the standard check", () => {
    const kinds = new Set<string>();
    for (const c of CASES) {
      const rows = c.lessons;
      kinds.add(newOnlyReasons("cms", resolveOutline("cms", c.outline, rows), rows).length ? "flexible" : "standard");
    }
    expect([...kinds].sort()).toEqual(["flexible", "standard"]);
  });
});

describe("getLearnerCourse", () => {
  it("gives a built-in course's seven stages by their stage screens, with the standard names", async () => {
    for (const locale of LOCALES) {
      const base = (await localProvider.getCourse("seq-elevate", "workplace-conflict", locale))!;
      const learner = await getLearnerCourse("seq-elevate", "workplace-conflict", locale, base);
      expect(learner.lessons.map((l) => l.id)).toEqual(STAGES);
      expect(learner.lessons.every((l, i) => l.kind === "stage" && l.stage === base.stages[i])).toBe(true);
      expect(learner.unseen).toEqual([]);
      expect(learner.title).toBe(base.title);
      expect("stages" in learner).toBe(false);
    }
    expect(lessonFindMany).not.toHaveBeenCalled();
  });

  it("draws the course's own lessons and lessons with extra content by the sectioned view", async () => {
    setCourse(CASES.find((c) => c.name === "extra parts")!);
    const base = (await getDbCourse("seq-elevate", "golden", "en"))!;
    const learner = await getLearnerCourse("seq-elevate", "golden", "en", base);
    const concept = learner.lessons.find((l) => l.id === "concept");
    expect(concept?.kind).toBe("section");
    if (concept?.kind !== "section") return;
    expect(concept.section.parts.map((p) => [p.id, p.type])).toEqual([
      ["main", "text"],
      ["p-12345678", "text"],
      ["p-quiz0001", "quiz"],
    ]);
    expect(concept.section.documents?.map((d) => d.id)).toEqual(["d1"]);
    expect(concept.label).toBe("Skill concept");
  });

  it("says the language of a step name that isn't the page's, as the plan does (WCAG 3.1.2)", async () => {
    // Review finding 6 on Stream A: "Own" is named in English only, and the
    // player showed it on Greek pages with nothing to say so.
    setCourse(CASES.find((c) => c.name === "own lesson")!);
    const langs = async (locale: Locale) => {
      const base = (await getDbCourse("seq-elevate", "golden", locale))!;
      return (await getLearnerCourse("seq-elevate", "golden", locale, base)).lessons.map((l) => [l.label, l.lang]);
    };
    expect((await langs("el")).find(([label]) => label === "Own")).toEqual(["Own", "en"]);
    expect((await langs("el")).filter(([, lang]) => lang !== undefined)).toHaveLength(1);
    expect((await langs("en")).every(([, lang]) => lang === undefined)).toBe(true);
    // A built-in course's names are always the page's.
    const base = (await localProvider.getCourse("seq-elevate", "workplace-conflict", "el"))!;
    const builtIn = await getLearnerCourse("seq-elevate", "workplace-conflict", "el", base);
    expect(builtIn.lessons.every((l) => l.lang === undefined)).toBe(true);
  });

  it("keeps the count of content left out for an editor's preview only", async () => {
    setCourse({
      name: "draft part",
      outline: stored(STANDARD),
      lessons: STANDARD.map((l) =>
        l.stageKey === "context"
          ? { ...l, parts: { v: 1, items: [MAIN, { id: "p-quiz0001", type: "quiz", data: null, draft: QUIZ }] } }
          : l
      ),
    });
    const base = (await getDbCourse("seq-elevate", "golden", "en"))!;
    const ctx = async (editor: boolean) =>
      (await getLearnerCourse("seq-elevate", "golden", "en", base, { editor })).lessons.find((l) => l.id === "context");
    const learner = await ctx(false);
    const editor = await ctx(true);
    expect(learner?.kind === "section" && learner.section.skipped).toBe(0);
    expect(editor?.kind === "section" && editor.section.skipped).toBe(1);
  });

  it("names the standard reflection questions when the lesson's own replace them", async () => {
    setCourse(CASES.find((c) => c.name === "own reflection questions replace the standard ones")!);
    const base = (await getDbCourse("seq-elevate", "golden", "de"))!;
    const reflection = (await getLearnerCourse("seq-elevate", "golden", "de", base)).lessons.find(
      (l) => l.id === "reflection"
    );
    expect(reflection?.kind).toBe("section");
    expect(reflection?.kind === "section" && reflection.replacedPrompts).toEqual([
      { id: "p1", label: "Was ist gut gelaufen?" },
      { id: "p2", label: "Was war schwierig?" },
      { id: "p3", label: "Was probierst du beim nächsten Mal?" },
    ]);
  });

  it("gives the standard lessons, and logs, when anything fails (D18)", async () => {
    setCourse(CASES[0]);
    const base = (await getDbCourse("seq-elevate", "golden", "en"))!;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.fail = true;
    const learner = await getLearnerCourse("seq-elevate", "golden", "en", base);
    expect(learner.lessons.map((l) => [l.id, l.kind])).toEqual(base.stages.map((s) => [s.key, "stage"]));
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("getLessonPlans", () => {
  it("plans every created course, reading the standard lessons' rows without their text", async () => {
    db.courses = [
      { slug: "golden", meta: META, outline: null, status: "published" },
      { slug: "other", meta: META, outline: { v: 1, sections: [{ id: OWN, template: "text" }], removed: ["context", "concept", "behaviour", "reflection"] }, status: "draft" },
    ];
    db.lessons = [
      ...STANDARD.map((l) => ({ ...l, courseSlug: "golden" })),
      { stageKey: OWN, courseSlug: "other", narrative: { en: { title: "Own", blocks: [para("x")] } } },
    ];
    const plans = await getLessonPlans("seq-elevate", "en");
    expect([...plans.keys()]).toEqual(["golden", "other"]);
    expect(plans.get("golden")!.lessons.map((l) => l.id)).toEqual(["context", "concept", "behaviour", "simulation", "reflection", "assessment"]);
    expect(plans.get("other")!.lessons).toEqual([{ id: OWN, kind: "section", label: "Own" }]);
    const selects = lessonFindMany.mock.calls.map((c) => c[0] as { where: { stageKey?: unknown }; select: Record<string, unknown> });
    expect(selects).toHaveLength(2);
    expect(selects.find((s) => !s.where.stageKey)?.select.narrative).toBeUndefined();
    expect(selects.find((s) => s.where.stageKey)?.select.narrative).toBe(true);
  });

  it("tells which lessons have a video without loading any video (spec 3.3), as the player reads one", async () => {
    db.courses = [
      {
        slug: "golden",
        meta: META,
        outline: { v: 1, sections: [{ id: OWN, template: "text" }, { id: OWN2, template: "text" }], removed: [...STAGES] },
        status: "published",
      },
    ];
    db.lessons = [
      { stageKey: OWN, courseSlug: "golden", narrative: { en: { title: "Watch" } }, video: VIDEO },
      { stageKey: OWN2, courseSlug: "golden", narrative: { en: { title: "Broken" } }, video: ["not", "a", "video"] },
    ];
    const plan = (await getLessonPlans("seq-elevate", "en")).get("golden")!;
    expect(plan.lessons.map((l) => l.id)).toEqual([OWN]);
    expect(plan.unseen).toEqual([OWN2]);
    const selects = lessonFindMany.mock.calls.map((c) => (c[0] as { select: Record<string, unknown> }).select);
    expect(selects).toHaveLength(2);
    for (const select of selects) expect(select.video).toBeUndefined();
  });

  it("follows the kill switch", async () => {
    process.env.R2_LEARNER_PLAYER = "off";
    db.courses = [{ slug: "golden", meta: META, outline: { v: 1, sections: [{ id: OWN, template: "text" }, ...stored(STANDARD).sections] }, status: "published" }];
    db.lessons = [...STANDARD, { stageKey: OWN, narrative: { en: { blocks: [para("x")] } } }].map((l) => ({ ...l, courseSlug: "golden" }));
    const plan = (await getLessonPlans("seq-elevate", "en")).get("golden")!;
    expect(plan.lessons.map((l) => l.id)).toEqual(presentStageKeys("cms", STANDARD as SectionFacts[]));
    expect(plan.unseen).toEqual([OWN]);
  });

  it("is empty with no created course", async () => {
    expect((await getLessonPlans("seq-elevate", "en")).size).toBe(0);
    expect(lessonFindMany).not.toHaveBeenCalled();
  });
});

/*
 * U11, Release 4 (D107, D108; spec 4.2, 4.4): further reading never makes a
 * lesson, and documents and links follow the languages a learner reads in:
 * the course text's (`locale`) and the page's (`requested`). Which lessons
 * there are, and what counts, stays the same in every language.
 */
describe("getLearnerCourse: further reading and languages (Release 4)", () => {
  const doc = (id: string, languages: string[]) => ({
    id,
    name: `${id}.pdf`,
    url: `https://x/${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1,
    published: true,
    languages,
  });
  const link = (id: string, stageKey: string, languages: string[], url = `https://example.org/${id}`): LinkRow => ({
    id,
    stageKey,
    title: `Reading ${id}`,
    url,
    description: "",
    languages,
    published: true,
  });
  /** A course with a text lesson of its own carrying documents and links for every language, German and English. */
  function mixed() {
    db.courses = [{ slug: "golden", meta: META, outline: { v: 1, sections: [{ id: OWN, template: "text" }], removed: [...STAGES] }, status: "published" }];
    db.lessons = [
      {
        stageKey: OWN,
        courseSlug: "golden",
        narrative: { en: { title: "Own", blocks: [para("Mine")] }, de: { title: "Eigen", blocks: [para("Meins")] } },
        documents: [doc("all", []), doc("de", ["de"]), doc("en", ["en"]), doc("de-el", ["de", "el"])],
      },
    ];
    db.links = [link("l-all", OWN, []), link("l-de", OWN, ["de"]), link("l-en", OWN, ["en"])];
  }
  async function shown(locale: Locale, requested?: Locale) {
    const base = (await getDbCourse("seq-elevate", "golden", locale))!;
    const learner = await getLearnerCourse("seq-elevate", "golden", locale, base, requested ? { requested } : undefined);
    const own = learner.lessons.find((l) => l.id === OWN);
    if (own?.kind !== "section") throw new Error("no section");
    return {
      documents: own.section.documents?.map((d) => d.id),
      links: own.section.links?.map((l) => l.id),
    };
  }

  it("gives each learner the items for every language and for the languages they read in (spec 4.2's table)", async () => {
    mixed();
    // An English learner.
    expect(await shown("en")).toEqual({ documents: ["all", "en"], links: ["l-all", "l-en"] });
    // A German learner on a course still shown in English: German items too.
    expect(await shown("en", "de")).toEqual({ documents: ["all", "de", "en", "de-el"], links: ["l-all", "l-de", "l-en"] });
    // A German learner once German is switched on, and the German preview.
    expect(await shown("de", "de")).toEqual({ documents: ["all", "de", "de-el"], links: ["l-all", "l-de"] });
    expect(await shown("de")).toEqual({ documents: ["all", "de", "de-el"], links: ["l-all", "l-de"] });
    // A Greek learner on a course shown in English.
    expect(await shown("en", "el")).toEqual({ documents: ["all", "en", "de-el"], links: ["l-all", "l-en"] });
  });

  it("gives every item in every language with R4_ITEM_LANGUAGE=off", async () => {
    mixed();
    process.env.R4_ITEM_LANGUAGE = "off";
    expect(await shown("en")).toEqual({ documents: ["all", "de", "en", "de-el"], links: ["l-all", "l-de", "l-en"] });
  });

  it("gives no further reading with R4_FURTHER_READING=off, and doesn't read it", async () => {
    mixed();
    process.env.R4_FURTHER_READING = "off";
    expect((await shown("en")).links).toBeUndefined();
    expect(linkFindMany).not.toHaveBeenCalled();
  });

  it("never draws a stored address the check refuses: it doesn't reach the player", async () => {
    mixed();
    db.links = [
      link("ok", OWN, [], "HTTPS://Example.org/Ok"),
      link("js", OWN, [], "javascript:alert(1)"),
      link("data", OWN, [], "data:text/html,<script>alert(1)</script>"),
      link("text", OWN, [], "not an address"),
      link("empty", OWN, [], ""),
      { ...link("draft", OWN, []), published: false },
    ];
    const base = (await getDbCourse("seq-elevate", "golden", "en"))!;
    const learner = await getLearnerCourse("seq-elevate", "golden", "en", base);
    const own = learner.lessons.find((l) => l.id === OWN);
    expect(own?.kind === "section" && own.section.links).toEqual([
      { id: "ok", title: "Reading ok", url: "https://example.org/Ok", kind: "web", description: "", languages: [], published: true },
    ]);
    const payload = JSON.stringify(learner);
    for (const hostile of ["javascript:", "data:text", "not an address", "Reading draft"]) expect(payload).not.toContain(hostile);
  });

  it("never makes a lesson of further reading alone (D107)", async () => {
    db.courses = [{ slug: "golden", meta: META, outline: { v: 1, sections: [{ id: OWN, template: "text" }, { id: OWN2, template: "text" }], removed: [...STAGES] }, status: "published" }];
    db.lessons = [
      { stageKey: OWN, courseSlug: "golden", narrative: { en: { title: "Own", blocks: [para("Mine")] } } },
      { stageKey: OWN2, courseSlug: "golden", narrative: { en: { title: "Reading only" } } },
    ];
    db.links = [link("l1", OWN2, []), link("l2", OWN2, ["en"])];
    for (const locale of LOCALES) {
      const base = (await getDbCourse("seq-elevate", "golden", locale))!;
      const learner = await getLearnerCourse("seq-elevate", "golden", locale, base);
      const plan = (await getLessonPlans("seq-elevate", locale)).get("golden")!;
      expect(learner.lessons.map((l) => l.id)).toEqual([OWN]);
      expect(learner.unseen).toEqual([OWN2]);
      expect(plan.lessons.map((l) => l.id)).toEqual([OWN]);
    }
  });

  it("shows a lesson whose only material is a German document to everyone, the document with it (the fallback)", async () => {
    db.courses = [{ slug: "golden", meta: META, outline: { v: 1, sections: [{ id: OWN, template: "text" }], removed: [...STAGES] }, status: "published" }];
    db.lessons = [{ stageKey: OWN, courseSlug: "golden", narrative: { en: { title: "Worksheet" } }, documents: [doc("nur", ["de"])] }];
    for (const [locale, requested] of [["en", "en"], ["en", "el"], ["el", "el"], ["de", "de"]] as const) {
      expect((await shown(locale, requested)).documents, `${locale}/${requested}`).toEqual(["nur"]);
    }
  });

  it("filters a stage lesson's documents and links too, in its fail-open path as well", async () => {
    setCourse(CASES[0]);
    const base = (await getDbCourse("seq-elevate", "golden", "en"))!;
    const withMaterial = {
      ...base,
      stages: base.stages.map((st) =>
        st.key === "context"
          ? {
              ...st,
              documents: [doc("all", []), doc("de", ["de"]), doc("en", ["en"])],
              links: [
                { id: "l-de", title: "R", url: "https://example.org/de", kind: "web", description: "", languages: ["de"], published: true },
                { id: "l-all", title: "R", url: "https://example.org/all", kind: "web", description: "", languages: [], published: true },
              ],
            }
          : st
      ),
    } as CourseContent;
    const context = async (requested: Locale) => {
      const learner = await getLearnerCourse("seq-elevate", "golden", "en", withMaterial, { requested });
      const l = learner.lessons.find((x) => x.id === "context");
      if (l?.kind !== "stage") throw new Error("not a stage");
      return l.stage as typeof l.stage & { links?: { id: string }[] };
    };
    expect((await context("en")).documents?.map((d) => d.id)).toEqual(["all", "en"]);
    expect((await context("en")).links?.map((l) => l.id)).toEqual(["l-all"]);
    expect((await context("de")).documents?.map((d) => d.id)).toEqual(["all", "de", "en"]);
    // A stage with nothing left out is the very stage getCourse built.
    const untouched = await getLearnerCourse("seq-elevate", "golden", "en", withMaterial, { requested: "en" });
    expect(untouched.lessons.find((l) => l.id === "concept")).toMatchObject({ stage: withMaterial.stages.find((st) => st.key === "concept") });
    // Fail open (D18): still filtered.
    db.fail = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await context("en")).documents?.map((d) => d.id)).toEqual(["all", "en"]);
    expect(log).toHaveBeenCalled();
  });

  it("filters a built-in course's stages", async () => {
    const base = (await localProvider.getCourse("seq-elevate", "workplace-conflict", "en"))!;
    const withDocs = { ...base, stages: base.stages.map((st, i) => (i === 0 ? { ...st, documents: [doc("de", ["de"]), doc("en", ["en"])] } : st)) };
    const learner = await getLearnerCourse("seq-elevate", "workplace-conflict", "en", withDocs);
    const first = learner.lessons[0];
    expect(first.kind === "stage" && first.stage.documents?.map((d) => d.id)).toEqual(["en"]);
  });
});
