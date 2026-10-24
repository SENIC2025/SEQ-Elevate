import { NOT_EDITORS, answers, forbidden, type Ctx, type Row } from "./kit";

/**
 * The action table's rows for Release 4's references (spec 10.5): every
 * export of src/app/actions/course-references.ts. A course's references
 * are written and read for editing by its editors, partner admins and
 * ADMINs only (D110); everyone else is refused and nothing changes.
 *
 * The references row itself (CourseBibliography) isn't one of the kit's
 * tables: e2e/r4-references.spec.ts runs these rows too and compares it,
 * with the bad arguments (a built-in or unknown course, an unknown
 * language, a stale base, the hostile links) and the positive controls.
 */

const FILE = "src/app/actions/course-references.ts";

/** Posted to the course's page in "Manage courses", where the editor is. */
const coursePage = (c: Ctx) => `/en/content/courses/${c.world.course.slug}`;

/** A one-paragraph list, as the editor sends it: unique to the run, so a call that slips through is found. */
export const refusedList = (c: Ctx) => ({
  rich: {
    v: 1,
    doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Refused ${c.run} (2020).` }] }] },
  },
});

export const rows: Row[] = [
  {
    kind: "call",
    file: FILE,
    name: "saveCourseReferences",
    page: coursePage,
    args: (c) => [c.world.course.slug, "en", refusedList(c), null],
    refuse: NOT_EDITORS,
    outcome: forbidden,
    tables: ["Course", "AuditLog"],
    why: "a course's references and bibliography are written by its editors only (D110), never a facilitator or a learner",
  },
  {
    kind: "call",
    file: FILE,
    name: "loadCourseReferencesForEditor",
    page: coursePage,
    args: (c) => [c.world.course.slug],
    refuse: NOT_EDITORS,
    outcome: () => answers(null),
    tables: ["Course", "AuditLog"],
    control: {
      as: "EA",
      answer: (r) => typeof r === "object" && r !== null && typeof (r as { locales?: unknown }).locales === "object",
      what: "the course's lists, every language",
    },
    why: "a course's references are read for editing by its editors only",
  },
];
