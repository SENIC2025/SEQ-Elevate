import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, lockOrderOk, prisma, reset, row } from "./sections-test-db";
import { partsOrderVersion, itemVersion, partVersions, textPartVersion } from "@/lib/cms/sections/versions";
import { partsOf } from "@/lib/cms/sections/section-parts";
import type { PartBase, StoredPart, StoredReflection, StoredRating } from "@/lib/cms/sections/contract";
import type { StoredScenario } from "@/lib/cms/structure";

/*
 * A lesson's extra content (spec 8.2) against an in-memory course: adding,
 * moving and removing content is a change to the lesson (Course FOR UPDATE,
 * then the Lesson; G3; the whole outline back); saving a text or a question
 * is a save inside it (Course FOR SHARE, then the Lesson) with Release 0's
 * draft model per piece of content (D52), fingerprint bases, and what is
 * stored already allowed to stay over a limit.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/auth-helpers", () => ({
  getCurrentUser: async () => (db.signedIn ? { id: "editor-1" } : null),
  getProjectMemberships: async () => db.roles.map((role) => ({ role })),
}));
vi.mock("@/lib/cms/course-admin", () => ({
  getCourseOutline: async (slug: string) => ({ fresh: slug }),
}));

const {
  getPart,
  addPart,
  movePart,
  removePart,
  savePartText,
  savePart,
  savePartDraft,
  discardPartDraft,
} = await import("./parts");

const SLUG = "my-course";
const MAIN = { id: "main", type: "main" } as const;
const T1 = "p-text0001";
const Q1 = "p-quiz0001";

const para = (text: string) => ({ kind: "paragraph" as const, text });
const reflection = (labels: string[]): StoredReflection => ({
  kind: "reflection",
  prompts: labels.map((l, i) => ({ id: `q${i + 1}`, label: { en: l } })),
});
const scenario: StoredScenario = {
  kind: "scenario",
  setup: { en: "A teammate snaps at you." },
  question: { en: "What do you do?" },
  followupQuestion: {},
  choices: [
    { id: "c1", quality: "best", text: { en: "Talk privately" }, outcome: { en: "Good." } },
    { id: "c2", quality: "poor", text: { en: "Call them out" }, outcome: { en: "Bad." } },
  ],
};

/** The concept lesson with these items (main included). */
function concept(items: StoredPart[]) {
  db.lessons = [row("concept", { narrative: { en: { title: "C" } }, parts: { v: 1, items } })];
}
const items = (key = "concept") => {
  const p = partsOf(db.lessons.find((l) => l.stageKey === key)?.parts);
  if (p === "unreadable") throw new Error("unreadable");
  return p;
};
const item = (id: string) => items().find((i) => i.id === id)!;
const order = (key = "concept") => partsOrderVersion(items(key));
const nothing: PartBase = { data: null, draft: null };

beforeEach(() => {
  reset();
});

describe("every content action", () => {
  it("is for editors only", async () => {
    db.roles = ["LEARNER"];
    const forbidden = { ok: false, error: "forbidden" };
    expect(await addPart(SLUG, "concept", "text", null, order())).toEqual(forbidden);
    expect(await movePart(SLUG, "concept", "main", 1, order())).toEqual(forbidden);
    expect(await removePart(SLUG, "concept", T1, order(), null)).toEqual(forbidden);
    expect(await savePartText(SLUG, "concept", T1, "en", [], null)).toEqual(forbidden);
    expect(await savePart(SLUG, "concept", Q1, scenario, nothing)).toEqual(forbidden);
    expect(await savePartDraft(SLUG, "concept", Q1, scenario, nothing)).toEqual(forbidden);
    expect(await discardPartDraft(SLUG, "concept", Q1, nothing)).toEqual(forbidden);
    expect(await getPart(SLUG, "concept", Q1)).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses arguments no page sends", async () => {
    const bad = { ok: false, error: "bad-input" };
    expect(await addPart(SLUG, "concept", "video" as never, null, order())).toEqual(bad);
    expect(await addPart(SLUG, "concept", "text", "p-NOPE" as never, order())).toEqual(bad);
    expect(await addPart(SLUG, "s-x" as never, "text", null, order())).toEqual(bad);
    expect(await movePart(SLUG, "concept", "main", 0 as never, order())).toEqual(bad);
    expect(await removePart(SLUG, "concept", T1, order(), 3 as never)).toEqual(bad);
    expect(await savePartText(SLUG, "concept", T1, "fr" as never, [], null)).toEqual({
      ok: false,
      error: "bad-locale",
    });
    expect(await savePart(SLUG, "concept", Q1, scenario, { data: 1 } as never)).toEqual(bad);
    expect(await savePart("../x", "concept", Q1, scenario, nothing)).toEqual(bad);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("sends the main content to its own editor", async () => {
    const own = { ok: false, error: "use-main-editor" };
    expect(await savePart(SLUG, "concept", "main" as never, scenario, nothing)).toEqual(own);
    expect(await savePartDraft(SLUG, "concept", "main" as never, scenario, nothing)).toEqual(own);
    expect(await discardPartDraft(SLUG, "concept", "main" as never, nothing)).toEqual(own);
    expect(await savePartText(SLUG, "concept", "main" as never, "en", [], null)).toEqual(own);
    expect(await removePart(SLUG, "concept", "main" as never, order(), null)).toEqual({
      ok: false,
      error: "main-required",
    });
  });

  it("refuses a lesson that isn't in the list, and content that isn't in the lesson", async () => {
    expect(await addPart(SLUG, "simulation", "text", null, order())).toEqual({
      ok: false,
      error: "not-a-section",
    });
    expect(await savePartText(SLUG, "concept", T1, "en", [], null)).toEqual({
      ok: false,
      error: "unknown-part",
    });
    expect(await movePart(SLUG, "concept", T1, 1, order())).toEqual({ ok: false, error: "unknown-part" });
  });

  it("changes nothing in a lesson whose content can't be read (G8)", async () => {
    db.lessons = [row("concept", { parts: { v: 1, items: [MAIN, { id: T1, type: "text" }] } })];
    expect(await addPart(SLUG, "concept", "text", null, "x")).toEqual({
      ok: false,
      error: "outline-unreadable",
    });
    expect(await savePartText(SLUG, "concept", T1, "en", [], null)).toEqual({
      ok: false,
      error: "outline-unreadable",
    });
  });

  it("takes the Course lock first: FOR UPDATE to change the list, FOR SHARE to save inside it", async () => {
    concept([MAIN, { id: T1, type: "text", blocks: {} }, { id: Q1, type: "quiz", data: null, draft: null }]);
    const runs: [string, () => Promise<unknown>][] = [
      ["update", () => addPart(SLUG, "concept", "text", null, order())],
      ["update", () => movePart(SLUG, "concept", "main", 1, order())],
      ["update", () => removePart(SLUG, "concept", T1, order(), itemVersion(item(T1)))],
      ["share", () => savePart(SLUG, "concept", Q1, scenario, nothing)],
    ];
    for (const [mode, run] of runs) {
      db.log = [];
      await run();
      expect(db.log.slice(0, 3)).toEqual([
        `lock Course ${mode}`,
        "upsert Lesson:concept",
        "lock Lesson:concept update",
      ]);
      expect(lockOrderOk()).toBe(true);
    }
  });
});

describe("addPart", () => {
  it("adds text at the top, and a question after a part, returning the whole outline", async () => {
    const res = await addPart(SLUG, "concept", "text", null, order());
    expect(res).toMatchObject({ ok: true, outline: { fresh: SLUG } });
    const textId = (res.ok && res.id) || "";
    expect(textId).toMatch(/^p-[a-z0-9]{8}$/);
    expect(items()).toEqual([{ id: textId, type: "text", blocks: {} }, MAIN]);

    const quiz = await addPart(SLUG, "concept", "quiz", "main", order());
    const quizId = (quiz.ok && quiz.id) || "";
    expect(items().map((i) => i.id)).toEqual([textId, "main", quizId]);
    // A question starts as a draft: learners and the preview get nothing yet.
    expect(item(quizId)).toMatchObject({ type: "quiz", data: null, draft: { kind: "assessment" } });
    expect(db.audit.map((a) => [a.action, a.entityId, a.metadata])).toEqual([
      ["part.added", `${SLUG}:concept`, { partId: textId, type: "text" }],
      ["part.added", `${SLUG}:concept`, { partId: quizId, type: "quiz" }],
    ]);
  });

  it("works on a lesson of the course's own that has no row yet", async () => {
    db.course!.outline = { v: 1, sections: [{ id: "s-abcdefgh", template: "blank" }] };
    const res = await addPart(SLUG, "s-abcdefgh", "reflection", null, partsOrderVersion([MAIN]));
    expect(res.ok).toBe(true);
    expect(items("s-abcdefgh")[0]).toMatchObject({
      type: "reflection",
      data: null,
      draft: { kind: "reflection", prompts: [{ id: "p1" }, { id: "p2" }, { id: "p3" }] },
    });
  });

  it("refuses a stale list of content, sending the outline as it is now", async () => {
    concept([MAIN, { id: T1, type: "text", blocks: {} }]);
    const res = await addPart(SLUG, "concept", "text", null, partsOrderVersion([MAIN]));
    expect(res).toEqual({ ok: false, error: "changed-elsewhere", outline: { fresh: SLUG } });
    expect(items()).toHaveLength(2);
  });

  it("stops at 12 items, the main content included", async () => {
    concept([MAIN, ...Array.from({ length: 11 }, (_, i) => ({ id: `p-t000000${i.toString(16)}`.slice(0, 10), type: "text" as const, blocks: {} }))] as StoredPart[]);
    expect(await addPart(SLUG, "concept", "text", null, order())).toEqual({
      ok: false,
      error: "too-many-parts",
    });
  });

  it("adds no content to a lesson of a live course (G3)", async () => {
    db.course!.status = "published";
    expect(await addPart(SLUG, "concept", "text", null, order())).toEqual({
      ok: false,
      error: "live-course-standard-only",
      reasons: [{ code: "extra-parts", sectionId: "concept" }],
    });
    expect(db.lessons.find((l) => l.stageKey === "concept")?.parts ?? null).toBeNull();
  });
});

describe("movePart and removePart", () => {
  beforeEach(() => {
    concept([MAIN, { id: T1, type: "text", blocks: { en: [para("More")] } }]);
  });

  it("moves any part, the main content too, and refuses at the ends", async () => {
    expect(await movePart(SLUG, "concept", "main", -1, order())).toEqual({ ok: false, error: "at-edge" });
    // The result's id names the lesson for its main content (OutlineResult.id has no "main").
    expect(await movePart(SLUG, "concept", "main", 1, order())).toMatchObject({ ok: true, id: "concept" });
    expect(items().map((i) => i.id)).toEqual([T1, "main"]);
    expect(db.audit[0]).toMatchObject({ action: "part.moved", metadata: { partId: "main", from: 0, to: 1 } });
  });

  it("is allowed on a live course that already has the content", async () => {
    db.course!.status = "published";
    expect(await movePart(SLUG, "concept", T1, -1, order())).toMatchObject({ ok: true });
  });

  it("removes content, and a lesson left with its main content is standard again", async () => {
    db.course!.status = "published";
    const res = await removePart(SLUG, "concept", T1, order(), itemVersion(item(T1)));
    expect(res).toMatchObject({ ok: true });
    // SQL NULL, not [main]: the lesson is standard again.
    expect(db.lessons[0].parts).toBeNull();
    expect(db.audit[0]).toMatchObject({ action: "part.removed", metadata: { partId: T1, type: "text" } });
  });

  it("doesn't remove content changed since the page opened", async () => {
    const stale = itemVersion(item(T1));
    concept([MAIN, { id: T1, type: "text", blocks: { de: [para("Neu")] } }]);
    expect(await removePart(SLUG, "concept", T1, order(), stale)).toMatchObject({
      ok: false,
      error: "changed-elsewhere",
    });
    expect(items()).toHaveLength(2);
  });
});

describe("savePartText", () => {
  beforeEach(() => {
    concept([MAIN, { id: T1, type: "text", blocks: { en: [para("Old")] } }, { id: Q1, type: "quiz", data: null, draft: null }]);
  });

  it("saves one language, live at once, and returns its new base", async () => {
    const res = await savePartText(SLUG, "concept", T1, "de", [para("Neu")], null);
    expect(res).toEqual({ ok: true, version: textPartVersion(item(T1), "de") });
    expect(item(T1)).toEqual({ id: T1, type: "text", blocks: { en: [para("Old")], de: [para("Neu")] } });
    expect(db.audit[0]).toMatchObject({ action: "part.text_saved", metadata: { partId: T1, locale: "de" } });
  });

  it("clears a language with no blocks", async () => {
    const res = await savePartText(SLUG, "concept", T1, "en", [], textPartVersion(item(T1), "en"));
    expect(res).toEqual({ ok: true, version: null });
    expect(item(T1)).toEqual({ id: T1, type: "text", blocks: {} });
  });

  it("refuses when the language changed since the page opened", async () => {
    expect(await savePartText(SLUG, "concept", T1, "en", [para("Mine")], null)).toEqual({
      ok: false,
      error: "changed-elsewhere",
    });
    expect(item(T1)).toMatchObject({ blocks: { en: [para("Old")] } });
  });

  it("names the content and the block when a block can't be stored", async () => {
    const res = await savePartText(SLUG, "concept", T1, "de", [para("x".repeat(200_000))], null);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toBe("invalid");
    expect(!res.ok && "issues" in res && res.issues[0]).toMatch(/^Content 2: Block 1/);
  });

  it("is only for text content", async () => {
    expect(await savePartText(SLUG, "concept", Q1, "en", [], null)).toEqual({
      ok: false,
      error: "kind-mismatch",
    });
  });

  it("refuses to make the lesson's content too large as a whole", async () => {
    // Stored before: one language that alone nearly fills the column.
    concept([
      MAIN,
      { id: T1, type: "text", blocks: { en: Array.from({ length: 150 }, () => para("y".repeat(3_990))) } },
      { id: "p-text0002", type: "text", blocks: {} },
    ]);
    const res = await savePartText(SLUG, "concept", "p-text0002", "en", [para("z".repeat(4_000))], null);
    expect(res).toEqual({ ok: false, error: "parts-too-large" });
  });
});

describe("savePart, savePartDraft and discardPartDraft", () => {
  beforeEach(() => {
    concept([MAIN, { id: "p-refl0001", type: "reflection", data: null, draft: null }, { id: Q1, type: "scenario", data: null, draft: null }]);
  });

  it("keeps an unfinished question as a draft, saying what is missing", async () => {
    const res = await savePartDraft(SLUG, "concept", "p-refl0001", reflection(["Why?", ""]), nothing);
    expect(res).toEqual({
      ok: true,
      draft: expect.objectContaining({ kind: "reflection" }),
      issues: [{ code: "reflectionPromptText", params: { prompt: 2 } }],
    });
    expect(item("p-refl0001")).toMatchObject({ data: null, draft: { kind: "reflection" } });
    expect(db.audit[0]).toMatchObject({
      action: "part.draft_saved",
      metadata: { partId: "p-refl0001", kind: "reflection" },
    });
  });

  it("saves a question for learners only when it is ready, clearing the draft", async () => {
    await savePartDraft(SLUG, "concept", "p-refl0001", reflection(["Why?", ""]), nothing);
    const base = partVersions(item("p-refl0001"));
    expect(await savePart(SLUG, "concept", "p-refl0001", reflection(["Why?", ""]), base)).toEqual({
      ok: false,
      error: "invalid",
      issues: [{ code: "reflectionPromptText", params: { prompt: 2 } }],
    });
    const res = await savePart(SLUG, "concept", "p-refl0001", reflection(["Why?", "How?"]), base);
    expect(res).toEqual({ ok: true, structure: reflection(["Why?", "How?"]) });
    expect(item("p-refl0001")).toMatchObject({ data: reflection(["Why?", "How?"]), draft: null });
    expect(db.audit.map((a) => a.action)).toEqual(["part.draft_saved", "part.saved"]);
  });

  it("throws a draft away", async () => {
    await savePartDraft(SLUG, "concept", Q1, scenario, nothing);
    const res = await discardPartDraft(SLUG, "concept", Q1, partVersions(item(Q1)));
    expect(res).toEqual({ ok: true });
    expect(item(Q1)).toMatchObject({ data: null, draft: null });
    expect(db.audit.at(-1)).toMatchObject({ action: "part.draft_discarded", metadata: { partId: Q1, kind: "scenario" } });
  });

  it("refuses a question of another kind, and text content", async () => {
    expect(await savePart(SLUG, "concept", Q1, reflection(["Why?"]), nothing)).toEqual({
      ok: false,
      error: "kind-mismatch",
    });
    concept([MAIN, { id: T1, type: "text", blocks: {} }]);
    expect(await savePartDraft(SLUG, "concept", T1, scenario, nothing)).toEqual({
      ok: false,
      error: "kind-mismatch",
    });
  });

  it("doesn't overwrite a colleague's newer version: the bases are fingerprints", async () => {
    await savePartDraft(SLUG, "concept", Q1, scenario, nothing);
    expect(await savePart(SLUG, "concept", Q1, scenario, nothing)).toEqual({
      ok: false,
      error: "changed-elsewhere",
    });
    expect(item(Q1)).toMatchObject({ data: null, draft: { kind: "scenario" } });
  });

  it("keeps what was stored over a limit, but refuses it grown, naming the box", async () => {
    const long = "Lang. ".repeat(400).trim();
    const stored: StoredRating = {
      kind: "rating",
      minLabel: { en: "Never" },
      maxLabel: { en: "Always" },
      statements: [{ id: "s1", text: { en: "I ask early", de: long } }],
    };
    concept([MAIN, { id: "p-rate0001", type: "rating", data: stored, draft: null }]);
    const base = partVersions(item("p-rate0001"));
    const edited = { ...stored, minLabel: { en: "Not yet" } };
    expect(await savePart(SLUG, "concept", "p-rate0001", edited, base)).toEqual({ ok: true, structure: edited });
    const grown = {
      ...edited,
      statements: [{ id: "s1", text: { en: "I ask early", de: `${long} Mehr.` } }],
    };
    const res = await savePartDraft(SLUG, "concept", "p-rate0001", grown, partVersions(item("p-rate0001")));
    expect(res).toMatchObject({
      ok: false,
      error: "too-large",
      at: { limit: "text", field: "ratingStatementText", locale: "de" },
    });
  });

  it("is allowed on a live course: it changes no lesson", async () => {
    db.course!.status = "published";
    expect(await savePartDraft(SLUG, "concept", Q1, scenario, nothing)).toMatchObject({ ok: true });
  });
});

describe("getPart", () => {
  it("gives the editor a question's live version and draft", async () => {
    concept([MAIN, { id: Q1, type: "scenario", data: scenario, draft: null }]);
    expect(await getPart(SLUG, "concept", Q1)).toEqual({ structure: scenario, draft: null });
  });

  it("is null for text content, content that isn't there, and bad arguments", async () => {
    concept([MAIN, { id: T1, type: "text", blocks: {} }]);
    expect(await getPart(SLUG, "concept", T1)).toBeNull();
    expect(await getPart(SLUG, "concept", Q1)).toBeNull();
    expect(await getPart(SLUG, "concept", "main" as never)).toBeNull();
  });
});
