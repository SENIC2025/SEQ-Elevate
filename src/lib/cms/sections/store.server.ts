import "server-only";

/**
 * The database side of the flexible editor's actions (D56, spec 8): the
 * locks, the reads every action starts from, new ids, the learner count and
 * the audit rows. The rules themselves are the pure modules beside this one
 * (outline.ts, section-parts.ts, guard.ts); this only feeds them rows.
 *
 * Lock order, everywhere: the Course row first, then a Lesson row. Changes
 * to the lesson list or to a lesson's content list (and publishing, G1) take
 * the Course row FOR UPDATE, so they run one at a time per course and each
 * sees the list the last one left. Saves of content inside a lesson take it
 * FOR SHARE: they may run side by side, but never while the list changes
 * under them. Release 0's saves of a standard lesson take only the Lesson
 * row and never ask for the Course, so no order of the two can deadlock.
 *
 * Takes the transaction client rather than importing Prisma for the locks,
 * so the actions' tests can hand in their mocked one.
 */

import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { learnerUserWhere } from "@/lib/learner-scope";
import { normaliseStatus, type CourseStatus } from "../course-status";
import { newOnlyReasons } from "./guard";
import { resolveOutline } from "./outline";
import type {
  CustomSectionId,
  ExtraPartId,
  NewOnlyReason,
  Refused,
  ResolvedOutline,
  SectionFacts,
} from "./contract";

export const PROJECT = "seq-elevate";

/** Course slugs as slugify makes them (src/lib/slug.ts). */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** A base (fingerprint) as the page sends it back: at most 32 characters, or none. */
export const isVersion = (v: unknown): v is string | null =>
  v === null || (typeof v === "string" && v.length <= 32);

/**
 * Thrown inside an action's transaction to refuse with `result`: throwing
 * rolls the transaction back, so a refused write leaves no trace (like
 * ChangedElsewhere, stored-json.ts).
 */
export class Refusal extends Error {
  constructor(readonly result: Refused | { ok: false; error: "invalid"; issues: unknown[] }) {
    super(result.error);
    this.name = "Refusal";
  }
}

export interface LockedCourse {
  id: string;
  meta: unknown;
  outline: unknown;
  status: CourseStatus;
}

/**
 * Lock the course's row until the transaction ends, and read it. Two
 * literal queries, because a tagged template can't put the lock strength in
 * a parameter. Null when there is no such course.
 */
export async function lockCourse(
  tx: Prisma.TransactionClient,
  slug: string,
  mode: "update" | "share"
): Promise<LockedCourse | null> {
  if (mode === "update") {
    await tx.$queryRaw`SELECT id FROM "Course" WHERE "projectId" = ${PROJECT} AND "slug" = ${slug} FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT id FROM "Course" WHERE "projectId" = ${PROJECT} AND "slug" = ${slug} FOR SHARE`;
  }
  const row = await tx.course.findFirst({
    where: { projectId: PROJECT, slug },
    select: { id: true, meta: true, outline: true, status: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    meta: row.meta ?? null,
    outline: row.outline ?? null,
    status: normaliseStatus(String(row.status ?? "")),
  };
}

/**
 * Make sure the lesson's row exists, then lock it until the transaction
 * ends. Always after lockCourse when both are taken.
 */
export async function lockLessonRow(
  tx: Prisma.TransactionClient,
  slug: string,
  stageKey: string
): Promise<void> {
  await tx.lesson.upsert({
    where: { projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug: slug, stageKey } },
    create: { projectId: PROJECT, courseSlug: slug, stageKey },
    update: {},
  });
  await tx.$queryRaw`SELECT id FROM "Lesson" WHERE "projectId" = ${PROJECT} AND "courseSlug" = ${slug} AND "stageKey" = ${stageKey} FOR UPDATE`;
}

/**
 * Lock the lesson's row if there is one, without making one: for a delete,
 * which has nothing to lock when the lesson never had a row.
 */
export async function lockLessonRowIfAny(
  tx: Prisma.TransactionClient,
  slug: string,
  stageKey: string
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Lesson" WHERE "projectId" = ${PROJECT} AND "courseSlug" = ${slug} AND "stageKey" = ${stageKey} FOR UPDATE`;
}

/** One Lesson row as the actions read it: the rules' facts, plus what a delete removes. */
export interface LessonRowFacts extends SectionFacts {
  documentIds: string[];
  documentUrls: string[];
}

/** Every Lesson row of a course, as the pure rules read them. */
export async function loadLessonFacts(
  tx: Prisma.TransactionClient,
  slug: string
): Promise<LessonRowFacts[]> {
  const rows = await tx.lesson.findMany({
    where: { projectId: PROJECT, courseSlug: slug },
    select: {
      stageKey: true,
      narrative: true,
      structure: true,
      structureDraft: true,
      parts: true,
      video: true,
      documents: { select: { id: true, url: true } },
    },
  });
  return rows.map((r) => {
    const documents = r.documents ?? [];
    return {
      stageKey: r.stageKey,
      narrative: r.narrative ?? null,
      structure: r.structure ?? null,
      structureDraft: r.structureDraft ?? null,
      parts: r.parts ?? null,
      video: r.video ?? null,
      documentCount: documents.length,
      documentIds: documents.map((d) => d.id),
      documentUrls: documents.map((d) => d.url),
    };
  });
}

/** What every lesson-list and content action starts from, read under the Course lock. */
export interface CourseState {
  course: LockedCourse;
  lessons: LessonRowFacts[];
  outline: ResolvedOutline;
  reasons: NewOnlyReason[];
}

/**
 * Steps 3.1–3.3 of spec 8: lock the course, check it is one created here,
 * read its lessons and resolve its lesson list. Refuses (by throwing a
 * Refusal) with not-cms-course, or outline-unreadable when the list or any
 * listed lesson's content can't be read — nothing is changed until an admin
 * repairs it (G8).
 */
export async function openCourse(
  tx: Prisma.TransactionClient,
  slug: string,
  mode: "update" | "share"
): Promise<CourseState> {
  const course = await lockCourse(tx, slug, mode);
  if (!course?.meta) throw new Refusal({ ok: false, error: "not-cms-course" });
  const lessons = await loadLessonFacts(tx, slug);
  const outline = resolveOutline("cms", course.outline, lessons);
  const reasons = newOnlyReasons("cms", outline, lessons);
  if (outline.unreadable || reasons.some((r) => r.code === "unreadable")) {
    throw new Refusal({ ok: false, error: "outline-unreadable" });
  }
  return { course, lessons, outline, reasons };
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const randomTail = () =>
  Array.from({ length: 8 }, () => ID_CHARS[randomInt(ID_CHARS.length)]).join("");

/**
 * A new lesson id, "s-" and 8 random characters, that neither the lesson
 * list nor any Lesson row uses: a stray row (the media actions used to make
 * them for any key) must never turn up inside a new lesson. Tried up to 5
 * times; the last try is returned even if taken, and the rules then refuse
 * it (applyOutlineOp checks again), so a clash is never written.
 */
export function newSectionId(taken: (id: string) => boolean): CustomSectionId {
  let id = `s-${randomTail()}` as CustomSectionId;
  for (let i = 1; i < 5 && taken(id); i++) id = `s-${randomTail()}` as CustomSectionId;
  return id;
}

/** A new content id, "p-" and 8 random characters, unused in the lesson (tried up to 5 times). */
export function newPartId(taken: (id: string) => boolean): ExtraPartId {
  let id = `p-${randomTail()}` as ExtraPartId;
  for (let i = 1; i < 5 && taken(id); i++) id = `p-${randomTail()}` as ExtraPartId;
  return id;
}

/**
 * How many learners are enrolled (D53): the number the course page shows as
 * "N learners enrolled" — learners only, not staff trying the course out.
 */
export async function learnerCount(
  tx: Prisma.TransactionClient,
  courseId: string
): Promise<number> {
  return tx.courseEnrollment.count({
    where: { courseId, user: learnerUserWhere(PROJECT) },
  });
}

/** A change to a course's lesson list, audited after it commits (as structure.ts does). */
export async function auditCourse(
  actorId: string,
  action: string,
  slug: string,
  metadata: Prisma.InputJsonValue
): Promise<void> {
  await prisma.auditLog.create({
    data: { projectId: PROJECT, actorId, action, entity: "Course", entityId: slug, metadata },
  });
}

/** A change to one lesson's content, audited after it commits. */
export async function auditLesson(
  actorId: string,
  action: string,
  slug: string,
  sectionId: string,
  metadata: Prisma.InputJsonValue
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId,
      action,
      entity: "Lesson",
      entityId: `${slug}:${sectionId}`,
      metadata,
    },
  });
}
