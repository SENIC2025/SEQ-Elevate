import { Prisma, type PrismaClient } from "@prisma/client";
import type { BrowserContext } from "@playwright/test";
import { createPerson } from "./people";
import type { LocalizedText, StoredStructure } from "@/lib/cms/structure";
import type { ExerciseValue, StoredPart, StoredSection } from "@/lib/cms/sections/contract";

/**
 * Release 2: a Prisma seed helper for flexible courses (spec 9.0), shared
 * read-only by the Foundation's and the streams' end-to-end specs.
 *
 * A course is seeded the way the course editor leaves it: Course.outline
 * holds the lesson list in learner order — the course's own lessons
 * ("s-…"), hidden lessons, step names (D58) — and each Lesson row its main
 * content (narrative, or structure for an exercise) and its extra content
 * (Lesson.parts). Nothing here goes through the app's rules: a spec can
 * seed what the editor would refuse (an unreadable list, say) to see how
 * the learner side copes.
 *
 * Everything a spec seeds should be unique to its run (runId) and removed
 * afterwards (removeR2Course, removeLearners).
 */

export const PROJECT = "seq-elevate";
export type Locale = "en" | "de" | "el";

/** A suffix unique to this run, for slugs and emails. */
export const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const used = new Set<string>();
const freshId = (prefix: string) => {
  for (;;) {
    const id = `${prefix}${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
};
/** A lesson of the course's own: "s-" + 8 × [a-z0-9], new on every call. */
export const ownLessonId = () => freshId("s-");
/** Extra content: "p-" + 8 × [a-z0-9], new on every call. */
export const partId = () => freshId("p-");

/* ------------------------------------------------------------ content --- */

/** A paragraph of rich text. */
export const para = (text: string) => ({ kind: "paragraph" as const, text });

/** A lesson's text (Lesson.narrative) in each language given: a title and one paragraph. */
export function narrative(byLocale: Partial<Record<Locale, { title: string; text: string }>>) {
  return Object.fromEntries(
    Object.entries(byLocale).map(([locale, v]) => [locale, { title: v!.title, blocks: [para(v!.text)] }])
  );
}

const two = (a: string, b: string) => [
  { id: "a", text: { en: a } },
  { id: "b", text: { en: b } },
];

/** Main content of the standard exercises, ready for learners (Lesson.structure). */
export const structures = {
  simulation: (prompt = "E2E: you're interrupted again."): StoredStructure => ({
    kind: "simulation",
    title: { en: "Try a small move" },
    prompt: { en: prompt },
    instruction: { en: "Choose what you would say." },
    options: [
      { id: "o1", isBest: true, text: { en: "Let me finish, please." }, feedback: { en: "Clear and calm." } },
      { id: "o2", isBest: false, text: { en: "Say nothing." }, feedback: { en: "The pattern goes on." } },
    ],
  }),
  scenario: (setup = "E2E: your lead cuts you off in a meeting."): StoredStructure => ({
    kind: "scenario",
    title: { en: "The bigger moment" },
    setup: { en: setup },
    question: { en: "What do you do?" },
    followupQuestion: { en: "" },
    choices: [
      { id: "c1", quality: "best", text: { en: "Ask to finish your point" }, outcome: { en: "You finish." } },
      { id: "c2", quality: "poor", text: { en: "Stay quiet" }, outcome: { en: "The point is lost." } },
    ],
  }),
  assessment: (question = "E2E: when do you speak up?"): StoredStructure => ({
    kind: "assessment",
    title: { en: "Quick check" },
    intro: { en: "One question." },
    questions: [{ id: "q1", correctOptionId: "a", question: { en: question }, options: two("Early", "Never") }],
  }),
};

/** Extra content (Lesson.parts items), for learners unless `draft` is set. */
export const parts = {
  text: (text: LocalizedText, id = partId()): StoredPart => ({
    id: id as `p-${string}`,
    type: "text",
    blocks: Object.fromEntries(Object.entries(text).map(([l, t]) => [l, [para(t!)]])),
  }),
  practice: (prompt = "E2E: choose what you would say.", id = partId()): StoredPart =>
    question("practice", id, structures.simulation(prompt) as ExerciseValue),
  scenario: (setup = "E2E: a colleague talks over you.", id = partId()): StoredPart =>
    question("scenario", id, structures.scenario(setup) as ExerciseValue),
  quiz: (q = "E2E: when do you speak up?", id = partId()): StoredPart =>
    question("quiz", id, structures.assessment(q) as ExerciseValue),
  reflection: (prompts: LocalizedText[] = [{ en: "E2E: when did you hold back?" }], id = partId()): StoredPart =>
    question("reflection", id, {
      kind: "reflection",
      prompts: prompts.map((label, i) => ({ id: `r${i + 1}`, label })),
    }),
  rating: (statements: LocalizedText[] = [{ en: "E2E: I say when I disagree." }], id = partId()): StoredPart =>
    question("rating", id, {
      kind: "rating",
      minLabel: { en: "Not at all like me" },
      maxLabel: { en: "Very much like me" },
      statements: statements.map((text, i) => ({ id: `s${i + 1}`, text })),
    }),
};

function question(
  type: Exclude<StoredPart["type"], "main" | "text">,
  id: string,
  value: ExerciseValue,
  draft = false
): StoredPart {
  return {
    id: id as `p-${string}`,
    type,
    data: draft ? null : value,
    draft: draft ? value : null,
  } as StoredPart;
}

/** `part` as an editor's unfinished draft: the editor's preview notes it, learners never get it. */
export function asDraft(part: StoredPart): StoredPart {
  if (part.type === "main" || part.type === "text" || !part.data) return part;
  return question(part.type, part.id, part.data, true);
}

/* ------------------------------------------------------------- courses --- */

export interface R2LessonSeed {
  /** A standard key ("context" … "assessment") or ownLessonId(). */
  id: string;
  /** Outline template: a standard lesson's own key (the default), else "text", "practice", … */
  template?: StoredSection["template"];
  hidden?: boolean;
  /** Step name per language (D58). */
  label?: LocalizedText;
  /** Main content: text (see narrative()). */
  narrative?: unknown;
  /** Main content of an exercise (see structures), as saved for learners. */
  structure?: unknown;
  /** Extra content, in order; the main content's place ("main") is put first. */
  parts?: StoredPart[];
  /** An interactive video (VideoContent). */
  video?: unknown;
  /** Documents attached to the lesson; published ones are shown to learners. */
  documents?: { name: string; url: string; published?: boolean }[];
}

export interface R2CourseSeed {
  slug: string;
  status?: "draft" | "published";
  /** The course's title per language (Course.meta); its tagline and cluster label are made up. */
  title?: LocalizedText;
  /** In learner order. */
  lessons: R2LessonSeed[];
  /**
   * The languages other than English switched on for learners (Release 3,
   * D90). Default: German and Greek, so Release 2's walks in German keep
   * what they recorded; a spec of the switch itself passes fewer.
   */
  readyLocales?: Exclude<Locale, "en">[];
  /**
   * Course.outline as stored, instead of the one the lessons make: null for
   * the standard layout (derived from the lessons), anything else as it is
   * (an unreadable list, say).
   */
  outline?: unknown;
}

const json = (v: unknown) =>
  v === undefined ? undefined : v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);

/** The lesson list the lessons make (Course.outline). */
export function outlineOf(lessons: readonly R2LessonSeed[]) {
  return {
    v: 1,
    sections: lessons.map((l) => ({
      id: l.id,
      template: l.template ?? (l.id.startsWith("s-") ? "text" : l.id),
      ...(l.hidden ? { hidden: true } : {}),
      ...(l.label ? { label: l.label } : {}),
    })),
  };
}

/**
 * Seeds a course created in the CMS (any earlier one with the slug is
 * removed first). A published course gets its publishedAt; its badge is made
 * when the first learner finishes it, as for a course published before
 * badges (ensure-course-badge.ts).
 */
export async function seedR2Course(prisma: PrismaClient, seed: R2CourseSeed) {
  await removeR2Course(prisma, seed.slug);
  const title = seed.title ?? { en: `E2E ${seed.slug}` };
  const status = seed.status ?? "published";
  const course = await prisma.course.create({
    data: {
      projectId: PROJECT,
      strapiId: `cms-${seed.slug}`,
      slug: seed.slug,
      cluster: "communication",
      durationMinutes: 15,
      status,
      publishedAt: status === "published" ? new Date() : null,
      readyLocales: seed.readyLocales ?? ["de", "el"],
      outline: json(seed.outline === undefined ? outlineOf(seed.lessons) : seed.outline),
      meta: Object.fromEntries(
        Object.entries(title).map(([l, t]) => [l, { title: t, tagline: "E2E course", clusterLabel: "Communication" }])
      ) as Prisma.InputJsonValue,
    },
    select: { id: true, slug: true },
  });
  for (const l of seed.lessons) {
    const lesson = await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: seed.slug,
        stageKey: l.id,
        narrative: json(l.narrative),
        structure: json(l.structure),
        parts: l.parts ? json({ v: 1, items: [{ id: "main", type: "main" }, ...l.parts] }) : undefined,
        video: json(l.video),
      },
      select: { id: true },
    });
    for (const [i, d] of (l.documents ?? []).entries()) {
      await prisma.lessonDocument.create({
        data: {
          lessonId: lesson.id,
          name: d.name,
          url: d.url,
          mimeType: "application/pdf",
          sizeBytes: 1024,
          order: i,
          published: d.published ?? true,
        },
      });
    }
  }
  return course;
}

/** Removes a seeded course: its lessons and documents, enrolments, badge and audit rows. */
export async function removeR2Course(prisma: PrismaClient, slug: string) {
  await prisma.lesson.deleteMany({ where: { projectId: PROJECT, courseSlug: slug } });
  await prisma.course.deleteMany({ where: { projectId: PROJECT, slug } });
  await prisma.badge.deleteMany({ where: { projectId: PROJECT, slug: { startsWith: slug } } });
  await prisma.auditLog.deleteMany({
    where: { projectId: PROJECT, OR: [{ entityId: slug }, { entityId: { startsWith: `${slug}:` } }] },
  });
}

/* ------------------------------------------------------------ learners --- */

/**
 * A learner of the project (LEARNER membership, so they count as one, D53)
 * with a session, as a sign-in leaves it, and a complete profile in
 * organisation A (e2e/fixtures/people.ts). Any earlier user with the email
 * is removed first.
 */
export async function learnerWithSession(prisma: PrismaClient, email: string) {
  await prisma.user.deleteMany({ where: { email } });
  const { userId, sessionToken } = await createPerson(prisma, { email, roles: ["LEARNER"] });
  return { userId, sessionToken };
}

/** Removes the users (their sessions, memberships, enrolments and badges go with them). */
export async function removeLearners(prisma: PrismaClient, emails: readonly string[]) {
  await prisma.user.deleteMany({ where: { email: { in: [...emails] } } });
}

/**
 * Signs the browser in as the session's user. Open pages are left first: a
 * session read still on its way after the switch would put the old cookie
 * back.
 */
export async function signIn(context: BrowserContext, sessionToken: string) {
  for (const open of context.pages()) await open.goto("about:blank");
  await context.clearCookies();
  await context.addCookies([
    {
      name: "authjs.session-token",
      value: sessionToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
