"use server";

/**
 * Release 1: the lesson list of a course created here (D56, spec 8.1) —
 * add, move, hide, rename and delete lessons. Each writes Course.outline
 * (and, for a delete or a new "Reflection & self-assessment" lesson, the
 * lesson's row) under the Course lock, refuses on a published course what
 * learners couldn't get yet (G3), and returns the whole course outline so
 * the page shows exactly what was stored.
 *
 * Every action, in this order (spec 8):
 *   1. editors only;
 *   2. the arguments checked, since they come straight from the client;
 *   3. in one transaction: the Course row locked FOR UPDATE (it must be a
 *      course created here), its lessons read, the list resolved and
 *      readable (G8); the lesson must be in the list; any lesson row locked
 *      after the Course; the base compared (a stale page gets
 *      changed-elsewhere and the list as it is now, D39); the published
 *      course's rule (G3) and, for a delete, the learners (G4); then the
 *      write — always the list as the rules rebuilt it, never client JSON;
 *   4. audited after the commit (structure.ts's shape).
 *
 * The rules are the pure modules in src/lib/cms/sections, the same the page
 * predicts with, so what the page offers and what the server does agree.
 */

import { Prisma } from "@prisma/client";
import { getCurrentUser, getProjectMemberships, hasRole } from "@/lib/auth-helpers";
import { canEditContent } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCourseOutline } from "@/lib/cms/course-admin";
import { presentStageKeys } from "@/lib/cms/course-derive";
import { isContentLocale } from "@/lib/cms/course-admin-types";
import type { CourseOutline } from "@/lib/cms/course-admin-types";
import { ChangedElsewhere } from "@/lib/cms/stored-json";
import {
  NARRATIVE_KEYS,
  NEW_SECTION_TEMPLATES,
  SECTION_LIMITS,
  isLegacySectionId,
  isSectionId,
  type AddSectionChoice,
  type OutlineOp,
  type OutlineOpError,
  type OutlineResult,
  type ResolvedOutline,
  type SectionFacts,
  type SectionId,
  type SectionsError,
  type VersionResult,
} from "@/lib/cms/sections/contract";
import { PART_DEFAULTS } from "@/lib/cms/sections/defaults";
import { newOnlyReasons } from "@/lib/cms/sections/guard";
import {
  applyOutlineOp,
  labelVersion,
  outlineVersion,
  parseStoredOutline,
  toStoredOutline,
} from "@/lib/cms/sections/outline";
import { partsOf, prefillParts, storedPartsValue } from "@/lib/cms/sections/section-parts";
import { sectionContentVersion } from "@/lib/cms/sections/versions";
import {
  PROJECT,
  Refusal,
  SLUG,
  auditCourse,
  isVersion,
  learnerCount,
  loadLessonFacts,
  lockCourse,
  lockLessonRow,
  newPartId,
  newSectionId,
  guardLive,
  member,
  openCourse,
  settle,
  type CourseState,
  type Settled,
} from "@/lib/cms/sections/store.server";
import type { Locale } from "@/lib/cms/types";

async function requireEditor() {
  const user = await getCurrentUser();
  if (!user) return null;
  const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
  return canEditContent(roles) ? user : null;
}

const refuse = (error: Exclude<SectionsError, "changed-elsewhere" | "live-course-standard-only" | "has-learners">) =>
  ({ ok: false, error }) as const;

const isChoice = (v: unknown): v is AddSectionChoice =>
  (NEW_SECTION_TEMPLATES as readonly unknown[]).includes(v) ||
  (typeof v === "string" &&
    v.startsWith("restore:") &&
    (NARRATIVE_KEYS as readonly string[]).includes(v.slice("restore:".length)));

/** The rules' refusal, as the actions name it. */
function opRefusal(error: OutlineOpError): Refusal {
  return new Refusal({ ok: false, error: error === "unknown-section" ? "not-a-section" : error });
}

/** Store the list as the rules rebuilt it (put-back lessons included). */
async function writeOutline(tx: Prisma.TransactionClient, state: CourseState, o: ResolvedOutline) {
  await tx.course.update({
    where: { id: state.course.id },
    data: { outline: toStoredOutline(o) as unknown as Prisma.InputJsonValue },
  });
}

/**
 * The course outline as the page loads it, built after the commit (D39: the
 * page replaces its list with it). Null only if the course went away or the
 * viewer stopped being an editor in the meantime.
 */
async function fresh(slug: string): Promise<CourseOutline | undefined> {
  return (await getCourseOutline(slug)) ?? undefined;
}

/** A structural action's result: the whole outline, or why not (with the list as it is now). */
async function outlineResult(
  slug: string,
  settled: Settled<unknown>,
  id: SectionId
): Promise<OutlineResult> {
  if (!settled.ok) {
    if ("changed" in settled) {
      return { ok: false, error: "changed-elsewhere", outline: await fresh(slug) };
    }
    return settled.refused;
  }
  const outline = await fresh(slug);
  // The change is stored; without a page to show it, the page reloads.
  if (!outline) return refuse("unknown-course");
  return { ok: true, outline, id };
}

/**
 * Add a lesson (spec 2.3 and 1.4): a lesson of the course's own, or — for
 * practice, scenario and quick check — the standard one when it is free, or
 * a deleted standard text lesson back (empty). `at` is the place to insert
 * before; null = its standard place for a standard lesson, the end for one
 * of the course's own. A "Reflection & self-assessment" lesson starts with
 * the platform's three reflection questions and a self-assessment to finish.
 */
export async function addSection(
  slug: string,
  choice: AddSectionChoice,
  at: number | null,
  base: string
): Promise<OutlineResult> {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  if (
    typeof slug !== "string" ||
    !SLUG.test(slug) ||
    !isChoice(choice) ||
    !(at === null || (Number.isInteger(at) && at >= 0 && at <= SECTION_LIMITS.maxSections)) ||
    typeof base !== "string" ||
    !isVersion(base)
  ) {
    return refuse("bad-input");
  }

  const settled = await settle(() =>
    prisma.$transaction(async (tx) => {
      const state = await openCourse(tx, slug, "update");
      if (outlineVersion(state.outline) !== base) throw new ChangedElsewhere();

      // Never an id the list or any Lesson row already has: a stray row
      // must not turn up inside the new lesson.
      const taken = (id: string) =>
        state.outline.sections.some((s) => s.id === id) ||
        state.lessons.some((l) => l.stageKey === id);
      const newId = newSectionId(taken);
      const r = applyOutlineOp(state.outline, { op: "add", choice, at, newId }, state.lessons);
      if (!r.ok) throw opRefusal(r.error);
      const section = r.outline.sections.find((s) => s.id === r.id)!;

      // Only a lesson of the course's own can start with extra content: a
      // reused standard lesson keeps its row (a draft in it included).
      const used = new Set<string>();
      const partId = () => {
        const id = newPartId((p) => used.has(p));
        used.add(id);
        return id;
      };
      const items = section.custom ? prefillParts(choice, partId, PART_DEFAULTS) : null;
      const parts = items ? storedPartsValue(items) : null;
      const lessonsAfter: SectionFacts[] = parts
        ? [...state.lessons, { stageKey: r.id, parts }]
        : state.lessons;
      guardLive(state, newOnlyReasons("cms", r.outline, lessonsAfter));

      await writeOutline(tx, state, r.outline);
      if (parts) {
        await lockLessonRow(tx, slug, r.id);
        await tx.lesson.update({
          where: { projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug: slug, stageKey: r.id } },
          data: { parts: parts as unknown as Prisma.InputJsonValue },
        });
      }
      return {
        id: r.id,
        template: section.template,
        reused: isLegacySectionId(r.id) && !choice.startsWith("restore:"),
      };
    })
  );
  if (!settled.ok) return outlineResult(slug, settled, "context");
  const added = settled.value;
  await auditCourse(editor.id, "section.added", slug, {
    sectionId: added.id,
    template: added.template,
    choice,
    reused: added.reused,
  });
  return outlineResult(slug, settled, added.id);
}

/** Arguments of the actions that name a lesson of the list. */
function badTarget(slug: unknown, id: unknown, base: unknown): boolean {
  return (
    typeof slug !== "string" ||
    !SLUG.test(slug) ||
    !isSectionId(id) ||
    typeof base !== "string" ||
    !isVersion(base)
  );
}

/**
 * One list change that touches only Course.outline (move, hide), run through
 * the common steps.
 */
async function simpleChange(
  slug: string,
  op: Extract<OutlineOp, { op: "move" | "hide" }>,
  base: string
): Promise<Settled<{ from: number; to: number }>> {
  return settle(() =>
    prisma.$transaction(async (tx) => {
      const state = await openCourse(tx, slug, "update");
      member(state, op.id);
      if (outlineVersion(state.outline) !== base) throw new ChangedElsewhere();
      const r = applyOutlineOp(state.outline, op, state.lessons);
      if (!r.ok) throw opRefusal(r.error);
      guardLive(state, newOnlyReasons("cms", r.outline, state.lessons));
      await writeOutline(tx, state, r.outline);
      return {
        from: state.outline.sections.findIndex((s) => s.id === op.id),
        to: r.outline.sections.findIndex((s) => s.id === op.id),
      };
    })
  );
}

/** Move a lesson one place up (-1) or down (1). Refused at either end. */
export async function moveSection(
  slug: string,
  id: SectionId,
  dir: -1 | 1,
  base: string
): Promise<OutlineResult> {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  if (badTarget(slug, id, base) || (dir !== -1 && dir !== 1)) return refuse("bad-input");
  const settled = await simpleChange(slug, { op: "move", id, dir }, base);
  if (settled.ok) {
    await auditCourse(editor.id, "section.moved", slug, {
      sectionId: id,
      from: settled.value.from,
      to: settled.value.to,
    });
  }
  return outlineResult(slug, settled, id);
}

/** Hide a lesson from the course, or show it again. Never on a published course (G3). */
export async function setSectionHidden(
  slug: string,
  id: SectionId,
  hidden: boolean,
  base: string
): Promise<OutlineResult> {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  if (badTarget(slug, id, base) || typeof hidden !== "boolean") return refuse("bad-input");
  const settled = await simpleChange(slug, { op: "hide", id, hidden }, base);
  if (settled.ok) {
    await auditCourse(editor.id, hidden ? "section.hidden" : "section.shown", slug, {
      sectionId: id,
    });
  }
  return outlineResult(slug, settled, id);
}

/**
 * Name a lesson in one language (D58): at most 40 characters, refused
 * rather than cut; blank removes the name. Its base is that one name, so a
 * colleague's move or another language's rename never refuses it. Allowed
 * on a published course: learners see the standard names until Release 2.
 * Returns the name's new base.
 */
export async function renameSection(
  slug: string,
  id: SectionId,
  locale: Locale,
  label: string,
  base: string | null
): Promise<VersionResult> {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  if (
    typeof slug !== "string" ||
    !SLUG.test(slug) ||
    !isSectionId(id) ||
    typeof label !== "string" ||
    !isVersion(base)
  ) {
    return refuse("bad-input");
  }
  if (!isContentLocale(locale)) return refuse("bad-locale");

  const settled = await settle(() =>
    prisma.$transaction(async (tx) => {
      const state = await openCourse(tx, slug, "update");
      member(state, id);
      if (labelVersion(state.outline, id, locale) !== base) throw new ChangedElsewhere();
      const r = applyOutlineOp(state.outline, { op: "rename", id, locale, label }, state.lessons);
      if (!r.ok) throw opRefusal(r.error);
      guardLive(state, newOnlyReasons("cms", r.outline, state.lessons));
      await writeOutline(tx, state, r.outline);
      return labelVersion(r.outline, id, locale);
    })
  );
  if (!settled.ok) {
    return "changed" in settled
      ? { ok: false, error: "changed-elsewhere", outline: await fresh(slug) }
      : settled.refused;
  }
  await auditCourse(editor.id, "section.renamed", slug, {
    sectionId: id,
    locale,
    cleared: settled.value === null,
  });
  return { ok: true, version: settled.value };
}

/**
 * Delete a lesson in every language: out of the list (a standard text
 * lesson is remembered as deleted, or learners would get it back empty) and
 * its row with everything in it — text, exercise, draft, extra content,
 * video and documents (LessonDocument rows cascade). Uploaded files are kept,
 * as removeLessonDocument keeps them; their addresses go in the audit row.
 *
 * Refused while any learner is enrolled (G4), counted again under the
 * Course lock — for a lesson learners get now (presentStageKeys: the text
 * lessons, and exercise lessons with an exercise saved for them). A lesson
 * of the course's own, or an exercise lesson with nothing saved for
 * learners, is nobody's yet: it can always go, so a course reworked while
 * it has learners can be put back as they had it. Also refused when the
 * lesson's content changed since the page opened
 * (`contentBase`, sectionContentVersion): nobody deletes what they haven't
 * seen. An enrolment is created without the Course lock (learner.ts), but
 * its foreign-key check takes the row FOR KEY SHARE, which this FOR UPDATE
 * waits for — so a first enrolment and a delete are serialised.
 */
export async function deleteSection(
  slug: string,
  id: SectionId,
  base: string,
  contentBase: string | null
): Promise<OutlineResult> {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  if (badTarget(slug, id, base) || !isVersion(contentBase)) return refuse("bad-input");

  const settled = await settle(() =>
    prisma.$transaction(async (tx) => {
      const state = await openCourse(tx, slug, "update");
      const section = member(state, id);
      if (outlineVersion(state.outline) !== base) throw new ChangedElsewhere();

      // Lock the lesson's row, making one when there is none: a colleague's
      // first save of this lesson (no Course lock on a standard lesson) then
      // waits for the delete, instead of committing between the re-read
      // below and the delete — and being deleted unseen. A row made here
      // is "no row" to the page's base.
      const where = { projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug: slug, stageKey: id } };
      const existed = (await tx.lesson.findUnique({ where, select: { stageKey: true } })) !== null;
      await lockLessonRow(tx, slug, id);
      const lesson = await tx.lesson.findUnique({
        where,
        select: {
          narrative: true,
          structure: true,
          structureDraft: true,
          parts: true,
          video: true,
          documents: { select: { id: true, url: true } },
        },
      });
      const madeHere =
        !existed &&
        lesson !== null &&
        lesson.narrative === null &&
        lesson.structure === null &&
        lesson.structureDraft === null &&
        lesson.parts === null &&
        lesson.video === null &&
        lesson.documents.length === 0;
      const version = sectionContentVersion(
        lesson && !madeHere ? { ...lesson, documentIds: lesson.documents.map((d) => d.id) } : null
      );
      if (version !== contentBase) throw new ChangedElsewhere();

      if ((presentStageKeys("cms", state.lessons) as string[]).includes(id)) {
        const count = await learnerCount(tx, state.course.id);
        if (count > 0) throw new Refusal({ ok: false, error: "has-learners", count });
      }

      const r = applyOutlineOp(state.outline, { op: "delete", id }, state.lessons);
      if (!r.ok) throw opRefusal(r.error);
      const rest = state.lessons.filter((l) => l.stageKey !== id);
      guardLive(state, newOnlyReasons("cms", r.outline, rest));

      await writeOutline(tx, state, r.outline);
      await tx.lesson.deleteMany({ where: { projectId: PROJECT, courseSlug: slug, stageKey: id } });
      const video = lesson?.video as { src?: unknown } | null | undefined;
      return {
        template: section.template,
        documentUrls: lesson?.documents.map((d) => d.url) ?? [],
        videoSrc: typeof video?.src === "string" ? video.src : null,
      };
    })
  );
  if (settled.ok) {
    await auditCourse(editor.id, "section.deleted", slug, { sectionId: id, ...settled.value });
  }
  return outlineResult(slug, settled, id);
}

/** At most this much of a value that couldn't be read goes into the audit row. */
const RAW_AUDIT_CHARS = 20_000;
const rawForAudit = (v: unknown) => (JSON.stringify(v) ?? "null").slice(0, RAW_AUDIT_CHARS);

export type RepairResult =
  | { ok: true; outline: boolean; lessons: string[] }
  | { ok: false; error: "forbidden" | "bad-input" | "not-cms-course" };

/**
 * Admins only (addendum 10): put a course whose lesson list or lesson
 * content can't be read back to what can — an unreadable Course.outline to
 * null (the standard layout derived from the lessons), each unreadable
 * Lesson.parts to null (main content only). Nothing readable is touched, and
 * the main content never is. Under the same locks as every other change
 * (Course, then each Lesson), with what was there (up to 20,000 characters
 * each) in the audit row, so nothing is lost without a trace.
 *
 * Offered on the /dev/cms-check probe only, until Release 2.
 */
export async function repairOutline(slug: string): Promise<RepairResult> {
  const user = await getCurrentUser();
  if (!user || !(await hasRole(PROJECT, "ADMIN"))) return { ok: false, error: "forbidden" };
  if (typeof slug !== "string" || !SLUG.test(slug)) return { ok: false, error: "bad-input" };

  const result = await prisma.$transaction(async (tx) => {
    const course = await lockCourse(tx, slug, "update");
    if (!course?.meta) return null;
    const outlineBroken = parseStoredOutline(course.outline) === "unreadable";
    const lessons = await loadLessonFacts(tx, slug);
    const broken = lessons.filter((l) => partsOf(l.parts) === "unreadable");

    if (outlineBroken) {
      await tx.course.update({ where: { id: course.id }, data: { outline: Prisma.DbNull } });
    }
    const parts: Record<string, string> = {};
    for (const l of broken) {
      await lockLessonRow(tx, slug, l.stageKey);
      // Re-read under the lock: what is written is what was looked at.
      const now = await tx.lesson.findUnique({
        where: { projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug: slug, stageKey: l.stageKey } },
        select: { parts: true },
      });
      if (partsOf(now?.parts) !== "unreadable") continue;
      parts[l.stageKey] = rawForAudit(now?.parts);
      await tx.lesson.update({
        where: { projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug: slug, stageKey: l.stageKey } },
        data: { parts: Prisma.DbNull },
      });
    }
    return {
      outline: outlineBroken ? rawForAudit(course.outline) : null,
      parts,
    };
  });
  if (!result) return { ok: false, error: "not-cms-course" };

  const lessons = Object.keys(result.parts);
  if (result.outline !== null || lessons.length) {
    await auditCourse(user.id, "section.repaired", slug, result);
  }
  return { ok: true, outline: result.outline !== null, lessons };
}
