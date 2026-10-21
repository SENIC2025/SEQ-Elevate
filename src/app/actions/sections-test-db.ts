/**
 * An in-memory stand-in for the database the flexible editor's actions
 * write (sections.ts, parts.ts), shared by their tests: one course row, its
 * lesson rows with their documents, the learner count and the audit log,
 * with Postgres's transaction rollback. Every lock and lesson-row touch is
 * logged in call order, so the tests can assert the lock order (Course,
 * then Lesson).
 *
 * Not a test file itself (vitest only runs *.test.ts).
 */

import { vi } from "vitest";
import { Prisma } from "@prisma/client";

export type Row = {
  id: string;
  stageKey: string;
  narrative: unknown;
  structure: unknown;
  structureDraft: unknown;
  parts: unknown;
  video: unknown;
  documents: { id: string; url: string; published?: boolean }[];
};

/** A queued course file (PendingFileDeletion, D92). */
export type Pending = { url: string; reason: string; queuedAt: Date };

export const db: {
  roles: string[];
  admin: boolean;
  signedIn: boolean;
  course: { id: string; meta: unknown; outline: unknown; status: string } | null;
  lessons: Row[];
  enrolled: number;
  /** Of the learners, how many finished the course. */
  finished: number;
  /** Learners with any trace of a lesson, by lesson id (learnersWithData). */
  withData: Record<string, number>;
  audit: { action: string; entity: string; entityId: string; metadata?: unknown }[];
  /** Course files queued for the admin run (blob-files.ts), by URL. */
  pending: Pending[];
  /** URLs queued outside any transaction (the queue must share the editor's). */
  queuedOutside: string[];
  /** Open transactions. */
  txDepth: number;
  /** Locks and lesson-row touches, in call order. */
  log: string[];
} = {
  roles: [],
  admin: false,
  signedIn: true,
  course: null,
  lessons: [],
  enrolled: 0,
  finished: 0,
  withData: {},
  audit: [],
  pending: [],
  queuedOutside: [],
  txDepth: 0,
  log: [],
};

/** JSON as Postgres stores it: DbNull is SQL NULL. */
const stored = (v: unknown) =>
  v === Prisma.DbNull || v === undefined ? null : JSON.parse(JSON.stringify(v));

export const row = (stageKey: string, cols: Partial<Row> = {}): Row => ({
  id: `lesson-${stageKey}`,
  stageKey,
  narrative: null,
  structure: null,
  structureDraft: null,
  parts: null,
  video: null,
  documents: [],
  ...cols,
});

type Where = {
  projectId_courseSlug_stageKey?: { stageKey: string };
  stageKey?: string;
};
const keyOf = (where: Where) =>
  where.projectId_courseSlug_stageKey?.stageKey ?? where.stageKey;
const find = (where: Where) => db.lessons.find((l) => l.stageKey === keyOf(where)) ?? null;

function pick(r: Row, select?: Record<string, unknown>) {
  if (!select) return r;
  return Object.fromEntries(Object.entries(r).filter(([k]) => select[k]));
}

export const prisma = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    // learnersWithData: one row per lesson id asked about.
    if (sql.includes('"CourseEnrollment"')) {
      const ids = values.find(Array.isArray) as string[];
      db.log.push(`count learners with data in ${ids.join(",")}`);
      return ids.map((id) => ({ lessonId: id, n: db.withData[id] ?? 0 }));
    }
    const table = sql.includes('"Course"') ? "Course" : "Lesson";
    const mode = sql.includes("FOR UPDATE") ? "update" : sql.includes("FOR SHARE") ? "share" : "read";
    const key = table === "Lesson" ? `:${String(values.at(-1))}` : "";
    db.log.push(`lock ${table}${key} ${mode}`);
    return [];
  }),
  course: {
    findFirst: vi.fn(async () => (db.course ? { ...db.course } : null)),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      for (const [k, v] of Object.entries(data)) {
        (db.course as Record<string, unknown>)[k] = stored(v);
      }
      return db.course;
    }),
  },
  lesson: {
    findMany: vi.fn(async (args?: { select?: Record<string, unknown> }) =>
      db.lessons.map((l) => pick(structuredClone(l), args?.select))
    ),
    findUnique: vi.fn(async ({ where, select }: { where: Where; select?: Record<string, unknown> }) => {
      const r = find(where);
      return r ? pick(structuredClone(r), select) : null;
    }),
    findFirst: vi.fn(async ({ where, select }: { where: Where; select?: Record<string, unknown> }) => {
      const r = find(where);
      return r ? pick(structuredClone(r), select) : null;
    }),
    upsert: vi.fn(
      async ({
        where,
        create = {},
        update = {},
      }: {
        where: Where;
        create?: Record<string, unknown>;
        update?: Record<string, unknown>;
      }) => {
        const key = keyOf(where)!;
        db.log.push(`upsert Lesson:${key}`);
        let r = find(where);
        const data = r ? update : create;
        if (!r) {
          r = row(key);
          db.lessons.push(r);
        }
        for (const [k, v] of Object.entries(data)) {
          if (k === "projectId" || k === "courseSlug" || k === "stageKey") continue;
          (r as Record<string, unknown>)[k] = stored(v);
        }
        return r;
      }
    ),
    updateMany: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const r = find(where);
      if (!r) return { count: 0 };
      for (const [k, v] of Object.entries(data)) (r as Record<string, unknown>)[k] = stored(v);
      return { count: 1 };
    }),
    update: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const r = find(where);
      if (!r) throw new Error("no such lesson");
      db.log.push(`write Lesson:${r.stageKey}`);
      for (const [k, v] of Object.entries(data)) (r as Record<string, unknown>)[k] = stored(v);
      return r;
    }),
    deleteMany: vi.fn(async ({ where }: { where: Where }) => {
      const before = db.lessons.length;
      db.lessons = db.lessons.filter((l) => l.stageKey !== keyOf(where));
      db.log.push(`delete Lesson:${keyOf(where)}`);
      return { count: before - db.lessons.length };
    }),
  },
  lessonDocument: {
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }: { data: { lessonId: string; url: string } }) => {
      const r = db.lessons.find((l) => l.id === data.lessonId);
      const id = `doc-${(r?.documents.length ?? 0) + 1}`;
      r?.documents.push({ id, url: data.url });
      return { id };
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      for (const l of db.lessons) {
        const d = l.documents.find((x) => x.id === where.id);
        if (d) return { ...d, lesson: { courseSlug: "my-course", stageKey: l.stageKey } };
      }
      return null;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: { published?: boolean } }) => {
      let count = 0;
      for (const l of db.lessons) {
        for (const d of l.documents) {
          if (d.id !== where.id) continue;
          Object.assign(d, data);
          count += 1;
        }
      }
      return { count };
    }),
    deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
      let count = 0;
      for (const l of db.lessons) {
        const before = l.documents.length;
        l.documents = l.documents.filter((d) => d.id !== where.id);
        count += before - l.documents.length;
      }
      return { count };
    }),
  },
  pendingFileDeletion: {
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { url: string };
        create: Omit<Pending, "queuedAt"> & { queuedAt?: Date };
        update: Partial<Pending>;
      }) => {
        if (db.txDepth === 0) db.queuedOutside.push(where.url);
        const found = db.pending.find((p) => p.url === where.url);
        if (found) Object.assign(found, update);
        else db.pending.push({ queuedAt: new Date(), ...create });
        return {};
      }
    ),
  },
  courseEnrollment: {
    count: vi.fn(async (args?: { where?: { completedAt?: unknown } }) => {
      if (args?.where?.completedAt) {
        db.log.push("count finished");
        return db.finished;
      }
      db.log.push("count learners");
      return db.enrolled;
    }),
  },
  auditLog: {
    create: vi.fn(async ({ data }: { data: (typeof db.audit)[number] }) => {
      db.audit.push(data);
    }),
  },
  // A failed transaction leaves no trace, as in Postgres.
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const before = structuredClone({ course: db.course, lessons: db.lessons, pending: db.pending });
    db.txDepth += 1;
    try {
      return await fn(prisma);
    } catch (error) {
      db.course = before.course;
      db.lessons = before.lessons;
      db.pending = before.pending;
      throw error;
    } finally {
      db.txDepth -= 1;
    }
  }),
};

/** A fresh created course: draft, standard layout, nothing written. */
export function reset() {
  db.roles = ["CONTENT_EDITOR"];
  db.admin = false;
  db.signedIn = true;
  db.course = {
    id: "course-1",
    meta: { en: { title: "My course", tagline: "t", clusterLabel: "c" } },
    outline: null,
    status: "draft",
  };
  db.lessons = [];
  db.enrolled = 0;
  db.finished = 0;
  db.withData = {};
  db.audit = [];
  db.pending = [];
  db.queuedOutside = [];
  db.txDepth = 0;
  db.log = [];
  vi.clearAllMocks();
}

/** The ids of the stored lesson list, or null while nothing is stored. */
export const storedIds = () =>
  (db.course?.outline as { sections: { id: string }[] } | null)?.sections.map((s) => s.id) ??
  null;

/** Course lock before every lesson-row touch. */
export function lockOrderOk(): boolean {
  const course = db.log.findIndex((e) => e.startsWith("lock Course"));
  const lesson = db.log.findIndex((e) => e.includes("Lesson"));
  return lesson === -1 || (course !== -1 && course < lesson);
}
