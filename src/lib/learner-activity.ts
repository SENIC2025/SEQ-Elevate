import "server-only";

/**
 * The rules the activity records keep (D117): a course opened, time on a
 * lesson and an in-video answer, written by the player for a signed-in
 * learner (src/app/actions/telemetry.ts, video.ts) and shown to
 * facilitators and in the statistics (server-queries.ts, analytics-real.ts).
 * Each record stays within what the learner's own play can make:
 *
 *   - Only for a course of the project, by its Course row (a built-in
 *     course has one too, from the seed), that learners get: published to
 *     open it (opensToLearners); published, or published once, to keep
 *     playing it (takesActivity, D62.f). Nothing else is ever a record's key.
 *   - Time only on one of the course's lessons (isLessonOf); an answer only
 *     to a question one of the course's videos asks (lessonsWithCue).
 *   - A course opened at most once per learner, course and clock hour
 *     (hourOf), which is what the statistics' day chart and weekday ×
 *     4-hour heatmap count.
 *   - Time added to a lesson's record never more than the time that passed
 *     since it was last added to (creditedSeconds).
 *   - At most ACTIVITY_LIMIT calls of the three actions together per
 *     learner (activityAllowed). A call over it writes nothing and is
 *     answered as any other input the rules ignore.
 *   - A record is written by one call at a time (oneAtATime), so the rules
 *     hold however many calls arrive together.
 *
 * Guests and people whose profile step isn't done (D79) never get this
 * far: the actions answer them first.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBaseVideoCues } from "@/lib/cms";
import { normaliseStatus } from "@/lib/cms/course-status";
import { INTERACTIVE_KEYS, isLegacySectionId, isSectionId } from "@/lib/cms/sections/contract";
import { lessonPlanOf, type LessonFacts } from "@/lib/cms/sections/learner-path";
import { learnerPlayerOff } from "@/lib/cms/sections/switches";

const PROJECT = "seq-elevate";

/**
 * The three actions together, per learner: 120 calls in 10 minutes. The
 * player makes one when a course opens, one each time the learner leaves a
 * lesson (or the page) after half a second or more on it, and one per
 * in-video answer: going through a whole course takes a dozen or so, so
 * learners stay far below it, also with several tabs open.
 */
export const ACTIVITY_LIMIT = { limit: 120, windowMs: 10 * 60_000 } as const;

/** The longest time one write adds to a lesson's record (a first write, or a record from before D117). */
export const MAX_DELTA_SECONDS = 3600;

const HOUR_MS = 3_600_000;

/**
 * Counts this call against the learner's limit (`activity:` and their id,
 * stored as a keyed hash like every rate-limit key, and removed with the
 * account: rateLimitKeysOf). False over the limit, and when the limiter
 * can't count (its rule for every key but the sign-in links'): nothing is
 * written then.
 */
export async function activityAllowed(userId: string): Promise<boolean> {
  return (await checkRateLimit(`activity:${userId}`, ACTIVITY_LIMIT)).ok;
}

/** A course as the rules read it: whether it is a created one (meta), its lesson list and its status. */
export interface ActivityCourse {
  slug: string;
  meta: unknown;
  outline: unknown;
  status: string;
  publishedAt: Date | null;
}

/** The course's row in the project, or null for a slug no course has. */
export async function activityCourse(slug: string): Promise<ActivityCourse | null> {
  return prisma.course.findUnique({
    where: { projectId_slug: { projectId: PROJECT, slug } },
    select: { slug: true, meta: true, outline: true, status: true, publishedAt: true },
  });
}

/** Can a learner open it now? Published, as the player's page asks (any other status is a 404 to learners, D17). */
export function opensToLearners(course: Pick<ActivityCourse, "status">): boolean {
  return normaliseStatus(String(course.status ?? "")) === "published";
}

/**
 * May a learner be playing it? Published, or published once: a learner
 * mid-session when it was taken off keeps playing (D62.f), as their saves
 * go on (learner.ts). A course nobody ever published was only ever an
 * editor's preview, which records nothing.
 */
export function takesActivity(course: Pick<ActivityCourse, "status" | "publishedAt">): boolean {
  return opensToLearners(course) || course.publishedAt != null;
}

const isInteractiveKey = (id: string) => (INTERACTIVE_KEYS as readonly string[]).includes(id);

/**
 * Is `stage` one of the course's lessons? A built-in course's are the seven
 * standard lessons. A created course's are those of its lesson plan
 * (lessonPlanOf, D64, the one the player plays), shown or not, so a lesson
 * hidden while a learner is in it still counts; under R2_LEARNER_PLAYER=off
 * also the standard lessons Release 1 shows.
 *
 * Only what decides `stage` is read: whether a standard lesson, a lesson of
 * the course's own or a deleted text lesson is in the plan depends on the
 * stored lesson list alone; a standard practice, scenario or quick check
 * also on its own Lesson row (an exercise saved, or extra content), read
 * by its key. Never the course's text, videos or other lessons.
 */
export async function isLessonOf(course: ActivityCourse, stage: string): Promise<boolean> {
  if (course.meta == null) return isLegacySectionId(stage);
  if (!isSectionId(stage)) return false;
  const row = isInteractiveKey(stage)
    ? await prisma.lesson.findUnique({
        where: { projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug: course.slug, stageKey: stage } },
        select: { stageKey: true, structure: true, parts: true },
      })
    : null;
  const facts: LessonFacts[] = row
    ? [
        {
          stageKey: row.stageKey,
          structure: row.structure ?? null,
          parts: row.parts ?? null,
          narrative: null,
          hasVideo: false,
          publishedDocuments: 0,
        },
      ]
    : [];
  const plan = lessonPlanOf("cms", course.outline, facts, "en", { legacyOnly: learnerPlayerOff() });
  return plan.lessons.some((l) => l.id === stage) || (plan.unseen as readonly string[]).includes(stage);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The ids of a stored video's questions (VideoContent.cues); none for anything that isn't one. */
export function cueIdsOf(video: unknown): string[] {
  if (!isRecord(video) || !Array.isArray(video.cues)) return [];
  return video.cues.flatMap((c) => (isRecord(c) && typeof c.id === "string" ? [c.id] : []));
}

/**
 * The lessons of the course whose video asks the question `cueId`: a video
 * an editor attached to a lesson (Lesson.video, lesson-overlay.ts), and for
 * a built-in course the video it ships (getBaseVideoCues). Empty when no
 * video of the course asks it. Only the course's lesson keys and videos are
 * read.
 */
export async function lessonsWithCue(course: ActivityCourse, cueId: string): Promise<string[]> {
  const rows = await prisma.lesson.findMany({
    where: { projectId: PROJECT, courseSlug: course.slug },
    select: { stageKey: true, video: true },
  });
  const lessons = rows.filter((r) => cueIdsOf(r.video).includes(cueId)).map((r) => r.stageKey);
  if (course.meta == null) {
    for (const shipped of await getBaseVideoCues(PROJECT, course.slug)) {
      if (shipped.cueIds.includes(cueId) && !lessons.includes(shipped.lesson)) lessons.push(shipped.lesson);
    }
  }
  return lessons;
}

/** The start of the clock hour (UTC) `now` is in: a course opened is recorded once in it. */
export function hourOf(now: Date): Date {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
}

/**
 * How many of the `seconds` the player sent a lesson's record takes: at
 * most MAX_DELTA_SECONDS, and once the record has been added to
 * (`lastAddedAt`, kept in its metadata) no more than the time since then,
 * in whole seconds rounded up. The player sends the time the lesson was
 * visible since it last sent, rounded to the nearest second
 * (useStageTimer.ts), which is never more than that. A record from before
 * D117 kept no time: it takes what a first write takes. 0 when no time has
 * passed (or the time kept is later than `now`).
 */
export function creditedSeconds(seconds: number, lastAddedAt: unknown, now: Date): number {
  const asked = Math.min(Math.round(seconds), MAX_DELTA_SECONDS);
  const last = typeof lastAddedAt === "string" ? Date.parse(lastAddedAt) : NaN;
  if (Number.isNaN(last)) return Math.max(0, asked);
  const since = Math.ceil((now.getTime() - last) / 1000);
  return Math.max(0, Math.min(asked, since));
}

/**
 * Takes one activity record for the rest of the transaction (`record`, the
 * action, the learner and the record's key): a second call about the same
 * record waits until the first has written. A transaction-level advisory
 * lock, released when the transaction ends; it reads and changes no table.
 */
export async function oneAtATime(tx: Prisma.TransactionClient, record: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${record}, 0))`;
}
