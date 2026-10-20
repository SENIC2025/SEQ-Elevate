import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, lockOrderOk, prisma, reset, row, storedIds } from "./sections-test-db";
import { outlineVersion, labelVersion, resolveOutline } from "@/lib/cms/sections/outline";
import { sectionContentVersion } from "@/lib/cms/sections/versions";
import type { SectionFacts, SectionId } from "@/lib/cms/sections/contract";

/*
 * The lesson-list actions (spec 8.1) against an in-memory course: every
 * refusal, the lock order, the bases, the rules for a course people are
 * taking (Release 2, D66 and D67, spec 7.2: confirmation, the delete rules,
 * last-lesson, the 1 December cut-off), and the audit rows. Each structural
 * change returns the whole course outline as the loader builds it after the
 * commit.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/auth-helpers", () => ({
  getCurrentUser: async () => (db.signedIn ? { id: "editor-1" } : null),
  getProjectMemberships: async () => db.roles.map((role) => ({ role })),
  hasRole: async (_p: string, role: string) => role === "ADMIN" && db.admin,
}));
const getCourseOutline = vi.fn(async (slug: string) => ({ fresh: slug, outline: db.course?.outline }));
vi.mock("@/lib/cms/course-admin", () => ({ getCourseOutline }));

// Ids come from crypto.randomInt; a queue lets a test make them clash.
const randomQueue: number[] = [];
vi.mock("node:crypto", async (orig) => ({
  ...(await orig<typeof import("node:crypto")>()),
  randomInt: (n: number) => (randomQueue.length ? randomQueue.shift()! : Math.floor(Math.random() * n)),
}));

const { addSection, moveSection, setSectionHidden, renameSection, deleteSection, repairOutline } =
  await import("./sections");

const SLUG = "my-course";
const facts = () => db.lessons as unknown as SectionFacts[];
const resolved = () => resolveOutline("cms", db.course?.outline ?? null, facts());
const base = () => outlineVersion(resolved());
const contentBase = (key: string) => {
  const r = db.lessons.find((l) => l.stageKey === key);
  return sectionContentVersion(
    r ? { ...r, documentIds: r.documents.map((d) => d.id) } : null
  );
};
const STANDARD = ["context", "concept", "behaviour", "reflection"];
const SCENARIO = { kind: "scenario", setup: { en: "x" }, question: { en: "q" }, choices: [] };

beforeEach(() => {
  reset();
  randomQueue.length = 0;
});

describe("every lesson-list action", () => {
  it("is for editors only, and writes nothing otherwise", async () => {
    db.roles = ["FACILITATOR"];
    const b = base();
    expect(await addSection(SLUG, "text", null, b)).toEqual({ ok: false, error: "forbidden" });
    expect(await moveSection(SLUG, "concept", 1, b)).toEqual({ ok: false, error: "forbidden" });
    expect(await setSectionHidden(SLUG, "concept", true, b)).toEqual({ ok: false, error: "forbidden" });
    expect(await renameSection(SLUG, "concept", "en", "x", null)).toEqual({ ok: false, error: "forbidden" });
    expect(await deleteSection(SLUG, "concept", b, null)).toEqual({ ok: false, error: "forbidden" });
    db.signedIn = false;
    db.roles = ["CONTENT_EDITOR"];
    expect(await addSection(SLUG, "text", null, b)).toEqual({ ok: false, error: "forbidden" });
    expect(db.course?.outline).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses arguments no page sends", async () => {
    const b = base();
    const bad = { ok: false, error: "bad-input" };
    expect(await addSection("Not A Slug", "text", null, b)).toEqual(bad);
    expect(await addSection(SLUG, "chapter" as never, null, b)).toEqual(bad);
    expect(await addSection(SLUG, "restore:simulation" as never, null, b)).toEqual(bad);
    expect(await addSection(SLUG, "text", 1.5, b)).toEqual(bad);
    expect(await addSection(SLUG, "text", -1, b)).toEqual(bad);
    expect(await addSection(SLUG, "text", null, "x".repeat(33))).toEqual(bad);
    expect(await moveSection(SLUG, "s-NOPE" as never, 1, b)).toEqual(bad);
    expect(await moveSection(SLUG, "concept", 2 as never, b)).toEqual(bad);
    expect(await setSectionHidden(SLUG, "concept", "yes" as never, b)).toEqual(bad);
    expect(await renameSection(SLUG, "concept", "en", 5 as never, null)).toEqual(bad);
    expect(await renameSection(SLUG, "concept", "fr" as never, "x", null)).toEqual({
      ok: false,
      error: "bad-locale",
    });
    expect(await deleteSection(SLUG, "concept", b, 7 as never)).toEqual(bad);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("only changes courses created here", async () => {
    db.course = { ...db.course!, meta: null };
    expect(await addSection(SLUG, "text", null, base())).toEqual({ ok: false, error: "not-cms-course" });
    db.course = null;
    expect(await moveSection(SLUG, "concept", 1, "b")).toEqual({ ok: false, error: "not-cms-course" });
  });

  it("changes nothing while the list or a lesson's content can't be read (G8)", async () => {
    db.course!.outline = { v: 2, sections: "?" };
    const b = base();
    expect(await addSection(SLUG, "text", null, b)).toEqual({ ok: false, error: "outline-unreadable" });
    expect(await renameSection(SLUG, "concept", "en", "x", null)).toEqual({
      ok: false,
      error: "outline-unreadable",
    });
    db.course!.outline = null;
    db.lessons = [row("concept", { parts: { v: 1, items: [{ id: "x" }] } })];
    expect(await moveSection(SLUG, "concept", 1, base())).toEqual({
      ok: false,
      error: "outline-unreadable",
    });
    expect(db.course?.outline).toBeNull();
  });

  it("refuses a lesson that isn't in the list", async () => {
    const b = base();
    const notThere = { ok: false, error: "not-a-section" };
    expect(await moveSection(SLUG, "simulation", 1, b)).toEqual(notThere);
    expect(await setSectionHidden(SLUG, "s-abcdefgh", true, b)).toEqual(notThere);
    expect(await renameSection(SLUG, "assessment", "en", "x", null)).toEqual(notThere);
    expect(await deleteSection(SLUG, "scenario", b, null)).toEqual(notThere);
  });

  it("refuses a stale list, writing nothing and sending the list as it is now", async () => {
    const res = await moveSection(SLUG, "concept", 1, "stale");
    expect(res).toEqual({
      ok: false,
      error: "changed-elsewhere",
      outline: { fresh: SLUG, outline: null },
    });
    expect(db.course?.outline).toBeNull();
    expect(db.audit).toEqual([]);
  });

  it("locks the course before touching any lesson row", async () => {
    await addSection(SLUG, "reflectionRating", null, base());
    expect(db.log[0]).toBe("lock Course update");
    expect(lockOrderOk()).toBe(true);

    for (const run of [
      () => moveSection(SLUG, "concept", 1, base()),
      () => setSectionHidden(SLUG, "concept", true, base()),
      () => renameSection(SLUG, "concept", "en", "Idea", labelVersion(resolved(), "concept", "en")),
      () => deleteSection(SLUG, "behaviour", base(), contentBase("behaviour")),
    ]) {
      db.log = [];
      await run();
      expect(db.log[0]).toBe("lock Course update");
      expect(lockOrderOk()).toBe(true);
    }
  });
});

describe("addSection", () => {
  it("adds a lesson of the course's own at the end, storing the whole list", async () => {
    const res = await addSection(SLUG, "text", null, base());
    expect(res.ok).toBe(true);
    const id = res.ok ? res.id : "";
    expect(id).toMatch(/^s-[a-z0-9]{8}$/);
    expect(storedIds()).toEqual([...STANDARD, id]);
    expect(res).toEqual({ ok: true, outline: { fresh: SLUG, outline: db.course?.outline }, id });
    expect(db.audit).toEqual([
      expect.objectContaining({
        action: "section.added",
        entity: "Course",
        entityId: SLUG,
        metadata: { sectionId: id, template: "text", choice: "text", reused: false },
      }),
    ]);
    // Nothing to store for it yet.
    expect(db.lessons).toEqual([]);
  });

  it("puts it where it was asked for", async () => {
    const res = await addSection(SLUG, "blank", 1, base());
    expect(storedIds()).toEqual(["context", res.ok ? res.id : "", "concept", "behaviour", "reflection"]);
  });

  it("reuses a free standard practice lesson in its standard place", async () => {
    // A draft alone leaves the key free (addendum 8): the lesson takes it over.
    db.lessons = [row("simulation", { structureDraft: { kind: "simulation" } })];
    const res = await addSection(SLUG, "practice", null, base());
    expect(res).toMatchObject({ ok: true, id: "simulation" });
    expect(storedIds()).toEqual(["context", "concept", "behaviour", "simulation", "reflection"]);
    expect(db.audit[0].metadata).toEqual({
      sectionId: "simulation",
      template: "simulation",
      choice: "practice",
      reused: true,
    });
    expect(db.lessons[0].structureDraft).toEqual({ kind: "simulation" });
  });

  it("makes a practice lesson of its own when the standard one holds something", async () => {
    db.lessons = [row("simulation", { video: { provider: "youtube", src: "x" } })];
    const res = await addSection(SLUG, "practice", null, base());
    expect(res.ok && res.id).toMatch(/^s-/);
    expect((db.course?.outline as { sections: { template: string }[] }).sections.at(-1)?.template).toBe(
      "practice"
    );
  });

  it("never gives a new lesson the id of a row that is already there", async () => {
    // The first id drawn is a stray row's (the media actions used to make them).
    db.lessons = [row("s-aaaaaaaa", { video: { provider: "youtube", src: "x" } })];
    randomQueue.push(...Array(8).fill(0), ...Array(8).fill(1));
    const res = await addSection(SLUG, "text", null, base());
    expect(res).toMatchObject({ ok: true, id: "s-bbbbbbbb" });
    expect(storedIds()).not.toContain("s-aaaaaaaa");
  });

  it("starts a reflection & self-assessment lesson with the standard questions", async () => {
    const res = await addSection(SLUG, "reflectionRating", null, base());
    const id = res.ok ? res.id : "";
    const lesson = db.lessons.find((l) => l.stageKey === id);
    const items = (lesson?.parts as { items: { type: string; data: unknown; draft: unknown }[] }).items;
    expect(items.map((i) => i.type)).toEqual(["main", "reflection", "rating"]);
    expect(items[1].data).toMatchObject({
      kind: "reflection",
      prompts: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
    });
    expect(items[2]).toMatchObject({ data: null, draft: { kind: "rating", statements: [] } });
    expect(db.log).toEqual([
      "lock Course update",
      // The learners, counted under the Course lock (none: nothing to ask).
      "count learners",
      `upsert Lesson:${id}`,
      `lock Lesson:${id} update`,
      `write Lesson:${id}`,
    ]);
  });

  it("adds back a deleted standard lesson, empty, where it belongs", async () => {
    db.course!.outline = { v: 1, sections: ["concept", "behaviour", "reflection"].map((id) => ({ id, template: id })), removed: ["context"] };
    expect(await addSection(SLUG, "restore:concept", null, base())).toEqual({
      ok: false,
      error: "not-restorable",
    });
    const res = await addSection(SLUG, "restore:context", null, base());
    expect(res).toMatchObject({ ok: true, id: "context" });
    expect(db.course?.outline).toEqual({
      v: 1,
      sections: STANDARD.map((id) => ({ id, template: id })),
    });
  });

  it("stops at 15 lessons, hidden ones counted", async () => {
    const own = Array.from({ length: 11 }, (_, i) => ({ id: `s-0000000${i.toString(16)}`.slice(0, 10), template: "text", hidden: true }));
    db.course!.outline = { v: 1, sections: [...STANDARD.map((id) => ({ id, template: id })), ...own] };
    expect(resolved().sections).toHaveLength(15);
    expect(await addSection(SLUG, "text", null, base())).toEqual({ ok: false, error: "too-many-sections" });
  });

  it("adds any lesson to a live course nobody is taking yet (Release 1 refused it, D57)", async () => {
    db.course!.status = "published";
    expect(await addSection(SLUG, "text", null, base())).toMatchObject({ ok: true, id: expect.stringMatching(/^s-/) });
    expect(await addSection(SLUG, "practice", 0, base())).toMatchObject({ ok: true, id: "simulation" });
    expect(storedIds()?.[0]).toBe("simulation");
    expect(db.audit.map((a) => a.metadata)).not.toContainEqual(expect.objectContaining({ confirmed: true }));
  });

  it("asks first on a course with learners, counted under the course lock, and audits the confirmation", async () => {
    db.enrolled = 3;
    db.finished = 1;
    const refused = await addSection(SLUG, "text", null, base());
    expect(refused).toEqual({ ok: false, error: "needs-confirmation", learners: 3, finished: 1 });
    expect(db.course?.outline).toBeNull();
    expect(db.log.indexOf("count learners")).toBeGreaterThan(db.log.indexOf("lock Course update"));
    // A page from before Release 2 sends no `confirm` and gets the same answer.
    expect(await addSection(SLUG, "text", null, base(), false)).toMatchObject({ error: "needs-confirmation" });

    const res = await addSection(SLUG, "text", null, base(), true);
    expect(res).toMatchObject({ ok: true });
    expect(db.audit).toHaveLength(1);
    expect(db.audit[0]).toMatchObject({
      action: "section.added",
      metadata: { template: "text", choice: "text", learners: 3, confirmed: true },
    });
  });

  it("is refused from the cut-off on a course with learners, whatever its status, confirmed or not (D67)", async () => {
    vi.stubEnv("RESTRUCTURE_CLOSED_FROM", "2020-01-01T00:00:00Z");
    try {
      db.course!.status = "published";
      db.enrolled = 1;
      const closed = { ok: false, error: "restructure-closed", from: "2020-01-01T00:00:00.000Z" };
      expect(await addSection(SLUG, "text", null, base(), true)).toEqual(closed);
      // Unpublished (to rework it, then publish again) or archived: still closed.
      db.course!.status = "draft";
      expect(await addSection(SLUG, "text", null, base(), true)).toEqual(closed);
      db.course!.status = "archived";
      expect(await addSection(SLUG, "text", null, base(), true)).toEqual(closed);
      expect(db.course?.outline).toBeNull();
      // A course nobody is taking is never closed.
      db.course!.status = "published";
      db.enrolled = 0;
      expect(await addSection(SLUG, "quiz", null, base())).toMatchObject({ ok: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses a confirmation that isn't true or false", async () => {
    expect(await addSection(SLUG, "text", null, base(), "yes" as never)).toEqual({ ok: false, error: "bad-input" });
  });
});

describe("moveSection", () => {
  it("swaps with the neighbour and is refused at either end", async () => {
    expect(await moveSection(SLUG, "context", -1, base())).toEqual({ ok: false, error: "at-edge" });
    expect(await moveSection(SLUG, "reflection", 1, base())).toEqual({ ok: false, error: "at-edge" });
    const res = await moveSection(SLUG, "concept", -1, base());
    expect(res).toMatchObject({ ok: true, id: "concept" });
    expect(storedIds()).toEqual(["concept", "context", "behaviour", "reflection"]);
    expect(db.audit[0]).toMatchObject({
      action: "section.moved",
      metadata: { sectionId: "concept", from: 1, to: 0 },
    });
  });

  it("moves a lesson of a live course nobody is taking yet (Release 1 refused it, D57)", async () => {
    db.course!.status = "published";
    expect(await moveSection(SLUG, "concept", -1, base())).toMatchObject({ ok: true });
    expect(storedIds()).toEqual(["concept", "context", "behaviour", "reflection"]);
  });

  it("asks first with learners, then moves it and audits the confirmation", async () => {
    db.course!.status = "published";
    db.enrolled = 2;
    expect(await moveSection(SLUG, "concept", -1, base())).toEqual({
      ok: false,
      error: "needs-confirmation",
      learners: 2,
      finished: 0,
    });
    expect(db.course?.outline).toBeNull();
    expect(await moveSection(SLUG, "concept", -1, base(), true)).toMatchObject({ ok: true });
    expect(db.audit[0]).toMatchObject({
      action: "section.moved",
      metadata: { sectionId: "concept", from: 1, to: 0, learners: 2, confirmed: true },
    });
  });

  it("is refused from the cut-off on a course with learners, published or not (D67)", async () => {
    vi.stubEnv("RESTRUCTURE_CLOSED_FROM", "2020-01-01T00:00:00Z");
    try {
      const closed = { ok: false, error: "restructure-closed", from: "2020-01-01T00:00:00.000Z" };
      db.course!.status = "published";
      db.enrolled = 2;
      expect(await moveSection(SLUG, "concept", -1, base(), true)).toEqual(closed);
      // Unpublishing it first doesn't get around the cut-off.
      db.course!.status = "draft";
      expect(await moveSection(SLUG, "concept", -1, base(), true)).toEqual(closed);
      expect(db.course?.outline).toBeNull();
      // Hiding stays open, asking first.
      expect(await setSectionHidden(SLUG, "concept", true, base(), true)).toMatchObject({ ok: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("setSectionHidden", () => {
  it("hides and shows a lesson", async () => {
    await setSectionHidden(SLUG, "behaviour", true, base());
    expect((db.course?.outline as { sections: unknown[] }).sections[2]).toEqual({
      id: "behaviour",
      template: "behaviour",
      hidden: true,
    });
    await setSectionHidden(SLUG, "behaviour", false, base());
    expect((db.course?.outline as { sections: unknown[] }).sections[2]).toEqual({
      id: "behaviour",
      template: "behaviour",
    });
    expect(db.audit.map((a) => [a.action, a.metadata])).toEqual([
      ["section.hidden", { sectionId: "behaviour" }],
      ["section.shown", { sectionId: "behaviour" }],
    ]);
  });

  it("hides a lesson of a live course nobody is taking yet (Release 1 refused it, D57)", async () => {
    db.course!.status = "published";
    expect(await setSectionHidden(SLUG, "behaviour", true, base())).toMatchObject({ ok: true });
  });

  it("asks first with learners, and still hides and shows from the cut-off: \"use Hide\" (D67)", async () => {
    vi.stubEnv("RESTRUCTURE_CLOSED_FROM", "2020-01-01T00:00:00Z");
    try {
      db.course!.status = "published";
      db.enrolled = 4;
      db.finished = 4;
      expect(await setSectionHidden(SLUG, "behaviour", true, base())).toEqual({
        ok: false,
        error: "needs-confirmation",
        learners: 4,
        finished: 4,
      });
      expect(await setSectionHidden(SLUG, "behaviour", true, base(), true)).toMatchObject({ ok: true });
      expect(await setSectionHidden(SLUG, "behaviour", false, base(), true)).toMatchObject({ ok: true });
      expect(db.audit.map((a) => [a.action, a.metadata])).toEqual([
        ["section.hidden", { sectionId: "behaviour", learners: 4, confirmed: true }],
        ["section.shown", { sectionId: "behaviour", learners: 4, confirmed: true }],
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("never hides the last lesson learners see on a published course (last-lesson)", async () => {
    db.course!.status = "published";
    db.lessons = [row("context", { narrative: { en: { title: "C", blocks: [{ kind: "paragraph", text: "x" }] } } })];
    db.course!.outline = {
      v: 1,
      sections: [
        { id: "context", template: "context" },
        { id: "concept", template: "concept", hidden: true },
        { id: "behaviour", template: "behaviour", hidden: true },
        { id: "reflection", template: "reflection", hidden: true },
        // A lesson of its own with nothing in it: learners don't get it.
        { id: "s-empty000", template: "text" },
      ],
    };
    expect(await setSectionHidden(SLUG, "context", true, base(), true)).toEqual({ ok: false, error: "last-lesson" });
    expect(await setSectionHidden(SLUG, "s-empty000", true, base())).toMatchObject({ ok: true });
    // A draft may be emptied while it is being built.
    db.course!.status = "draft";
    expect(await setSectionHidden(SLUG, "context", true, base())).toMatchObject({ ok: true });
  });
});

describe("renameSection", () => {
  it("stores the step name and returns its new base", async () => {
    const res = await renameSection(SLUG, "concept", "de", "  Die Idee ", null);
    expect(res).toEqual({ ok: true, version: labelVersion(resolved(), "concept", "de") });
    expect(res.ok && res.version).toEqual(expect.any(String));
    expect((db.course?.outline as { sections: { label?: unknown }[] }).sections[1].label).toEqual({
      de: "Die Idee",
    });
    expect(db.audit[0]).toMatchObject({
      action: "section.renamed",
      metadata: { sectionId: "concept", locale: "de", cleared: false },
    });
  });

  it("removes the name with a blank one", async () => {
    await renameSection(SLUG, "concept", "en", "Idea", null);
    const res = await renameSection(SLUG, "concept", "en", "   ", labelVersion(resolved(), "concept", "en"));
    expect(res).toEqual({ ok: true, version: null });
    expect((db.course?.outline as { sections: { label?: unknown }[] }).sections[1].label).toBeUndefined();
    expect(db.audit[1].metadata).toEqual({ sectionId: "concept", locale: "en", cleared: true });
  });

  it("refuses a name over 40 characters rather than cut it", async () => {
    expect(await renameSection(SLUG, "concept", "en", "x".repeat(41), null)).toEqual({
      ok: false,
      error: "label-too-long",
    });
    expect(db.course?.outline).toBeNull();
  });

  it("refuses when the name changed since the page opened, but not for a move", async () => {
    await renameSection(SLUG, "concept", "en", "Idea", null);
    expect(await renameSection(SLUG, "concept", "en", "Concept", null)).toMatchObject({
      ok: false,
      error: "changed-elsewhere",
    });
    // A colleague's move doesn't touch the name's base.
    await moveSection(SLUG, "concept", -1, base());
    expect(
      await renameSection(SLUG, "concept", "en", "Concept", labelVersion(resolved(), "concept", "en"))
    ).toMatchObject({ ok: true });
  });

  it("is allowed on a live course with learners, never asking (D58)", async () => {
    vi.stubEnv("RESTRUCTURE_CLOSED_FROM", "2020-01-01T00:00:00Z");
    try {
      db.course!.status = "published";
      db.enrolled = 5;
      expect(await renameSection(SLUG, "context", "en", "Start here", null)).toMatchObject({ ok: true });
      expect(db.log).not.toContain("count learners");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("deleteSection", () => {
  it("removes the lesson and everything in it; a standard text lesson is remembered", async () => {
    db.lessons = [
      row("behaviour", {
        narrative: { en: { title: "B" } },
        video: { provider: "file", src: "https://blob.example/v.mp4" },
        documents: [{ id: "d1", url: "https://blob.example/a.pdf" }],
      }),
    ];
    const res = await deleteSection(SLUG, "behaviour", base(), contentBase("behaviour"));
    expect(res).toMatchObject({ ok: true, id: "behaviour" });
    expect(db.lessons).toEqual([]);
    expect(db.course?.outline).toEqual({
      v: 1,
      sections: ["context", "concept", "reflection"].map((id) => ({ id, template: id })),
      removed: ["behaviour"],
    });
    expect(db.audit[0]).toMatchObject({
      action: "section.deleted",
      metadata: {
        sectionId: "behaviour",
        template: "behaviour",
        documentUrls: ["https://blob.example/a.pdf"],
        videoSrc: "https://blob.example/v.mp4",
      },
    });
  });

  it("refuses any lesson of a published course with learners, own lessons included (D66)", async () => {
    db.course!.status = "published";
    db.enrolled = 2;
    const added = await addSection(SLUG, "text", null, base(), true);
    const id = (added.ok ? added.id : "") as SectionId;
    db.log = [];
    const res = await deleteSection(SLUG, id, base(), null);
    expect(res).toEqual({ ok: false, error: "has-learners", count: 2 });
    expect(db.log.indexOf("count learners")).toBeGreaterThan(db.log.indexOf("lock Course update"));
    expect(await deleteSection(SLUG, "context", base(), null)).toMatchObject({ error: "has-learners" });
    expect(storedIds()).toContain(id);
  });

  it("on an unpublished course with learners, deletes only a lesson nobody has anything in", async () => {
    // A course unpublished to rework it: learners keep what they did.
    db.enrolled = 2;
    const added = await addSection(SLUG, "text", null, base(), true);
    const id = (added.ok ? added.id : "") as SectionId;
    db.withData = { [id]: 1, concept: 0 };
    db.log = [];
    expect(await deleteSection(SLUG, id, base(), null)).toEqual({ ok: false, error: "has-learners", count: 1 });
    expect(db.log.indexOf(`count learners with data in ${id}`)).toBeGreaterThan(db.log.indexOf("lock Course update"));
    expect(storedIds()).toContain(id);
    // Nobody has anything in the skill concept: it goes, without asking.
    expect(await deleteSection(SLUG, "concept", base(), null)).toMatchObject({ ok: true });
    expect(storedIds()).not.toContain("concept");
  });

  it("from the cut-off, deletes nothing from an unpublished course with learners (D67)", async () => {
    db.enrolled = 2;
    db.withData = { concept: 0 };
    vi.stubEnv("RESTRUCTURE_CLOSED_FROM", "2020-01-01T00:00:00Z");
    try {
      expect(await deleteSection(SLUG, "concept", base(), null)).toEqual({
        ok: false,
        error: "restructure-closed",
        from: "2020-01-01T00:00:00.000Z",
      });
      expect(db.course?.outline).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("deletes from a live course nobody is taking, but not its last lesson learners see", async () => {
    db.course!.status = "published";
    db.lessons = [row("scenario", { structure: SCENARIO })];
    expect(await deleteSection(SLUG, "concept", base(), null)).toMatchObject({ ok: true });
    expect(await deleteSection(SLUG, "scenario", base(), contentBase("scenario"))).toMatchObject({ ok: true });
    // Context, behaviour model and reflection are left; hide two, then the last can't go.
    await setSectionHidden(SLUG, "behaviour", true, base());
    await setSectionHidden(SLUG, "reflection", true, base());
    expect(await deleteSection(SLUG, "context", base(), null)).toEqual({ ok: false, error: "last-lesson" });
    expect(storedIds()).toContain("context");
  });

  it("locks the lesson's row even when it has none, so a first save waits for the delete", async () => {
    // context has no row: the delete makes one to lock, and the page's
    // base (no row) still matches.
    db.log = [];
    expect(await deleteSection(SLUG, "context", base(), null)).toMatchObject({ ok: true });
    expect(db.log.indexOf("upsert Lesson:context")).toBeGreaterThan(db.log.indexOf("lock Course update"));
    expect(db.log.indexOf("delete Lesson:context")).toBeGreaterThan(db.log.indexOf("upsert Lesson:context"));
    expect(db.lessons).toEqual([]);
  });

  it("still refuses a lesson a learner has done, on a draft", async () => {
    db.enrolled = 1;
    db.withData = { scenario: 1 };
    db.lessons = [row("scenario", { structure: SCENARIO })];
    expect(await deleteSection(SLUG, "scenario", base(), contentBase("scenario"))).toEqual({
      ok: false,
      error: "has-learners",
      count: 1,
    });
    expect(db.lessons).toHaveLength(1);
  });

  it("refuses when the lesson's content changed since the page opened", async () => {
    db.lessons = [row("concept", { narrative: { en: { title: "Old" } } })];
    const stale = contentBase("concept");
    db.lessons[0].narrative = { en: { title: "New" } };
    expect(await deleteSection(SLUG, "concept", base(), stale)).toMatchObject({
      ok: false,
      error: "changed-elsewhere",
    });
    expect(db.lessons).toHaveLength(1);
  });

});

describe("repairOutline", () => {
  it("is for admins only", async () => {
    db.course!.outline = "garbage";
    expect(await repairOutline(SLUG)).toEqual({ ok: false, error: "forbidden" });
    expect(db.course?.outline).toBe("garbage");
  });

  it("resets what can't be read to the standard layout, keeping the raw values in the audit", async () => {
    db.admin = true;
    db.course!.outline = { v: 3, junk: "x".repeat(30_000) };
    db.lessons = [
      row("concept", { parts: { v: 1, items: [{ id: "main", type: "main" }, { id: "nope" }] } }),
      row("context", { parts: { v: 1, items: [{ id: "main", type: "main" }] } }),
    ];
    const res = await repairOutline(SLUG);
    expect(res).toEqual({ ok: true, outline: true, lessons: ["concept"] });
    expect(db.course?.outline).toBeNull();
    expect(db.lessons[0].parts).toBeNull();
    // Readable content is left as it is.
    expect(db.lessons[1].parts).toEqual({ v: 1, items: [{ id: "main", type: "main" }] });
    expect(db.log.slice(0, 3)).toEqual([
      "lock Course update",
      "upsert Lesson:concept",
      "lock Lesson:concept update",
    ]);
    const audit = db.audit[0] as { action: string; metadata: { outline: string; parts: Record<string, string> } };
    expect(audit.action).toBe("section.repaired");
    expect(audit.metadata.outline).toHaveLength(20_000);
    expect(JSON.parse(audit.metadata.parts.concept)).toMatchObject({ v: 1 });
  });

  it("changes nothing when everything can be read", async () => {
    db.admin = true;
    expect(await repairOutline(SLUG)).toEqual({ ok: true, outline: false, lessons: [] });
    expect(db.audit).toEqual([]);
  });
});
