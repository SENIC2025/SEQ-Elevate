import { NOT_EDITORS, answers, forbidden, type Ctx, type Row, type TableName } from "./kit";

/**
 * The action table's rows for Release 4's Part B (spec 10.5): every export
 * of src/app/actions/lesson-reading.ts. A lesson's further reading, and the
 * languages of its documents, are changed and read for editing by editors,
 * partner admins and ADMINs only (D110); everyone else is refused and
 * nothing changes. Content has no organisation scope, so the refused are
 * the non-editors.
 *
 * Each row aims at the world's course: its lesson of its own, that
 * lesson's published document, and its further-reading link (a draft).
 * e2e/r4-further-reading.spec.ts runs the bad arguments (the hostile
 * addresses, the limits, a lesson not in the list, another project's
 * lesson, link or document) for editors and partner admins, and the
 * positive controls.
 */

const FILE = "src/app/actions/lesson-reading.ts";

/** Posted to the course's page in "Manage courses", where the document card is. */
const coursePage = (c: Ctx) => `/en/content/courses/${c.world.course.slug}`;
/** The world course's lesson of its own. */
const lesson = (c: Ctx) => [c.world.course.slug, c.world.course.lessonId] as const;
/** Fields of a link, unique to the run, so a call that slips through is found. */
const fields = (c: Ctx) => ({
  title: `Refused ${c.run}`,
  url: "https://example.org/refused",
  description: `Refused ${c.run}`,
  languages: ["de"],
});
const TABLES: readonly TableName[] = ["Lesson", "LessonLink", "AuditLog"];

const refused = (name: string, args: (c: Ctx) => unknown[], why: string, tables = TABLES): Row => ({
  kind: "call",
  file: FILE,
  name,
  page: coursePage,
  args,
  refuse: NOT_EDITORS,
  outcome: forbidden,
  tables,
  why,
});

export const rows: Row[] = [
  refused(
    "addLessonLink",
    (c) => [...lesson(c), fields(c)],
    "a lesson's further reading is added by its course's editors only (D110), never a facilitator or a learner"
  ),
  refused(
    "updateLessonLink",
    (c) => [c.world.course.linkId, fields(c)],
    "a further-reading link is changed by its course's editors only (D110)"
  ),
  refused("removeLessonLink", (c) => [c.world.course.linkId], "a further-reading link is removed by its course's editors only (D110)"),
  refused(
    "setLessonLinkOrder",
    (c) => [...lesson(c), c.world.course.linkId ? [c.world.course.linkId] : []],
    "further reading is ordered by its course's editors only (D110)"
  ),
  refused(
    "setLessonLinkPublished",
    // The world's link is a draft: a call that slipped through would show it to learners.
    (c) => [c.world.course.linkId, true],
    "a further-reading link is shown to learners by its course's editors only (D110, as SP33 for documents), never a facilitator"
  ),
  {
    kind: "call",
    file: FILE,
    name: "getLessonLinks",
    page: coursePage,
    args: (c) => [...lesson(c)],
    refuse: NOT_EDITORS,
    outcome: () => answers({ links: [] }),
    tables: TABLES,
    control: {
      as: "EA",
      answer: (r) =>
        typeof r === "object" &&
        r !== null &&
        Array.isArray((r as { links?: unknown }).links) &&
        (r as { links: { title?: string }[] }).links.some((l) => l.title?.startsWith("World reading ")),
      what: "the lesson's further reading, its draft included",
    },
    why: "a lesson's further reading, drafts included, is read in the editor only",
  },
  refused(
    "setLessonDocumentLanguages",
    (c) => [c.world.course.documentId, ["de"]],
    "the languages a document is for are set by its course's editors only (D110)",
    ["LessonDocument", "AuditLog"]
  ),
];
