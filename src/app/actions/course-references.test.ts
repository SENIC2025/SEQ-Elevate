import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fingerprint } from "@/lib/cms/stored-json";

/*
 * Release 4 spec 5.3 (U10, D109): a created course's references and
 * bibliography, saved per language by editors only. The Course row is only
 * ever taken FOR SHARE (a FOR UPDATE would wait for and block learners'
 * FOR KEY SHARE), the references row by a Prisma upsert, never raw SQL;
 * two saves from the same base are taken one at a time, and the second is
 * refused as "changed-elsewhere"; a refusal leaves no trace; an empty list
 * removes its language; built-in courses have none; every save is audited
 * without the list's text.
 */

/* ------------------------------------------------- an in-memory database --- */

type Bib = { courseId: string; content: unknown; updatedAt: Date };
const db: {
  signedIn: boolean;
  roles: string[];
  course: { id: string; slug: string; meta: unknown; status: string } | null;
  bibliography: Bib | null;
  audit: { action: string; entity: string; entityId: string; metadata: unknown; actorId: string }[];
  log: string[];
} = { signedIn: true, roles: [], course: null, bibliography: null, audit: [], log: [] };

/** The references row's lock: held from the upsert to the end of the transaction, like Postgres's row lock. */
let rowQueue: Promise<void> = Promise.resolve();
function lockRow(): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const before = rowQueue;
  rowQueue = before.then(() => held);
  return before.then(() => release);
}

const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function makeTx(releases: (() => void)[], undo: (() => void)[]) {
  return {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      db.log.push(`sql ${strings.join("?").replace(/\s+/g, " ").trim()} [${values.join(", ")}]`);
      return [];
    },
    course: {
      findFirst: async ({ where }: { where: { projectId: string; slug: string } }) => {
        db.log.push("read Course");
        const c = db.course;
        return c && where.projectId === "seq-elevate" && where.slug === c.slug
          ? { id: c.id, meta: c.meta, outline: null, status: c.status }
          : null;
      },
    },
    courseBibliography: {
      upsert: async (args: {
        where: { courseId: string };
        create: { courseId: string; content: unknown };
        update: { updatedAt?: Date };
        select?: unknown;
      }) => {
        releases.push(await lockRow());
        db.log.push("upsert CourseBibliography");
        const before = copy(db.bibliography);
        undo.push(() => (db.bibliography = before));
        if (!db.bibliography || db.bibliography.courseId !== args.where.courseId) {
          db.bibliography = { courseId: args.create.courseId, content: copy(args.create.content), updatedAt: new Date() };
        } else {
          db.bibliography.updatedAt = args.update.updatedAt ?? new Date();
        }
        return { content: copy(db.bibliography.content) };
      },
      update: async ({ where, data }: { where: { courseId: string }; data: { content: unknown } }) => {
        db.log.push("update CourseBibliography");
        if (!db.bibliography || db.bibliography.courseId !== where.courseId) throw new Error("no row");
        // Something for a concurrent save to overtake, if it could.
        await new Promise((r) => setTimeout(r, 5));
        db.bibliography.content = copy(data.content);
      },
    },
  };
}

const prisma = {
  $transaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>): Promise<T> => {
    const releases: (() => void)[] = [];
    const undo: (() => void)[] = [];
    try {
      return await fn(makeTx(releases, undo));
    } catch (error) {
      for (const u of undo.reverse()) u();
      db.log.push("rollback");
      throw error;
    } finally {
      for (const r of releases) r();
    }
  },
  auditLog: {
    create: async ({ data }: { data: (typeof db.audit)[number] & { projectId: string } }) => {
      db.audit.push({ action: data.action, entity: data.entity, entityId: data.entityId, metadata: data.metadata, actorId: data.actorId });
    },
  },
  course: {
    findUnique: async ({ where }: { where: { projectId_slug: { projectId: string; slug: string } } }) => {
      const c = db.course;
      if (!c || where.projectId_slug.slug !== c.slug) return null;
      return { meta: c.meta, bibliography: db.bibliography ? { content: copy(db.bibliography.content) } : null };
    },
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/auth-helpers", () => ({
  getCurrentUser: async () => (db.signedIn ? { id: "editor-1" } : null),
  getProjectMemberships: async () => db.roles.map((role) => ({ role })),
}));
// The real richTextForSave, which a test can stand in for: Part A refuses
// links by name through it, and the action passes its words on.
const realSave = vi.hoisted(() => ({ fn: null as null | ((raw: unknown, name: string) => unknown) }));
vi.mock("@/lib/rich-text/narrative", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rich-text/narrative")>();
  realSave.fn = actual.richTextForSave;
  return { ...actual, richTextForSave: vi.fn(actual.richTextForSave) };
});

const { saveCourseReferences, loadCourseReferencesForEditor } = await import("./course-references");
const narrative = await import("@/lib/rich-text/narrative");

/* ------------------------------------------------------------- helpers --- */

const SLUG = "my-course";
const META = { en: { title: "My course", tagline: "", clusterLabel: "Skill" } };

const doc = (...texts: string[]) => ({
  v: 1 as const,
  doc: {
    type: "doc",
    content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  },
});
const italicTitle = {
  v: 1 as const,
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Author, A. (2020). " },
          { type: "text", text: "Title of the work", marks: [{ type: "italic" }] },
          { type: "text", text: ". Publisher." },
        ],
      },
    ],
  },
};
const EMPTY_DOC = { v: 1 as const, doc: { type: "doc", content: [{ type: "paragraph" }] } };

/** What the row holds for a language, as the save stored it. */
const storedFor = (locale: string) =>
  (db.bibliography?.content as { locales?: Record<string, unknown> } | undefined)?.locales?.[locale];

beforeEach(() => {
  db.signedIn = true;
  db.roles = ["CONTENT_EDITOR"];
  db.course = { id: "course-1", slug: SLUG, meta: META, status: "published" };
  db.bibliography = null;
  db.audit = [];
  db.log = [];
  rowQueue = Promise.resolve();
  vi.mocked(narrative.richTextForSave).mockImplementation(realSave.fn as typeof narrative.richTextForSave);
});

/* --------------------------------------------------------------- tests --- */

describe("saveCourseReferences", () => {
  it("saves a list for one language, with its plain text, and answers the new base", async () => {
    const res = await saveCourseReferences(SLUG, "en", { rich: italicTitle }, null);
    const entry = storedFor("en") as { text: string; rich: unknown };
    expect(entry.text).toBe("Author, A. (2020). Title of the work. Publisher.");
    expect(entry.rich).toEqual(italicTitle);
    expect(res).toEqual({ ok: true, base: fingerprint(entry), saved: entry });
    expect(db.bibliography?.content).toEqual({ v: 1, locales: { en: entry } });
  });

  it("locks the Course row FOR SHARE, never FOR UPDATE, then takes the references row by its upsert", async () => {
    await saveCourseReferences(SLUG, "en", { rich: doc("Author (2020).") }, null);
    expect(db.log).toEqual([
      `sql SELECT id FROM "Course" WHERE "projectId" = ? AND "slug" = ? FOR SHARE [seq-elevate, ${SLUG}]`,
      "read Course",
      "upsert CourseBibliography",
      "update CourseBibliography",
    ]);
    expect(db.log.join("\n")).not.toMatch(/FOR UPDATE|FOR NO KEY UPDATE/);
  });

  it("writes no raw SQL of its own: the locks are store.server.ts's, the row Prisma's upsert", () => {
    const source = readFileSync(fileURLToPath(new URL("./course-references.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/\$queryRaw|\$executeRaw|queryRawUnsafe|executeRawUnsafe/);
    expect(source).toMatch(/lockCourse\(tx, slug, "share"\)/);
    expect(source).toMatch(/courseBibliography\.upsert\(/);
  });

  it("keeps the other languages, and takes two saves from the same base one at a time: the second is refused", async () => {
    await saveCourseReferences(SLUG, "de", { rich: doc("Autorin (2021).") }, null);
    const german = storedFor("de");
    const [a, b] = await Promise.all([
      saveCourseReferences(SLUG, "en", { rich: doc("First (2020).") }, null),
      saveCourseReferences(SLUG, "en", { rich: doc("Second (2020).") }, null),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(a.ok ? b : a).toEqual({ ok: false, error: "changed-elsewhere" });
    const won = a.ok ? "First (2020)." : "Second (2020).";
    expect((storedFor("en") as { text: string }).text).toBe(won);
    expect(storedFor("de")).toEqual(german);
    // The refused save was rolled back, the row's touch with it.
    expect(db.log.filter((l) => l === "rollback")).toHaveLength(1);
    expect(db.audit.filter((r) => r.action === "course.references_saved")).toHaveLength(2);
  });

  it("refuses a save whose base isn't what is stored, and accepts the base the last save answered", async () => {
    const first = await saveCourseReferences(SLUG, "en", { rich: doc("One (2020).") }, null);
    expect(await saveCourseReferences(SLUG, "en", { rich: doc("Two (2020).") }, null)).toEqual({
      ok: false,
      error: "changed-elsewhere",
    });
    expect(await saveCourseReferences(SLUG, "en", { rich: doc("Two (2020).") }, "stale")).toEqual({
      ok: false,
      error: "changed-elsewhere",
    });
    expect((storedFor("en") as { text: string }).text).toBe("One (2020).");
    const base = first.ok ? first.base : null;
    expect(await saveCourseReferences(SLUG, "en", { rich: doc("Two (2020).") }, base)).toMatchObject({ ok: true });
    expect((storedFor("en") as { text: string }).text).toBe("Two (2020).");
  });

  it("removes one language for null and for an empty list, keeping the others", async () => {
    const en = await saveCourseReferences(SLUG, "en", { rich: doc("Author (2020).") }, null);
    const de = await saveCourseReferences(SLUG, "de", { rich: doc("Autorin (2021).") }, null);
    db.audit = [];
    const cleared = await saveCourseReferences(SLUG, "de", null, de.ok ? de.base : null);
    expect(cleared).toEqual({ ok: true, base: null, saved: null });
    expect(Object.keys((db.bibliography?.content as { locales: object }).locales)).toEqual(["en"]);
    expect(await saveCourseReferences(SLUG, "en", { rich: EMPTY_DOC }, en.ok ? en.base : null)).toEqual({
      ok: true,
      base: null,
      saved: null,
    });
    expect(db.bibliography?.content).toEqual({ v: 1, locales: {} });
    // Spaces only are no list either.
    await saveCourseReferences(SLUG, "el", { rich: doc("   ") }, null);
    expect(storedFor("el")).toBeUndefined();
    expect(db.audit.map((r) => [r.action, r.metadata])).toEqual([
      ["course.references_cleared", { locale: "de" }],
      ["course.references_cleared", { locale: "en" }],
    ]);
  });

  it("clears nothing that isn't there, and leaves no row behind for it", async () => {
    expect(await saveCourseReferences(SLUG, "en", null, null)).toEqual({ ok: true, base: null, saved: null });
    expect(db.bibliography).toBeNull();
    expect(db.audit).toEqual([]);
  });

  it("is for editors, partner admins and admins only", async () => {
    for (const roles of [["FACILITATOR"], ["LEARNER"], []]) {
      db.roles = roles;
      expect(await saveCourseReferences(SLUG, "en", { rich: doc("x") }, null)).toEqual({ ok: false, error: "forbidden" });
    }
    db.roles = ["CONTENT_EDITOR"];
    db.signedIn = false;
    expect(await saveCourseReferences(SLUG, "en", { rich: doc("x") }, null)).toEqual({ ok: false, error: "forbidden" });
    expect(db.log).toEqual([]);
    db.signedIn = true;
    for (const roles of [["PARTNER_ADMIN"], ["ADMIN"]]) {
      db.roles = roles;
      db.bibliography = null;
      expect(await saveCourseReferences(SLUG, "en", { rich: doc(`By ${roles[0]}`) }, null)).toMatchObject({ ok: true });
    }
  });

  it("checks every argument before touching anything", async () => {
    const bad = { ok: false, error: "bad-input" };
    const cases: unknown[][] = [
      ["Bad Slug", "en", { rich: doc("x") }, null],
      [42, "en", { rich: doc("x") }, null],
      [SLUG, "fr", { rich: doc("x") }, null],
      [SLUG, "en", { rich: doc("x") }, 42],
      [SLUG, "en", { rich: doc("x") }, "x".repeat(33)],
      [SLUG, "en", "text", null],
      [SLUG, "en", { text: "no rich" }, null],
      [SLUG, "en", [doc("x")], null],
    ];
    for (const args of cases) {
      expect(await (saveCourseReferences as (...a: unknown[]) => Promise<unknown>)(...args), JSON.stringify(args).slice(0, 80)).toEqual(bad);
    }
    expect(db.log).toEqual([]);
  });

  it("has no list for a built-in course, by its slug or by its row, and none for an unknown course", async () => {
    expect(await saveCourseReferences("workplace-conflict", "en", { rich: doc("x") }, null)).toEqual({
      ok: false,
      error: "built-in",
    });
    expect(db.log).toEqual([]);
    db.course = { id: "course-0", slug: "old-course", meta: null, status: "published" };
    expect(await saveCourseReferences("old-course", "en", { rich: doc("x") }, null)).toEqual({ ok: false, error: "built-in" });
    expect(await saveCourseReferences("no-such-course", "en", { rich: doc("x") }, null)).toEqual({
      ok: false,
      error: "not-found",
    });
    expect(db.bibliography).toBeNull();
    expect(db.audit).toEqual([]);
  });

  it("refuses what richTextForSave refuses, by name, and stores nothing", async () => {
    await saveCourseReferences(SLUG, "en", { rich: doc("Kept (2020).") }, null);
    const kept = copy(db.bibliography?.content);
    const base = fingerprint(storedFor("en"));
    // A newer format than a save reads (a link, before Part A), or one that can't be read.
    const linked = {
      v: 2,
      doc: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "the guide", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
        ],
      },
    };
    for (const rich of [linked, { v: 3, doc: {} }, "x", null]) {
      const res = await saveCourseReferences(SLUG, "en", { rich }, base);
      expect(res).toMatchObject({ ok: false, error: "invalid" });
      expect((res as { issues: string[] }).issues[0]).toMatch(/^The references list/);
    }
    // Over the rich-text limit: too long, named, with the list's own advice.
    const long = await saveCourseReferences(SLUG, "en", { rich: doc("x".repeat(10_001)) }, base);
    expect(long).toEqual({
      ok: false,
      error: "invalid",
      issues: ["The references list is too long — at most 10,000 characters. Shorten the list."],
    });
    expect(db.bibliography?.content).toEqual(kept);
    expect(db.audit.filter((r) => r.action !== "course.references_saved")).toEqual([]);
  });

  it("advises what the list's editor offers: shortening the list, never splitting or copying blocks it hasn't got", async () => {
    // A real reading list of 90 entries of about 120 characters each: over 10,000.
    const entry = "Author, A. A. (2020). Title of a modest real reference entry of about this length. Publisher. https://doi.org/10.1/x";
    const ninety = doc(...Array.from({ length: 90 }, (_, i) => `${i} ${entry}`));
    // 1,600 nodes in under 4,000 characters: too much formatting.
    const nodes = doc(...Array.from({ length: 800 }, (_, i) => `E${i}`));
    const answers = [
      await saveCourseReferences(SLUG, "en", { rich: ninety }, null),
      await saveCourseReferences(SLUG, "en", { rich: nodes }, null),
      await saveCourseReferences(SLUG, "en", { rich: { v: 3, doc: {} } }, null),
    ];
    expect(answers.map((a) => (a as { issues?: string[] }).issues)).toEqual([
      ["The references list is too long — at most 10,000 characters. Shorten the list."],
      ["The references list has too much formatting or too many list points to save. Shorten the list."],
      ["The references list couldn't be read. Reload the page, then make your change again."],
    ]);
    // The advice is the list's own, asked of richTextForSave (RT_ADVICE), so
    // Part A's words for a list over a limit that holds links give it too.
    for (const call of vi.mocked(narrative.richTextForSave).mock.calls) expect(call.slice(1)).toEqual(["The references list", "list"]);
    for (const answer of answers) expect(JSON.stringify(answer)).not.toMatch(/block/i);
    expect(db.bibliography).toBeNull();
  });

  it("passes on Part A's refusals as they are (with Part A, richTextForSave names the link)", async () => {
    const named = "The references list: the link “the guide” can't be used. Use an address starting with https:// or http://, or an email address.";
    vi.mocked(narrative.richTextForSave).mockReturnValue({ ok: false, issues: [named] });
    expect(await saveCourseReferences(SLUG, "en", { rich: doc("the guide") }, null)).toEqual({
      ok: false,
      error: "invalid",
      issues: [named],
    });
    expect(narrative.richTextForSave).toHaveBeenCalledWith(doc("the guide"), "The references list", "list");
    expect(db.bibliography).toBeNull();
  });

  it("refuses a stale base before the content: the later save never hides a colleague's change", async () => {
    await saveCourseReferences(SLUG, "en", { rich: doc("Theirs (2020).") }, null);
    expect(await saveCourseReferences(SLUG, "en", { rich: { v: 3 } }, null)).toEqual({ ok: false, error: "changed-elsewhere" });
  });

  it("audits each save against the course, with the language only: never the list's text", async () => {
    await saveCourseReferences(SLUG, "el", { rich: doc("Συγγραφέας (2022). Secret words.") }, null);
    expect(db.audit).toEqual([
      { action: "course.references_saved", entity: "Course", entityId: SLUG, metadata: { locale: "el" }, actorId: "editor-1" },
    ]);
    expect(JSON.stringify(db.audit)).not.toContain("Secret");
  });
});

describe("loadCourseReferencesForEditor", () => {
  it("gives editors every language's list with its base", async () => {
    await saveCourseReferences(SLUG, "en", { rich: italicTitle }, null);
    await saveCourseReferences(SLUG, "de", { rich: doc("Autorin (2021).") }, null);
    const loaded = await loadCourseReferencesForEditor(SLUG);
    expect(loaded).toEqual({
      locales: {
        en: { ...(storedFor("en") as object), base: fingerprint(storedFor("en")) },
        de: { ...(storedFor("de") as object), base: fingerprint(storedFor("de")) },
      },
    });
    // The base it gives is the one a save checks.
    const en = loaded!.locales.en!;
    expect(await saveCourseReferences(SLUG, "en", { rich: doc("Next (2020).") }, en.base)).toMatchObject({ ok: true });
  });

  it("is an empty list for a created course without one", async () => {
    expect(await loadCourseReferencesForEditor(SLUG)).toEqual({ locales: {} });
  });

  it("gives nothing to anyone else, nor for a built-in, unknown or malformed course", async () => {
    await saveCourseReferences(SLUG, "en", { rich: doc("Author (2020).") }, null);
    for (const roles of [["FACILITATOR"], ["LEARNER"], []]) {
      db.roles = roles;
      expect(await loadCourseReferencesForEditor(SLUG)).toBeNull();
    }
    db.roles = ["CONTENT_EDITOR"];
    db.signedIn = false;
    expect(await loadCourseReferencesForEditor(SLUG)).toBeNull();
    db.signedIn = true;
    expect(await loadCourseReferencesForEditor("workplace-conflict")).toBeNull();
    expect(await loadCourseReferencesForEditor("no-such-course")).toBeNull();
    expect(await (loadCourseReferencesForEditor as (s: unknown) => Promise<unknown>)({ slug: SLUG })).toBeNull();
    db.course = { id: "course-0", slug: "old-course", meta: null, status: "published" };
    expect(await loadCourseReferencesForEditor("old-course")).toBeNull();
  });
});
