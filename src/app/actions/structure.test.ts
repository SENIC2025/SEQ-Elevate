import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { StoredScenario } from "@/lib/cms/structure";

/**
 * The interactive-stage actions against an in-memory lesson row: drafts are
 * always storable for an editor, the save for learners still validates, and
 * neither overwrites a colleague's newer write.
 */

type Row = { structure: unknown; structureDraft: unknown };
const db: {
  roles: string[];
  signedIn: boolean;
  courseMeta: unknown;
  courseStatus: string;
  courseOutline: unknown;
  enrolled: number;
  lesson: Row | null;
  audit: { action: string }[];
  /** The raw queries (locks), in call order. */
  locks: string[];
} = {
  roles: [],
  signedIn: true,
  courseMeta: null,
  courseStatus: "draft",
  courseOutline: null,
  enrolled: 0,
  lesson: null,
  audit: [],
  locks: [],
};

const stored = (v: unknown) =>
  v === Prisma.DbNull ? null : JSON.parse(JSON.stringify(v));

const prisma = {
  course: {
    findFirst: vi.fn(async () =>
      db.courseMeta
        ? { id: "course-1", meta: db.courseMeta, outline: db.courseOutline, status: db.courseStatus }
        : null
    ),
  },
  courseEnrollment: { count: vi.fn(async () => db.enrolled) },
  lesson: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => db.lesson),
    findUnique: vi.fn(async () => db.lesson),
    upsert: vi.fn(async () => {
      db.lesson ??= { structure: null, structureDraft: null };
      return db.lesson;
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      for (const [k, v] of Object.entries(data)) {
        (db.lesson as Record<string, unknown>)[k] = stored(v);
      }
      return db.lesson;
    }),
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (!db.lesson) return { count: 0 };
      for (const [k, v] of Object.entries(data)) {
        (db.lesson as Record<string, unknown>)[k] = stored(v);
      }
      return { count: 1 };
    }),
  },
  auditLog: {
    create: vi.fn(async ({ data }: { data: { action: string } }) => {
      db.audit.push(data);
    }),
  },
  $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
    db.locks.push(strings.join("?"));
    return [];
  }),
  // A failed transaction leaves no trace, as in Postgres.
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const before = db.lesson ? { ...db.lesson } : null;
    try {
      return await fn(prisma);
    } catch (error) {
      db.lesson = before;
      throw error;
    }
  }),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/auth-helpers", () => ({
  getCurrentUser: async () => (db.signedIn ? { id: "editor-1" } : null),
  getProjectMemberships: async () => db.roles.map((role) => ({ role })),
}));

const {
  saveStructure,
  saveStructureDraft,
  discardStructureDraft,
  clearStructure,
  getStructure,
} = await import("./structure");

const SLUG = "my-course";

const complete: StoredScenario = {
  kind: "scenario",
  setup: { en: "A teammate snaps at you." },
  question: { en: "What do you do?" },
  followupQuestion: { en: "And then?" },
  choices: [
    {
      id: "c1",
      quality: "best",
      text: { en: "Talk privately" },
      outcome: { en: "It lands well." },
      followups: [
        { id: "f1", quality: "okay", text: { en: "Listen" }, outcome: { en: "Good." } },
      ],
    },
    { id: "c2", quality: "poor", text: { en: "Call them out" }, outcome: { en: "It escalates." } },
  ],
};

// Half written: the second choice and the follow-up are still blank.
const unfinished: StoredScenario = {
  ...complete,
  choices: [
    {
      ...complete.choices[0],
      followups: [{ id: "f1", quality: "okay", text: {}, outcome: {} }],
    },
    { id: "c2", quality: "poor", text: { en: "" }, outcome: {} },
  ],
};

const nothing = { structure: null, draft: null };

beforeEach(() => {
  db.roles = ["CONTENT_EDITOR"];
  db.signedIn = true;
  db.courseMeta = { en: { title: "My course" } };
  db.courseStatus = "draft";
  db.courseOutline = null;
  db.enrolled = 0;
  db.lesson = null;
  db.audit = [];
  db.locks = [];
});

describe("saveStructureDraft", () => {
  it("keeps an unfinished scenario as a draft, and says what is still missing", async () => {
    const res = await saveStructureDraft(SLUG, "scenario", unfinished, nothing);
    expect(res.ok).toBe(true);
    // In the editor's order: choice 1 and its follow-ups, then choice 2.
    expect(res.ok && res.issues.map((i) => i.code)).toEqual([
      "scenarioFollowupText",
      "scenarioFollowupOutcome",
      "scenarioChoiceText",
      "scenarioChoiceOutcome",
    ]);
    expect(db.lesson?.structureDraft).toMatchObject({ kind: "scenario" });
    // Learners get nothing new: the stage still isn't there for them.
    expect(db.lesson?.structure).toBeNull();
    expect(db.audit.map((a) => a.action)).toEqual(["structure.draft_saved"]);
  });

  it("returns the draft as stored: an emptied language is dropped", async () => {
    const res = await saveStructureDraft(SLUG, "scenario", unfinished, nothing);
    const choice2 = res.ok && res.draft.kind === "scenario" ? res.draft.choices[1] : null;
    expect(choice2?.text).toEqual({});
    expect(db.lesson?.structureDraft).toEqual(res.ok && res.draft);
  });

  it("leaves the version learners see as it is", async () => {
    db.lesson = { structure: complete, structureDraft: null };
    const res = await saveStructureDraft(SLUG, "scenario", unfinished, {
      structure: complete,
      draft: null,
    });
    expect(res.ok).toBe(true);
    expect(db.lesson?.structure).toEqual(complete);
  });

  it("doesn't overwrite a draft someone else saved since the page opened", async () => {
    db.lesson = { structure: null, structureDraft: { ...unfinished, setup: { de: "Neu" } } };
    const res = await saveStructureDraft(SLUG, "scenario", unfinished, {
      structure: null,
      draft: unfinished,
    });
    expect(res).toEqual({ ok: false, error: "changed-elsewhere" });
    expect(db.lesson?.structureDraft).toMatchObject({ setup: { de: "Neu" } });
  });

  it("is for editors on created courses only, like a save", async () => {
    db.roles = ["LEARNER"];
    expect(await saveStructureDraft(SLUG, "scenario", unfinished, nothing)).toEqual({
      ok: false,
      error: "forbidden",
    });
    db.roles = ["CONTENT_EDITOR"];
    db.courseMeta = null;
    expect(await saveStructureDraft(SLUG, "scenario", unfinished, nothing)).toEqual({
      ok: false,
      error: "not-cms-course",
    });
    db.courseMeta = { en: {} };
    expect(await saveStructureDraft(SLUG, "simulation", unfinished, nothing)).toEqual({
      ok: false,
      error: "kind-mismatch",
    });
    expect(
      await saveStructureDraft(SLUG, "scenario", { ...unfinished, choices: "x" } as never, nothing)
    ).toEqual({ ok: false, error: "bad-input" });
    expect(db.lesson).toBeNull();
  });
});

describe("saveStructure", () => {
  it("still refuses an unfinished scenario, naming the exact fields", async () => {
    const res = await saveStructure(SLUG, "scenario", unfinished, nothing);
    expect(res.ok).toBe(false);
    expect(!res.ok && "issues" in res && res.issues).toEqual([
      { code: "scenarioFollowupText", params: { choice: 1, followup: 1 } },
      { code: "scenarioFollowupOutcome", params: { choice: 1, followup: 1 } },
      { code: "scenarioChoiceText", params: { choice: 2 } },
      { code: "scenarioChoiceOutcome", params: { choice: 2 } },
    ]);
    expect(db.lesson).toBeNull();
  });

  it("saves a finished draft for learners and clears the draft", async () => {
    db.lesson = { structure: null, structureDraft: unfinished };
    const res = await saveStructure(SLUG, "scenario", complete, {
      structure: null,
      draft: unfinished,
    });
    expect(res).toEqual({ ok: true, structure: complete });
    expect(db.lesson).toEqual({ structure: complete, structureDraft: null });
    expect(db.audit.map((a) => a.action)).toEqual(["structure.saved"]);
  });

  it("doesn't throw away a draft saved elsewhere since the page opened", async () => {
    db.lesson = { structure: null, structureDraft: unfinished };
    const res = await saveStructure(SLUG, "scenario", complete, nothing);
    expect(res).toEqual({ ok: false, error: "changed-elsewhere" });
    expect(db.lesson).toEqual({ structure: null, structureDraft: unfinished });
  });
});

/*
 * A stage saved before Release 0 had no size limits. One that is over a
 * limit must still save — as a draft and for learners — or an editor
 * couldn't even fix a typo in it.
 */
describe("a stage stored before the limits", () => {
  const longDe = "Lang. ".repeat(400).trim(); // over the 2,000-character limit
  const legacy: StoredScenario = { ...complete, setup: { ...complete.setup, de: longDe } };
  const typoFixed: StoredScenario = {
    ...legacy,
    question: { en: "What do you do now?" },
  };

  it("saves for learners with an edit elsewhere, keeping the long text", async () => {
    db.lesson = { structure: legacy, structureDraft: null };
    const res = await saveStructure(SLUG, "scenario", typoFixed, { structure: legacy, draft: null });
    expect(res).toEqual({ ok: true, structure: typoFixed });
    expect(db.lesson).toEqual({ structure: typoFixed, structureDraft: null });
  });

  it("saves as a draft too", async () => {
    db.lesson = { structure: legacy, structureDraft: null };
    const res = await saveStructureDraft(SLUG, "scenario", typoFixed, {
      structure: legacy,
      draft: null,
    });
    expect(res.ok).toBe(true);
    expect(db.lesson?.structureDraft).toEqual(typoFixed);
  });

  it("refuses the long text grown, saying which box and language, and writes nothing", async () => {
    db.lesson = { structure: legacy, structureDraft: null };
    const grown = { ...legacy, setup: { ...legacy.setup, de: `${longDe} Mehr.` } };
    const res = await saveStructureDraft(SLUG, "scenario", grown, { structure: legacy, draft: null });
    expect(res).toEqual({
      ok: false,
      error: "too-large",
      at: { limit: "text", field: "scenarioSetup", locale: "de", max: 2_000 },
    });
    expect(db.lesson).toEqual({ structure: legacy, structureDraft: null });
  });

  it("gains nothing from a made-up base: the row must still hold it", async () => {
    // The request claims the long text is stored; the row says otherwise.
    db.lesson = { structure: complete, structureDraft: null };
    const res = await saveStructure(SLUG, "scenario", legacy, { structure: legacy, draft: null });
    expect(res).toEqual({ ok: false, error: "changed-elsewhere" });
    expect(db.lesson).toEqual({ structure: complete, structureDraft: null });
  });
});

describe("discardStructureDraft", () => {
  it("drops the draft and keeps what learners see", async () => {
    db.lesson = { structure: complete, structureDraft: unfinished };
    const res = await discardStructureDraft(SLUG, "scenario", {
      structure: complete,
      draft: unfinished,
    });
    expect(res).toEqual({ ok: true });
    expect(db.lesson).toEqual({ structure: complete, structureDraft: null });
  });
});

describe("clearStructure", () => {
  it("removes the stage and its draft", async () => {
    db.lesson = { structure: complete, structureDraft: unfinished };
    const res = await clearStructure(SLUG, "scenario", {
      structure: complete,
      draft: unfinished,
    });
    expect(res).toEqual({ ok: true });
    expect(db.lesson).toEqual({ structure: null, structureDraft: null });
    expect(db.audit.map((a) => a.action)).toEqual(["structure.cleared"]);
  });

  it("doesn't delete a draft a colleague saved since the page opened", async () => {
    // The page opened on the live stage with no draft; a colleague has
    // since saved an unfinished rewrite as a draft.
    db.lesson = { structure: complete, structureDraft: unfinished };
    const res = await clearStructure(SLUG, "scenario", {
      structure: complete,
      draft: null,
    });
    expect(res).toEqual({ ok: false, error: "changed-elsewhere" });
    expect(db.lesson).toEqual({ structure: complete, structureDraft: unfinished });
    expect(db.audit).toEqual([]);
  });

  it("refuses a request without the version it started from", async () => {
    db.lesson = { structure: complete, structureDraft: unfinished };
    expect(await clearStructure(SLUG, "scenario", undefined as never)).toEqual({
      ok: false,
      error: "bad-input",
    });
    expect(db.lesson).toEqual({ structure: complete, structureDraft: unfinished });
  });
});

describe("getStructure", () => {
  it("gives the editor both the structure and the draft", async () => {
    db.lesson = { structure: complete, structureDraft: unfinished };
    expect(await getStructure(SLUG, "scenario")).toEqual({
      structure: complete,
      draft: unfinished,
    });
    db.lesson = null;
    expect(await getStructure(SLUG, "scenario")).toEqual(nothing);
  });
});

/*
 * Release 1 (G6): a lesson of a created course's own ("s-…") whose main
 * content is an exercise is edited with these same actions — only while it
 * is in the course's lesson list, and only with its own kind. Standard
 * lessons keep exactly the Release 0 path: no Course lock.
 */
const COURSE_SHARE = 'SELECT id FROM "Course" WHERE "projectId" = ? AND "slug" = ? FOR SHARE';
const COURSE_UPDATE = 'SELECT id FROM "Course" WHERE "projectId" = ? AND "slug" = ? FOR UPDATE';
const LESSON_LOCK =
  'SELECT id FROM "Lesson" WHERE "projectId" = ? AND "courseSlug" = ? AND "stageKey" = ? FOR UPDATE';
const OWN = "s-abcdefgh";

describe("a lesson of the course's own", () => {
  beforeEach(() => {
    db.courseOutline = {
      v: 1,
      sections: [
        { id: "context", template: "context" },
        { id: OWN, template: "scenario" },
        { id: "s-text0000", template: "text" },
      ],
    };
  });

  it("saves its exercise when it is in the list with that kind, the course locked first", async () => {
    const res = await saveStructure(SLUG, OWN as never, complete, nothing);
    expect(res).toEqual({ ok: true, structure: complete });
    expect(db.lesson).toEqual({ structure: complete, structureDraft: null });
    expect(db.locks).toEqual([COURSE_SHARE, LESSON_LOCK]);
    expect(await getStructure(SLUG, OWN as never)).toEqual({ structure: complete, draft: null });
  });

  it("refuses a lesson that isn't in the list, or isn't an exercise of that kind", async () => {
    expect(await saveStructureDraft(SLUG, "s-zzzzzzzz" as never, unfinished, nothing)).toEqual({
      ok: false,
      error: "not-a-section",
    });
    expect(await saveStructureDraft(SLUG, "s-text0000" as never, unfinished, nothing)).toEqual({
      ok: false,
      error: "kind-mismatch",
    });
    expect(
      await saveStructureDraft(SLUG, OWN as never, { ...complete, kind: "simulation" } as never, nothing)
    ).toEqual({ ok: false, error: "kind-mismatch" });
    expect(await getStructure(SLUG, "s-zzzzzzzz" as never)).toBeNull();
    expect(db.lesson).toBeNull();
  });

  it("refuses when the lesson left the list before the write", async () => {
    // The list is read twice: before the checks (the lesson is there), and
    // again under the Course lock (a colleague has deleted it since).
    const before = db.courseOutline;
    prisma.course.findFirst.mockImplementationOnce(
      async () => ({ id: "course-1", meta: db.courseMeta, outline: before, status: "draft" }) as never
    );
    db.courseOutline = { v: 1, sections: [{ id: "context", template: "context" }] };
    expect(await saveStructureDraft(SLUG, OWN as never, unfinished, nothing)).toEqual({
      ok: false,
      error: "not-a-section",
    });
    expect(db.lesson).toBeNull();
  });

  it("removes its exercise with learners enrolled: learners don't get it before Release 2", async () => {
    db.lesson = { structure: complete, structureDraft: null };
    db.courseStatus = "draft";
    db.enrolled = 3;
    expect(await clearStructure(SLUG, OWN as never, { structure: complete, draft: null })).toEqual({
      ok: true,
    });
    expect(db.lesson).toEqual({ structure: null, structureDraft: null });
  });

  it("leaves the standard lessons' path as it was: no Course lock", async () => {
    await saveStructureDraft(SLUG, "scenario", unfinished, nothing);
    expect(db.locks).toEqual([LESSON_LOCK]);
  });
});

/*
 * G5: "Remove stage" takes away an exercise learners have now. With learners
 * enrolled it is refused, whatever the course's status, as deleteSection is
 * (G4): otherwise unpublishing, removing and publishing again would take the
 * exercise from them in three steps. The Course row is locked FOR UPDATE
 * first, which an enrolment's foreign-key check (FOR KEY SHARE) waits for
 * (addendum 7).
 */
describe("clearStructure and learners (G5)", () => {
  beforeEach(() => {
    db.lesson = { structure: complete, structureDraft: null };
  });
  const base = () => ({ structure: complete, draft: null });

  it("is refused on a published course with learners, and changes nothing", async () => {
    db.courseStatus = "published";
    db.enrolled = 3;
    expect(await clearStructure(SLUG, "scenario", base())).toEqual({
      ok: false,
      error: "has-learners",
      count: 3,
    });
    expect(db.lesson).toEqual({ structure: complete, structureDraft: null });
    expect(db.locks[0]).toBe(COURSE_UPDATE);
    expect(db.audit).toEqual([]);
  });

  it.each(["draft", "archived"])(
    "is refused on a %s course with learners too, so unpublishing doesn't lift it",
    async (status) => {
      db.courseStatus = status;
      db.enrolled = 5;
      expect(await clearStructure(SLUG, "scenario", base())).toEqual({
        ok: false,
        error: "has-learners",
        count: 5,
      });
      expect(db.lesson).toEqual({ structure: complete, structureDraft: null });
      expect(db.audit).toEqual([]);
    }
  );

  it("is allowed with no learners, or when learners have nothing of it", async () => {
    db.courseStatus = "published";
    expect(await clearStructure(SLUG, "scenario", base())).toEqual({ ok: true });

    db.lesson = { structure: complete, structureDraft: null };
    db.courseStatus = "draft";
    expect(await clearStructure(SLUG, "scenario", base())).toEqual({ ok: true });
    db.enrolled = 3;

    // Only a draft: learners have nothing of it to lose.
    db.lesson = { structure: null, structureDraft: unfinished };
    db.courseStatus = "published";
    expect(await clearStructure(SLUG, "scenario", { structure: null, draft: unfinished })).toEqual({
      ok: true,
    });
  });

  it("refuses a course not created here, which it used to write to", async () => {
    db.courseMeta = null;
    expect(await clearStructure(SLUG, "scenario", base())).toEqual({
      ok: false,
      error: "not-cms-course",
    });
    expect(db.lesson).toEqual({ structure: complete, structureDraft: null });
  });
});
