import "server-only";

/**
 * The database side of the flexible editor's actions (D56, spec 8): the
 * locks, the reads every action starts from, new ids, the learner counts
 * and the audit rows. The rules themselves are the pure modules beside this
 * one (outline.ts, section-parts.ts, live-rules.ts); this only feeds them
 * rows.
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
import { STAFF_ROLES, learnerUserWhere } from "@/lib/learner-scope";
import { normaliseStatus, type CourseStatus } from "../course-status";
import { ChangedElsewhere } from "../stored-json";
import { restructureClosedFrom } from "./cutoff";
import { newOnlyReasons } from "./guard";
import { lessonPlanOf, type LessonFacts } from "./learner-path";
import { liveRule, type LiveFacts, type LiveOp } from "./live-rules";
import { resolveOutline } from "./outline";
import { learnerPlayerOff } from "./switches";
import { mainKindOf } from "./contract";
import type {
  CustomSectionId,
  MainKind,
  ExtraPartId,
  NewOnlyReason,
  Refused,
  ResolvedOutline,
  SectionFacts,
  SectionId,
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
  /**
   * One of the action's own refusals: Refused, or the content saves'
   * "invalid" and "too-large" (contract.ts result unions).
   */
  constructor(readonly result: Refused | { ok: false; error: "invalid" | "too-large"; [k: string]: unknown }) {
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
  /** Documents learners see (D35): whether the lesson has something to show counts these. */
  publishedDocuments: number;
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
      documents: { select: { id: true, url: true, published: true } },
      // Release 4 (D107): counted only so a key with links isn't free (keyIsFree).
      links: { select: { id: true } },
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
      publishedDocuments: documents.filter((d) => d.published === true).length,
      linkCount: (r.links ?? []).length,
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
  tx: Pick<Prisma.TransactionClient, "courseEnrollment">,
  courseId: string
): Promise<number> {
  return tx.courseEnrollment.count({
    where: { courseId, user: learnerUserWhere(PROJECT) },
  });
}

/** Of those learners, how many finished the course. */
export async function finishedCount(
  tx: Pick<Prisma.TransactionClient, "courseEnrollment">,
  courseId: string
): Promise<number> {
  return tx.courseEnrollment.count({
    where: { courseId, completedAt: { not: null }, user: learnerUserWhere(PROJECT) },
  });
}

/**
 * For each lesson id, how many learners (D53, as learnerCount) have any
 * trace of it (spec 4.7): the lesson finished (a standard one in
 * stagesCompleted, one of the course's own in sectionsCompleted), an
 * answer stored under it in `responses` ("<id>/…"), or, for a standard
 * exercise or the reflection, its answer column (Release 1's whole-row
 * saves left untouched columns at their empty defaults, which don't count).
 *
 * Plain SQL, since Prisma can't filter JSON keys by prefix; the learner
 * rule is learnerUserWhere's, spelled out on Membership with the same
 * STAFF_ROLES. Every JSON value is checked for its shape before it is
 * read, so a malformed row counts by what can be read of it rather than
 * failing the editor's action. Learner saves take the Course row FOR KEY
 * SHARE (learner.ts), so under the editor's FOR UPDATE this can't change
 * before the write.
 */
export async function learnersWithDataByLesson(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  courseId: string,
  ids: readonly string[]
): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await tx.$queryRaw<{ lessonId: string; n: number }[]>`
    SELECT l.id AS "lessonId", count(e.id)::int AS n
    FROM unnest(${[...ids]}::text[]) AS l(id)
    JOIN "CourseEnrollment" e ON e."courseId" = ${courseId}
    WHERE EXISTS (
        SELECT 1 FROM "Membership" m
        WHERE m."userId" = e."userId" AND m."projectId" = ${PROJECT} AND m."role" = 'LEARNER')
      AND NOT EXISTS (
        SELECT 1 FROM "Membership" m
        WHERE m."userId" = e."userId" AND m."projectId" = ${PROJECT} AND m."role"::text = ANY(${[...STAFF_ROLES]}::text[]))
      AND (
        upper(l.id) = ANY (e."stagesCompleted"::text[])
        OR jsonb_exists(
          CASE WHEN jsonb_typeof(e."sectionsCompleted") = 'array' THEN e."sectionsCompleted" ELSE '[]'::jsonb END,
          l.id)
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(
            CASE WHEN jsonb_typeof(e."responses"->'items') = 'object' THEN e."responses"->'items' ELSE '{}'::jsonb END
          ) AS k(key)
          WHERE left(k.key, length(l.id) + 1) = l.id || '/')
        OR (l.id = 'simulation' AND e."simulationChoice" IS NOT NULL)
        OR (l.id = 'scenario' AND e."scenarioRoot" IS NOT NULL)
        OR (l.id = 'reflection' AND EXISTS (
          SELECT 1 FROM jsonb_each(
            CASE WHEN jsonb_typeof(e."reflection") = 'object' THEN e."reflection" ELSE '{}'::jsonb END
          ) AS r(key, value)
          WHERE jsonb_typeof(r.value) = 'string' AND btrim(r.value #>> '{}') <> ''))
        OR (l.id = 'assessment' AND jsonb_typeof(e."assessment") = 'object' AND (
          (jsonb_typeof(e."assessment"->'answers') = 'object' AND e."assessment"->'answers' <> '{}'::jsonb)
          OR e."assessment"->'checked' = 'true'::jsonb))
      )
    GROUP BY l.id`;
  return new Map(rows.map((r) => [r.lessonId, Number(r.n)]));
}

/** learnersWithDataByLesson for one lesson. */
export async function learnersWithData(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  courseId: string,
  sectionId: string
): Promise<number> {
  return (await learnersWithDataByLesson(tx, courseId, [sectionId])).get(sectionId) ?? 0;
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

/** Step 3.4 of spec 8: the lesson must be in the course's list. */
export function member(state: CourseState, id: string): ResolvedOutline["sections"][number] {
  const section = state.outline.sections.find((s) => s.id === id);
  if (!section) throw new Refusal({ ok: false, error: "not-a-section" });
  return section;
}

const isRecord = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);

/** A Lesson row as the lesson plan reads it (learner-path.ts). */
export const planFacts = (l: LessonRowFacts): LessonFacts => ({
  stageKey: l.stageKey,
  structure: l.structure ?? null,
  parts: l.parts ?? null,
  narrative: l.narrative ?? null,
  // As the player reads a video: an object (lesson-plans.ts).
  hasVideo: isRecord(l.video),
  publishedDocuments: l.publishedDocuments,
});

/**
 * Is `id` the only lesson learners get now? From the plan the player plays
 * (lessonPlanOf, under the same kill switch), so "can see" means what it
 * means to them: listed, not hidden, and something in it.
 */
function onlyLessonShown(state: CourseState, id: string): boolean {
  const plan = lessonPlanOf("cms", state.course.outline, state.lessons.map(planFacts), "en", {
    legacyOnly: learnerPlayerOff(),
  });
  return plan.lessons.length === 1 && plan.lessons[0].id === id;
}

/** A structural change let through: the learners it touches, and whether the editor confirmed it. */
export interface Guarded {
  learners: number;
  confirmed: boolean;
}

/**
 * The rules for changing a course people are taking (D66, D67, spec 7.2;
 * live-rules.ts), inside the transaction that holds the Course row FOR
 * UPDATE (openCourse), so the learners counted here are the learners the
 * change meets. Throws a Refusal for needs-confirmation (with how many
 * learners and how many finished), restructure-closed (with the date),
 * has-learners (with how many) or last-lesson; otherwise says how many
 * learners there are and whether the editor confirmed, for the audit row.
 *
 * `confirm` is the action's trailing argument: a page from before Release 2
 * never sends it, so it is asked first. `sectionId` names the lesson for a
 * hide or a delete (last-lesson, and who has data in it). The clock is
 * passed in for tests; the cut-off date comes from RESTRUCTURE_CLOSED_FROM.
 */
export async function guardStructure(
  tx: Pick<Prisma.TransactionClient, "courseEnrollment" | "$queryRaw">,
  state: CourseState,
  op: LiveOp,
  opts: { confirm?: boolean; sectionId?: SectionId; now?: Date } = {}
): Promise<Guarded> {
  const published = state.course.status === "published";
  const learners = await learnerCount(tx, state.course.id);
  const cutoff = restructureClosedFrom(process.env, opts.now ?? new Date());
  const facts: LiveFacts = { status: state.course.status, learners, closed: cutoff.closed };
  if (published && opts.sectionId && (op === "hide" || op === "delete-lesson")) {
    facts.lastVisible = onlyLessonShown(state, opts.sectionId);
  }
  if (op === "delete-lesson" && learners > 0 && !published && opts.sectionId) {
    facts.withData = await learnersWithData(tx, state.course.id, opts.sectionId);
  }
  switch (liveRule(op, facts)) {
    case "allowed":
      return { learners, confirmed: false };
    case "needs-confirmation":
      if (opts.confirm === true) return { learners, confirmed: true };
      throw new Refusal({
        ok: false,
        error: "needs-confirmation",
        learners,
        finished: await finishedCount(tx, state.course.id),
      });
    case "restructure-closed":
      throw new Refusal({ ok: false, error: "restructure-closed", from: cutoff.from ?? "" });
    case "has-learners":
      throw new Refusal({ ok: false, error: "has-learners", count: facts.withData ?? learners });
    case "last-lesson":
      throw new Refusal({ ok: false, error: "last-lesson" });
  }
}

/** What an audit row of a structural change adds when the editor confirmed it (spec 4.7). */
export const confirmedAudit = (g: Guarded) => (g.confirmed ? { learners: g.learners, confirmed: true } : {});

export type Settled<T, R = Refused> =
  | { ok: true; value: T }
  | { ok: false; refused: R }
  | { ok: false; changed: true };

/** Run one action's transaction, turning its refusals (Refusal, ChangedElsewhere) into results. */
export async function settle<T, R = Refused>(run: () => Promise<T>): Promise<Settled<T, R>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof ChangedElsewhere) return { ok: false, changed: true };
    if (error instanceof Refusal) return { ok: false, refused: error.result as R };
    throw error;
  }
}

/**
 * A lesson of the course's own ("s-…") as the Release 0 actions see it
 * (G6): its main content's kind while it is in the course's lesson list,
 * else why not. A built-in course has no such lessons. Reads with the
 * client it is given; a write's caller takes the Course lock first.
 */
export async function ownSectionKind(
  client: Pick<Prisma.TransactionClient, "course" | "lesson">,
  slug: string,
  id: string
): Promise<
  { ok: true; kind: MainKind } | { ok: false; error: "not-a-section" | "outline-unreadable" }
> {
  const course = await client.course.findFirst({
    where: { projectId: PROJECT, slug },
    select: { meta: true, outline: true },
  });
  const lessons = course?.meta
    ? await client.lesson.findMany({
        where: { projectId: PROJECT, courseSlug: slug },
        select: { stageKey: true, structure: true, parts: true },
      })
    : [];
  const outline = resolveOutline(course?.meta ? "cms" : "bundled", course?.outline ?? null, lessons);
  if (outline.unreadable) return { ok: false, error: "outline-unreadable" };
  const section = outline.sections.find((s) => s.id === id);
  return section ? { ok: true, kind: mainKindOf(section) } : { ok: false, error: "not-a-section" };
}
