import { COURSE_TABLES, NOT_EDITORS, PERSONAS, answers, forbidden, type Ctx, type Row } from "./kit";

/**
 * The action table's rows for Stream E's files (spec 17.3): course.ts,
 * lesson.ts and sections.ts. Content is edited by editors, partner admins
 * (D76) and ADMINs; everyone else is refused and the course is unchanged.
 */

const COURSE = "src/app/actions/course.ts";
const LESSON = "src/app/actions/lesson.ts";
const SECTIONS = "src/app/actions/sections.ts";

const coursePage = (c: Ctx) => `/en/content/courses/${c.world.course.slug}`;
/** The world course's own lesson. */
const lesson = (c: Ctx) => [c.world.course.slug, c.world.course.lessonId] as const;
/** A refused editor action that answers `{ ok: false, error: "forbidden" }`. */
const refused = (file: string, name: string, args: (c: Ctx) => unknown[], why: string): Row => ({
  kind: "call",
  file,
  name,
  page: coursePage,
  args,
  refuse: NOT_EDITORS,
  outcome: forbidden,
  tables: COURSE_TABLES,
  why,
});

export const rows: Row[] = [
  /* -------------------------------------------------------- course.ts --- */
  {
    kind: "call",
    file: COURSE,
    name: "createCourse",
    page: "/en/content",
    args: (c) => [
      {
        title: `E2E refused ${c.run}`,
        tagline: "Refused",
        cluster: "communication",
        clusterLabel: "Communication",
        durationMinutes: 10,
        locale: "en",
      },
    ],
    refuse: NOT_EDITORS,
    outcome: forbidden,
    tables: COURSE_TABLES,
    why: "editors only create courses",
  },
  refused(COURSE, "setCourseStatus", (c) => [c.world.course.slug, "archived"], "editors only publish or archive"),
  refused(
    COURSE,
    "updateCourseMeta",
    (c) => [c.world.course.slug, "en", { title: `Renamed ${c.run}`, tagline: "Renamed" }],
    "editors only rename a course"
  ),

  /* -------------------------------------------------------- lesson.ts --- */
  {
    kind: "call",
    file: LESSON,
    name: "setLessonDocumentPublished",
    page: coursePage,
    args: (c) => [c.world.course.documentId, false],
    refuse: ["LA1", "anonymous"],
    outcome: forbidden,
    tables: COURSE_TABLES,
    pending: { personas: ["FA", "FB", "FN", "FI"], by: "Stream E: editors only publish documents (SP33, D76)" },
    why: "a document is published or withdrawn by its course's editors only",
  },
  refused(
    LESSON,
    "saveLessonVideo",
    (c) => [...lesson(c), { provider: "file", src: "/demo/sample-lesson.webm", cues: [] }],
    "editors only attach a video"
  ),
  refused(LESSON, "clearLessonVideo", (c) => [...lesson(c)], "editors only remove a video"),
  refused(
    LESSON,
    "addLessonDocument",
    (c) => [...lesson(c), { name: `Refused ${c.run}`, url: "/demo/sample.pdf", mimeType: "application/pdf", sizeBytes: 10 }],
    "editors only attach a document"
  ),
  refused(LESSON, "removeLessonDocument", (c) => [c.world.course.documentId], "editors only remove a document"),
  refused(LESSON, "setLessonDocumentOrder", (c) => [[c.world.course.documentId]], "editors only reorder documents"),
  refused(
    LESSON,
    "saveLessonNarrative",
    (c) => [...lesson(c), "en", { title: `Changed ${c.run}`, blocks: [] }, null],
    "editors only change a lesson's text"
  ),
  refused(LESSON, "clearLessonNarrative", (c) => [...lesson(c), "en", null], "editors only clear a lesson's text"),
  {
    kind: "call",
    file: LESSON,
    name: "getLessonMedia",
    page: coursePage,
    args: (c) => [...lesson(c)],
    refuse: NOT_EDITORS,
    outcome: () => answers({ video: null, documents: [] }),
    tables: COURSE_TABLES,
    why: "a lesson's media, drafts included, is read in the editor only",
  },

  /* ------------------------------------------------------ sections.ts --- */
  refused(
    SECTIONS,
    "addSection",
    (c) => [c.world.course.slug, { kind: "own", template: "text" }, null, "base", true],
    "editors only add a lesson"
  ),
  refused(SECTIONS, "moveSection", (c) => [...lesson(c), 1, "base", true], "editors only move a lesson"),
  refused(SECTIONS, "setSectionHidden", (c) => [...lesson(c), true, "base", true], "editors only hide a lesson"),
  refused(
    SECTIONS,
    "renameSection",
    (c) => [...lesson(c), "en", `Renamed ${c.run}`, null],
    "editors only name a lesson"
  ),
  refused(SECTIONS, "deleteSection", (c) => [...lesson(c), "base", null], "editors only delete a lesson"),
  {
    kind: "call",
    file: SECTIONS,
    name: "repairOutline",
    page: "/en/dev/cms-check",
    args: (c) => [c.world.course.slug],
    refuse: PERSONAS,
    outcome: forbidden,
    tables: COURSE_TABLES,
    why: "the repair tool is an ADMIN's only (spec 3.4), editors and partner admins included",
  },
];
