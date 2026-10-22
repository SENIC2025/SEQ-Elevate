import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HOSTILE_ADDRESSES, MISLEADING_TITLES, MISLEADING_TITLE_URL, OWN_FILE } from "../../../e2e/fixtures/r4-hostile-links";

/*
 * U9 (Release 4, spec 4.3, D107, D108, D110): the further-reading actions
 * and the languages of a document. Who may (editors, partner admins,
 * admins: canEditContent; never facilitators or learners); what (a lesson
 * of a course of this project, a lesson of the course's own only while it
 * is listed; a link or document of such a lesson); the limits, refused
 * before anything is written; drafts by default; the locks, only through
 * store.server.ts, the course before the lesson; and audit rows that name
 * no title, address or description.
 *
 * The database is an in-memory stand-in with Postgres's rollback, which
 * logs every lock and write in call order.
 */

vi.mock("server-only", () => ({}));

const PROJECT = "seq-elevate";
const OTHER = "e2e-other";

type Course = { id: string; projectId: string; slug: string; meta: unknown; outline: unknown; status: string };
type Lesson = { id: string; projectId: string; courseSlug: string; stageKey: string; structure: unknown; parts: unknown };
type Link = {
  id: string;
  lessonId: string;
  title: string;
  url: string;
  description: string;
  languages: string[];
  order: number;
  published: boolean;
  createdAt: Date;
};
type Doc = { id: string; lessonId: string; languages: string[] };
type Audit = { projectId: string; actorId: string; action: string; entity: string; entityId: string; metadata: unknown };

const db: {
  roles: string[];
  signedIn: boolean;
  courses: Course[];
  lessons: Lesson[];
  links: Link[];
  docs: Doc[];
  audit: Audit[];
  log: string[];
  next: number;
} = { roles: [], signedIn: true, courses: [], lessons: [], links: [], docs: [], audit: [], log: [], next: 0 };

type LessonWhere = { projectId?: string; courseSlug?: string; stageKey?: string };
type RowWhere = { id?: string; lessonId?: string; lesson?: LessonWhere };

const lessonMatches = (l: Lesson | undefined, w: LessonWhere = {}) =>
  !!l &&
  (w.projectId === undefined || l.projectId === w.projectId) &&
  (w.courseSlug === undefined || l.courseSlug === w.courseSlug) &&
  (w.stageKey === undefined || l.stageKey === w.stageKey);
const lessonById = (id: string) => db.lessons.find((l) => l.id === id);
const rowMatches = (r: { id: string; lessonId: string }, w: RowWhere = {}) =>
  (w.id === undefined || r.id === w.id) &&
  (w.lessonId === undefined || r.lessonId === w.lessonId) &&
  (w.lesson === undefined || lessonMatches(lessonById(r.lessonId), w.lesson));

/** A row as a select picks it, with the lesson's course and key when `lesson` is selected. */
function picked<T extends { lessonId: string }>(r: T, select?: Record<string, unknown>) {
  const full: Record<string, unknown> = { ...r, lesson: lessonById(r.lessonId) };
  return select ? Object.fromEntries(Object.keys(select).map((k) => [k, structuredClone(full[k])])) : structuredClone(r);
}

const keyOf = (where: { projectId_courseSlug_stageKey: { projectId: string; courseSlug: string; stageKey: string } }) =>
  where.projectId_courseSlug_stageKey;

const prisma = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    const mode = sql.includes("FOR UPDATE") ? "update" : sql.includes("FOR SHARE") ? "share" : "read";
    if (sql.includes('"Course"')) db.log.push(`lock Course:${String(values[1])} ${mode}`);
    else db.log.push(`lock Lesson:${String(values[1])}:${String(values[2])} ${mode}`);
    return [];
  }),
  course: {
    findFirst: vi.fn(async ({ where }: { where: { projectId: string; slug: string } }) => {
      const c = db.courses.find((x) => x.projectId === where.projectId && x.slug === where.slug);
      return c ? structuredClone(c) : null;
    }),
  },
  lesson: {
    findMany: vi.fn(async ({ where }: { where: LessonWhere }) =>
      db.lessons.filter((l) => lessonMatches(l, where)).map((l) => structuredClone(l))
    ),
    findUnique: vi.fn(async ({ where }: { where: Parameters<typeof keyOf>[0] }) => {
      const k = keyOf(where);
      const l = db.lessons.find((x) => lessonMatches(x, k));
      return l ? { id: l.id } : null;
    }),
    upsert: vi.fn(async ({ where }: { where: Parameters<typeof keyOf>[0] }) => {
      const k = keyOf(where);
      db.log.push(`upsert Lesson:${k.courseSlug}:${k.stageKey}`);
      let l = db.lessons.find((x) => lessonMatches(x, k));
      if (!l) {
        l = { id: `lesson-${++db.next}`, ...k, structure: null, parts: null };
        db.lessons.push(l);
      }
      return { id: l.id };
    }),
  },
  lessonLink: {
    findFirst: vi.fn(async ({ where, select }: { where: RowWhere; select?: Record<string, unknown> }) => {
      const r = db.links.find((x) => rowMatches(x, where));
      return r ? picked(r, select) : null;
    }),
    findMany: vi.fn(async ({ where, select }: { where: RowWhere; select?: Record<string, unknown> }) =>
      db.links
        .filter((x) => rowMatches(x, where))
        .sort((a, b) => a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime())
        .map((r) => picked(r, select))
    ),
    aggregate: vi.fn(async ({ where }: { where: RowWhere }) => {
      const rows = db.links.filter((x) => rowMatches(x, where));
      return {
        _count: { _all: rows.length },
        _max: { order: rows.length ? Math.max(...rows.map((r) => r.order)) : null },
      };
    }),
    create: vi.fn(async ({ data }: { data: Omit<Link, "id" | "createdAt"> }) => {
      const id = `link-${++db.next}`;
      db.log.push(`write LessonLink:${id}`);
      db.links.push({ ...structuredClone(data), id, createdAt: new Date(db.next) });
      return { id };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Link> }) => {
      const r = db.links.find((x) => x.id === where.id);
      if (!r) throw new Error("Record to update not found.");
      db.log.push(`write LessonLink:${r.id}`);
      Object.assign(r, structuredClone(data));
      return { id: r.id };
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const i = db.links.findIndex((x) => x.id === where.id);
      if (i < 0) throw new Error("Record to delete does not exist.");
      db.log.push(`delete LessonLink:${where.id}`);
      db.links.splice(i, 1);
      return { id: where.id };
    }),
  },
  lessonDocument: {
    findFirst: vi.fn(async ({ where, select }: { where: RowWhere; select?: Record<string, unknown> }) => {
      const r = db.docs.find((x) => rowMatches(x, where));
      return r ? picked(r, select) : null;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: RowWhere; data: Partial<Doc> }) => {
      const rows = db.docs.filter((x) => rowMatches(x, where));
      for (const r of rows) {
        db.log.push(`write LessonDocument:${r.id}`);
        Object.assign(r, structuredClone(data));
      }
      return { count: rows.length };
    }),
  },
  auditLog: {
    create: vi.fn(async ({ data }: { data: Audit }) => {
      db.audit.push(structuredClone(data));
    }),
  },
  // A failed transaction leaves no trace, as in Postgres.
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const before = structuredClone({ lessons: db.lessons, links: db.links, docs: db.docs });
    try {
      return await fn(prisma);
    } catch (error) {
      Object.assign(db, before);
      throw error;
    }
  }),
};

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/auth-helpers", () => ({
  getCurrentUser: async () => (db.signedIn ? { id: "editor-1" } : null),
  getProjectMemberships: async () => db.roles.map((role) => ({ role })),
}));

const {
  addLessonLink,
  updateLessonLink,
  removeLessonLink,
  setLessonLinkOrder,
  setLessonLinkPublished,
  getLessonLinks,
  setLessonDocumentLanguages,
} = await import("./lesson-reading");

const SLUG = "my-course";
const OWN = "s-abcdefgh";
const UNLISTED = "s-zzzzzzzz";
/**
 * Titles that show another address than MISLEADING_TITLE_URL opens, written
 * with characters that show nothing or look like others, or as a www. host.
 */
const SHOWN_ANOTHER_WAY = [
  "https://bank\u200b.example/login",
  "https:\u200b//bank.example",
  "https://bank.\u200dexample/login",
  "https://bank\u2062.example",
  "https://bank\u3164.example",
  "https://bank\uffa0.example",
  "https://bank\u115f.example",
  "https://bank\u180e.example",
  "https://bank.example\u2024login",
  "https\uff1a//bank.example",
  "www.bank.example/login",
  "Log in at www.bank.example",
];
const LINK = { title: "The guide", url: "https://example.org/guide", description: "A short guide.", languages: ["de"] as ("en" | "de" | "el")[] };

function course(projectId: string, slug: string, outline: unknown = { v: 1, sections: [{ id: "context", template: "context" }, { id: OWN, template: "text" }] }): Course {
  return { id: `course-${projectId}-${slug}`, projectId, slug, meta: { en: { title: "C", tagline: "t", clusterLabel: "c" } }, outline, status: "published" };
}

function lesson(projectId: string, courseSlug: string, stageKey: string): Lesson {
  const l = { id: `lesson-${projectId}-${courseSlug}-${stageKey}`, projectId, courseSlug, stageKey, structure: null, parts: null };
  db.lessons.push(l);
  return l;
}

function link(lessonId: string, fields: Partial<Link> = {}): Link {
  const l: Link = {
    id: `link-${++db.next}`,
    lessonId,
    title: "Stored",
    url: "https://example.org/stored",
    description: "",
    languages: [],
    order: db.links.filter((x) => x.lessonId === lessonId).length,
    published: false,
    createdAt: new Date(db.next),
    ...fields,
  };
  db.links.push(l);
  return l;
}

/** Everything a refused call must leave as it was. */
const snapshot = () => structuredClone({ lessons: db.lessons, links: db.links, docs: db.docs, audit: db.audit });
const writes = () => db.log.filter((e) => !e.startsWith("lock"));

beforeEach(() => {
  vi.unstubAllEnvs();
  // No own store configured: every Vercel Blob store counts as ours (as on the e2e servers).
  vi.stubEnv("BLOB_PUBLIC_HOST", "");
  vi.stubEnv("NEXT_PUBLIC_BLOB_PUBLIC_HOST", "");
  db.roles = ["CONTENT_EDITOR"];
  db.signedIn = true;
  db.courses = [course(PROJECT, SLUG), course(OTHER, SLUG), course(OTHER, "elsewhere")];
  db.lessons = [];
  db.links = [];
  db.docs = [];
  db.audit = [];
  db.log = [];
  db.next = 0;
});
afterAll(() => vi.unstubAllEnvs());

describe("who may change further reading and languages (D110)", () => {
  it("lets editors, partner admins and admins add a link", async () => {
    for (const role of ["CONTENT_EDITOR", "PARTNER_ADMIN", "ADMIN"]) {
      db.roles = [role];
      expect(await addLessonLink(SLUG, "context", LINK), role).toMatchObject({ ok: true });
    }
    expect(db.links).toHaveLength(3);
  });

  it("refuses facilitators, learners and people signed out, every action, before anything is read or written", async () => {
    const own = lesson(PROJECT, SLUG, "context");
    const stored = link(own.id);
    db.docs.push({ id: "doc-1", lessonId: own.id, languages: [] });
    for (const [roles, signedIn] of [[["FACILITATOR"], true], [["LEARNER"], true], [[], true], [["CONTENT_EDITOR"], false]] as const) {
      db.roles = [...roles];
      db.signedIn = signedIn;
      db.log = [];
      const before = snapshot();
      const forbidden = { ok: false, error: "forbidden" };
      expect(await addLessonLink(SLUG, "context", LINK)).toEqual(forbidden);
      expect(await updateLessonLink(stored.id, LINK)).toEqual(forbidden);
      expect(await removeLessonLink(stored.id)).toEqual(forbidden);
      expect(await setLessonLinkOrder(SLUG, "context", [stored.id])).toEqual(forbidden);
      expect(await setLessonLinkPublished(stored.id, true)).toEqual(forbidden);
      expect(await setLessonDocumentLanguages("doc-1", ["de"])).toEqual(forbidden);
      // A read: nothing for anyone who doesn't edit content, drafts included.
      expect(await getLessonLinks(SLUG, "context")).toEqual({ links: [] });
      expect(snapshot()).toEqual(before);
      expect(db.log).toEqual([]);
    }
  });
});

describe("which lesson, link or document (spec 4.3, step 3)", () => {
  it("refuses a slug or lesson id of the wrong form, before anything is read", async () => {
    for (const [slug, key] of [["Bad Slug", "context"], [SLUG, "lesson-1"], [SLUG, 7], [42, "context"]] as const) {
      expect(await addLessonLink(slug as string, key as string, LINK)).toEqual({ ok: false, error: "bad-input" });
      expect(await setLessonLinkOrder(slug as string, key as string, [])).toEqual({ ok: false, error: "bad-input" });
      expect(await getLessonLinks(slug as string, key as string)).toEqual({ links: [] });
    }
    expect(db.log).toEqual([]);
  });

  it("refuses a lesson of the course's own that isn't in its list, and a list that can't be read", async () => {
    expect(await addLessonLink(SLUG, UNLISTED, LINK)).toEqual({ ok: false, error: "not-a-section" });
    db.courses[0].outline = { v: 7 };
    expect(await addLessonLink(SLUG, OWN, LINK)).toEqual({ ok: false, error: "outline-unreadable" });
    // No stray row for a key nobody listed.
    expect(db.lessons).toEqual([]);
    expect(db.links).toEqual([]);
  });

  it("adds to a listed lesson of the course's own, and to a standard lesson", async () => {
    expect(await addLessonLink(SLUG, OWN, LINK)).toMatchObject({ ok: true });
    expect(await addLessonLink(SLUG, "context", LINK)).toMatchObject({ ok: true });
    expect(db.lessons.map((l) => [l.projectId, l.courseSlug, l.stageKey])).toEqual([
      [PROJECT, SLUG, OWN],
      [PROJECT, SLUG, "context"],
    ]);
  });

  it("answers not-found for a course of another project only, and never touches that project's lesson", async () => {
    const theirs = lesson(OTHER, "elsewhere", "context");
    const before = snapshot();
    expect(await addLessonLink("elsewhere", "context", LINK)).toEqual({ ok: false, error: "not-found" });
    expect(await setLessonLinkOrder("elsewhere", "context", [])).toEqual({ ok: false, error: "not-found" });
    expect(snapshot()).toEqual(before);
    expect(db.lessons).toEqual([theirs]);
  });

  it("finds a course's lesson in this project, never the other project's lesson of the same course and key", async () => {
    const theirs = lesson(OTHER, SLUG, "context");
    const their = link(theirs.id, { published: true });
    expect(await addLessonLink(SLUG, "context", LINK)).toMatchObject({ ok: true });
    expect(db.links.filter((l) => l.lessonId === theirs.id)).toEqual([their]);
    const mine = db.links.find((l) => l.lessonId !== theirs.id)!;
    expect(lessonById(mine.lessonId)?.projectId).toBe(PROJECT);
    expect((await getLessonLinks(SLUG, "context")).links.map((l) => l.id)).toEqual([mine.id]);
  });

  it("refuses a link or document of a lesson the course doesn't list, or of a course without its row, as adding does", async () => {
    const unlisted = lesson(PROJECT, SLUG, UNLISTED);
    const gone = lesson(PROJECT, "gone-course", "context");
    const onUnlisted = link(unlisted.id);
    const onGone = link(gone.id);
    db.docs.push({ id: "doc-unlisted", lessonId: unlisted.id, languages: [] }, { id: "doc-gone", lessonId: gone.id, languages: [] });
    const before = snapshot();
    for (const [stored, doc, error] of [
      [onUnlisted, "doc-unlisted", "not-a-section"],
      [onGone, "doc-gone", "not-found"],
    ] as const) {
      const refused = { ok: false, error };
      expect(await setLessonLinkPublished(stored.id, true), error).toEqual(refused);
      expect(await updateLessonLink(stored.id, LINK), error).toEqual(refused);
      expect(await removeLessonLink(stored.id), error).toEqual(refused);
      expect(await setLessonDocumentLanguages(doc, ["de"]), error).toEqual(refused);
    }
    // As adding one answers for the same lessons.
    expect(await addLessonLink(SLUG, UNLISTED, LINK)).toEqual({ ok: false, error: "not-a-section" });
    expect(await addLessonLink("gone-course", "context", LINK)).toEqual({ ok: false, error: "not-found" });
    expect(snapshot()).toEqual(before);
    expect(writes()).toEqual([]);
  });

  it("answers not-found for a link or document of another project, or none, and changes nothing", async () => {
    const theirs = lesson(OTHER, SLUG, "context");
    const their = link(theirs.id);
    db.docs.push({ id: "their-doc", lessonId: theirs.id, languages: [] });
    const before = snapshot();
    const notFound = { ok: false, error: "not-found" };
    for (const id of [their.id, "no-such-link"]) {
      expect(await updateLessonLink(id, LINK)).toEqual(notFound);
      expect(await removeLessonLink(id)).toEqual(notFound);
      expect(await setLessonLinkPublished(id, true)).toEqual(notFound);
    }
    expect(await setLessonDocumentLanguages("their-doc", ["de"])).toEqual(notFound);
    expect(await setLessonDocumentLanguages("no-such-doc", ["de"])).toEqual(notFound);
    expect(snapshot()).toEqual(before);
    expect(writes()).toEqual([]);
  });
});

describe("what a link may be (spec 4.2), refused before anything is written", () => {
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ["a title of 201 characters", { title: "x".repeat(201) }, { field: "title", reason: "too-long" }],
    ["a title of spaces and invisible characters", { title: " \u200b\t " }, { field: "title", reason: "empty" }],
    ["a description of 301 characters", { description: "x".repeat(301) }, { field: "description", reason: "too-long" }],
    ["an address of 2,049 characters", { url: "https://example.org/" + "a".repeat(2_049 - 20) }, { field: "url", reason: "too-long" }],
    ["a file of our own store", { url: OWN_FILE }, { field: "url", reason: "own-file" }],
    ["an Outlook safe link", { url: "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org%2F" }, { field: "url", reason: "redirect" }],
    ["javascript:", { url: "javascript:alert(1)" }, { field: "url", reason: "scheme" }],
    ["a bare host", { url: "www.bpb.de" }, { field: "url", reason: "scheme" }],
    ["a title that shows another address", { title: "https://bank.example/login" }, { field: "title", reason: "misleading" }],
  ];
  for (const [name, change, refusal] of cases) {
    it(`refuses ${name}`, async () => {
      lesson(PROJECT, SLUG, "context");
      const stored = link(db.lessons[0].id);
      db.log = [];
      const before = snapshot();
      expect(await addLessonLink(SLUG, "context", { ...LINK, ...change })).toEqual({ ok: false, error: "invalid", ...refusal });
      expect(await updateLessonLink(stored.id, { ...LINK, ...change })).toEqual({ ok: false, error: "invalid", ...refusal });
      expect(snapshot()).toEqual(before);
      expect(db.log).toEqual([]);
    });
  }

  it("refuses every hostile address of spec 10.3, and every title that shows another address", async () => {
    for (const row of HOSTILE_ADDRESSES) {
      const res = await addLessonLink(SLUG, "context", { ...LINK, url: row.href as string });
      expect(res.ok, row.name).toBe(false);
      if (typeof row.href === "string") expect(res, row.name).toMatchObject({ error: "invalid", field: "url", reason: row.reason });
      else expect(res, row.name).toEqual({ ok: false, error: "bad-input" });
    }
    for (const title of MISLEADING_TITLES) {
      expect(await addLessonLink(SLUG, "context", { ...LINK, title }), title).toMatchObject({ error: "invalid", field: "title", reason: "misleading" });
    }
    expect(db.lessons).toEqual([]);
    expect(db.links).toEqual([]);
  });

  it("refuses a title that shows another address however it is written, and a title that shows nothing", async () => {
    lesson(PROJECT, SLUG, "context");
    const stored = link(db.lessons[0].id);
    db.log = [];
    const before = snapshot();
    for (const title of SHOWN_ANOTHER_WAY) {
      const misleading = { ok: false, error: "invalid", field: "title", reason: "misleading" };
      expect(await addLessonLink(SLUG, "context", { ...LINK, title, url: MISLEADING_TITLE_URL }), JSON.stringify(title)).toEqual(misleading);
      expect(await updateLessonLink(stored.id, { ...LINK, title, url: MISLEADING_TITLE_URL }), JSON.stringify(title)).toEqual(misleading);
    }
    for (const title of ["\u3164\u115f", "\uffa0", "\u2060\u180e "]) {
      expect(await addLessonLink(SLUG, "context", { ...LINK, title }), JSON.stringify(title)).toEqual({ ok: false, error: "invalid", field: "title", reason: "empty" });
    }
    expect(snapshot()).toEqual(before);
    expect(db.log).toEqual([]);
    // The link's own site, however its title writes it, is accepted.
    for (const title of ["www.bank.example", "https://bank\u200b.example/login"]) {
      expect(await addLessonLink(SLUG, "context", { ...LINK, title, url: "https://bank.example/login" }), title).toMatchObject({ ok: true });
    }
  });

  it("stores a title that shows no address by its look over another site, as learners see it with that site beside it (D104 as narrowed on 22 October 2026)", async () => {
    lesson(PROJECT, SLUG, "context");
    const stored = link(db.lessons[0].id);
    for (const title of ["PAYPAL.COM", "Amazon.Co.UK", "course-materials.zip", "Log in at bank.example"]) {
      expect(await addLessonLink(SLUG, "context", { ...LINK, title, url: MISLEADING_TITLE_URL }), title).toMatchObject({ ok: true });
      expect(await updateLessonLink(stored.id, { ...LINK, title, url: MISLEADING_TITLE_URL }), title).toEqual({ ok: true });
    }
    expect(db.links.filter((l) => l.url === MISLEADING_TITLE_URL)).toHaveLength(5);
  });

  it("answers a million-character address at once, without parsing it", async () => {
    const million = HOSTILE_ADDRESSES.find((r) => r.name === "1,000,000 characters")!.href as string;
    const started = performance.now();
    expect(await addLessonLink(SLUG, "context", { ...LINK, url: million })).toMatchObject({ field: "url", reason: "too-long" });
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("refuses fields of the wrong type, and languages that aren't en, de or el once each", async () => {
    const bad = [
      null,
      "a link",
      { ...LINK, title: 7 },
      { ...LINK, url: null },
      { ...LINK, description: 3 },
      { ...LINK, languages: "de" },
      { ...LINK, languages: ["fr"] },
      { ...LINK, languages: ["de", "de"] },
    ];
    for (const input of bad) {
      expect(await addLessonLink(SLUG, "context", input as never), JSON.stringify(input)).toEqual({ ok: false, error: "bad-input" });
    }
    // An update names every field.
    lesson(PROJECT, SLUG, "context");
    const stored = link(db.lessons[0].id);
    for (const missing of ["description", "languages"]) {
      const input = Object.fromEntries(Object.entries(LINK).filter(([k]) => k !== missing));
      expect(await updateLessonLink(stored.id, input as never), missing).toEqual({ ok: false, error: "bad-input" });
    }
    expect(db.links).toEqual([stored]);
  });

  it("stores a title of 200 characters and a description of 300, cleaned to one line, the address normalised", async () => {
    const res = await addLessonLink(SLUG, "context", {
      title: "\tThe\u0007\nguide " + "x".repeat(190),
      url: "HTTPS://Example.ORG/Straße",
      description: "y".repeat(300),
    });
    expect(res).toMatchObject({ ok: true });
    expect(db.links[0]).toMatchObject({
      title: "The guide " + "x".repeat(190),
      url: "https://example.org/Stra%C3%9Fe",
      description: "y".repeat(300),
      languages: [],
    });
  });

  it("allows 30 links on a lesson and refuses the 31st, under the lesson's lock", async () => {
    for (let i = 0; i < 30; i++) expect(await addLessonLink(SLUG, "context", LINK)).toMatchObject({ ok: true });
    db.log = [];
    const before = snapshot();
    expect(await addLessonLink(SLUG, "context", LINK)).toEqual({ ok: false, error: "too-many" });
    expect(snapshot()).toEqual(before);
    expect(db.log).toEqual([`lock Course:${SLUG} share`, `upsert Lesson:${SLUG}:context`, `lock Lesson:${SLUG}:context update`]);
  });
});

describe("adding, changing and removing a link", () => {
  it("adds a draft (Q15) after the lesson's links, with its languages normalised", async () => {
    const one = await addLessonLink(SLUG, "context", { ...LINK, languages: ["el", "en", "de"] });
    const two = await addLessonLink(SLUG, "context", LINK);
    expect(db.links.map((l) => [l.id, l.order, l.published, l.languages])).toEqual([
      [(one as { id: string }).id, 0, false, []],
      [(two as { id: string }).id, 1, false, ["de"]],
    ]);
  });

  it("locks the course FOR SHARE first, then the lesson's row FOR UPDATE", async () => {
    await addLessonLink(SLUG, OWN, LINK);
    expect(db.log).toEqual([
      `lock Course:${SLUG} share`,
      `upsert Lesson:${SLUG}:${OWN}`,
      `lock Lesson:${SLUG}:${OWN} update`,
      "write LessonLink:link-2",
    ]);
    for (const run of [
      () => updateLessonLink("link-2", LINK),
      () => setLessonLinkPublished("link-2", true),
      () => setLessonLinkOrder(SLUG, OWN, ["link-2"]),
      () => removeLessonLink("link-2"),
    ]) {
      db.log = [];
      expect(await run()).toEqual({ ok: true });
      expect(db.log.slice(0, 2)).toEqual([`lock Course:${SLUG} share`, `lock Lesson:${SLUG}:${OWN} update`]);
    }
  });

  it("writes no raw SQL of its own: every lock is store.server.ts's", () => {
    const source = readFileSync(fileURLToPath(new URL("./lesson-reading.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/\$(query|execute)Raw/);
  });

  it("changes a link's fields, keeping whether learners see it and its place", async () => {
    const l = lesson(PROJECT, SLUG, "context");
    const stored = link(l.id, { published: true, order: 4 });
    expect(await updateLessonLink(stored.id, { title: "New", url: "http://example.org/new", description: "", languages: ["en"] })).toEqual({ ok: true });
    expect(db.links[0]).toMatchObject({ title: "New", url: "http://example.org/new", description: "", languages: ["en"], published: true, order: 4 });
  });

  it("shows, hides and removes a link", async () => {
    const l = lesson(PROJECT, SLUG, "context");
    const stored = link(l.id);
    expect(await setLessonLinkPublished(stored.id, true)).toEqual({ ok: true });
    expect(db.links[0].published).toBe(true);
    expect(await setLessonLinkPublished(stored.id, false)).toEqual({ ok: true });
    expect(db.links[0].published).toBe(false);
    expect(await setLessonLinkPublished(stored.id, "yes" as never)).toEqual({ ok: false, error: "bad-input" });
    expect(await removeLessonLink(stored.id)).toEqual({ ok: true });
    expect(db.links).toEqual([]);
    expect(await removeLessonLink(stored.id)).toEqual({ ok: false, error: "not-found" });
  });

  it("orders a lesson's links only by a permutation of exactly its links", async () => {
    const l = lesson(PROJECT, SLUG, "context");
    const other = lesson(PROJECT, SLUG, "concept");
    const [a, b, c] = [link(l.id), link(l.id), link(l.id)];
    const elsewhere = link(other.id);
    const before = snapshot();
    expect(await setLessonLinkOrder(SLUG, "context", [c.id, a.id])).toEqual({ ok: false, error: "not-found" });
    expect(await setLessonLinkOrder(SLUG, "context", [c.id, a.id, elsewhere.id])).toEqual({ ok: false, error: "not-found" });
    expect(await setLessonLinkOrder(SLUG, "context", [c.id, a.id, b.id, "missing"])).toEqual({ ok: false, error: "not-found" });
    expect(await setLessonLinkOrder(SLUG, "context", [c.id, a.id, a.id])).toEqual({ ok: false, error: "bad-input" });
    expect(await setLessonLinkOrder(SLUG, "context", Array.from({ length: 31 }, (_, i) => `x${i}`))).toEqual({ ok: false, error: "bad-input" });
    expect(await setLessonLinkOrder(SLUG, "context", "nope" as never)).toEqual({ ok: false, error: "bad-input" });
    expect(snapshot()).toEqual(before);
    expect(await setLessonLinkOrder(SLUG, "context", [c.id, a.id, b.id])).toEqual({ ok: true });
    expect(Object.fromEntries(db.links.map((x) => [x.id, x.order]))).toEqual({ [c.id]: 0, [a.id]: 1, [b.id]: 2, [elsewhere.id]: 0 });
  });
});

describe("getLessonLinks", () => {
  it("lists every link, drafts included, in order, each address checked again", async () => {
    const l = lesson(PROJECT, SLUG, OWN);
    link(l.id, { title: "Second", order: 1, url: "HTTPS://EXAMPLE.ORG/b", published: true });
    link(l.id, { title: "First", order: 0, url: "mailto:help@example.org", languages: ["de"] });
    link(l.id, { title: "Hostile", order: 2, url: "javascript:alert(1)" });
    expect((await getLessonLinks(SLUG, OWN)).links).toEqual([
      { id: "link-2", title: "First", url: "mailto:help@example.org", kind: "email", description: "", languages: ["de"], published: false },
      { id: "link-1", title: "Second", url: "https://example.org/b", kind: "web", description: "", languages: [], published: true },
      // Shown as text to fix, never as a link.
      { id: "link-3", title: "Hostile", url: "javascript:alert(1)", kind: null, unusable: true, description: "", languages: [], published: false },
    ]);
  });

  it("gives nothing for a lesson of the course's own that isn't listed", async () => {
    const l = lesson(PROJECT, SLUG, UNLISTED);
    link(l.id);
    expect(await getLessonLinks(SLUG, UNLISTED)).toEqual({ links: [] });
  });
});

describe("setLessonDocumentLanguages (D108)", () => {
  it("stores the languages normalised, all three as every language", async () => {
    const l = lesson(PROJECT, SLUG, "context");
    db.docs.push({ id: "doc-1", lessonId: l.id, languages: [] });
    expect(await setLessonDocumentLanguages("doc-1", ["el", "de"])).toEqual({ ok: true });
    expect(db.docs[0].languages).toEqual(["de", "el"]);
    expect(await setLessonDocumentLanguages("doc-1", ["de", "en", "el"])).toEqual({ ok: true });
    expect(db.docs[0].languages).toEqual([]);
    for (const bad of [["fr"], "de", null, ["de", "de"]]) {
      expect(await setLessonDocumentLanguages("doc-1", bad as never), JSON.stringify(bad)).toEqual({ ok: false, error: "bad-input" });
    }
    expect(db.docs[0].languages).toEqual([]);
  });
});

describe("audit (spec 4.8)", () => {
  it("records each change by ids and what changed, never a title, address or description", async () => {
    const add = (await addLessonLink(SLUG, "context", { ...LINK, title: "Secret title", url: "mailto:person@example.org", description: "Secret text" })) as { id: string };
    await updateLessonLink(add.id, { title: "Other title", url: "https://example.org/x", description: "More text", languages: [] });
    await setLessonLinkPublished(add.id, true);
    await setLessonLinkPublished(add.id, false);
    await setLessonLinkOrder(SLUG, "context", [add.id]);
    await removeLessonLink(add.id);
    db.docs.push({ id: "doc-1", lessonId: db.lessons[0].id, languages: [] });
    await setLessonDocumentLanguages("doc-1", ["de"]);
    expect(db.audit.map((a) => [a.action, a.entity, a.entityId, a.metadata])).toEqual([
      ["link.added", "LessonLink", add.id, { courseSlug: SLUG, stageKey: "context", languages: ["de"] }],
      ["link.updated", "LessonLink", add.id, { courseSlug: SLUG, stageKey: "context", languages: [], urlChanged: true }],
      ["link.published", "LessonLink", add.id, { courseSlug: SLUG, stageKey: "context" }],
      ["link.unpublished", "LessonLink", add.id, { courseSlug: SLUG, stageKey: "context" }],
      ["link.reordered", "Lesson", db.lessons[0].id, { courseSlug: SLUG, stageKey: "context" }],
      ["link.removed", "LessonLink", add.id, { courseSlug: SLUG, stageKey: "context" }],
      ["document.languages_changed", "LessonDocument", "doc-1", { courseSlug: SLUG, stageKey: "context", languages: ["de"] }],
    ]);
    expect(db.audit.every((a) => a.projectId === PROJECT && a.actorId === "editor-1")).toBe(true);
    const text = JSON.stringify(db.audit);
    for (const secret of ["Secret", "person@example.org", "Other title", "example.org/x", "More text"]) expect(text).not.toContain(secret);
  });

  it("records nothing for a refused change", async () => {
    await addLessonLink(SLUG, UNLISTED, LINK);
    await addLessonLink(SLUG, "context", { ...LINK, url: "javascript:alert(1)" });
    await removeLessonLink("missing");
    expect(db.audit).toEqual([]);
  });
});
