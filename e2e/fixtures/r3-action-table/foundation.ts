import {
  COURSE_TABLES,
  NOT_EDITORS,
  PERSONAS,
  THROWN,
  answers,
  forbidden,
  type Ctx,
  type Row,
} from "./kit";

/**
 * The action table's rows for the files the Foundation owns
 * (facilitator.ts, demo.ts) and those no stream owns (auth.ts, a11y.ts,
 * telemetry.ts, video.ts, parts.ts, structure.ts, comp-card-template.ts).
 */

const FACILITATOR = "src/app/actions/facilitator.ts";
const PARTS = "src/app/actions/parts.ts";
const STRUCTURE = "src/app/actions/structure.ts";
const TEMPLATE = "src/app/actions/comp-card-template.ts";
const A11Y = "src/app/actions/a11y.ts";
const TELEMETRY = "src/app/actions/telemetry.ts";
const VIDEO = "src/app/actions/video.ts";

const coursePage = (c: Ctx) => `/en/content/courses/${c.world.course.slug}`;
const playerPage = (c: Ctx) => `/en/learner/course/${c.world.course.slug}`;
/** The world course's own lesson and its extra content. */
const lesson = (c: Ctx) => [c.world.course.slug, c.world.course.lessonId] as const;
const part = (c: Ctx) => [...lesson(c), c.world.course.partId] as const;
/** A refused editor action that answers `{ ok: false, error: "forbidden" }`. */
const editorAction = (file: string, name: string, args: (c: Ctx) => unknown[], why: string): Row => ({
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
/** Signed-in people act on their own data; with no session the action does nothing and answers nothing. */
const ownData = () => answers(undefined);

export const rows: Row[] = [
  /* --------------------------------------------------- facilitator.ts --- */
  {
    kind: "call",
    file: FACILITATOR,
    name: "saveObservation",
    page: "/en/facilitator",
    args: (c) => [c.target.userId, `A note ${c.run}`],
    refuse: PERSONAS,
    outcome: () => answers({ ok: false }),
    tables: ["Observation", "AuditLog"],
    why: "a note only about a learner in the writer's scope (SP6)",
  },
  {
    kind: "call",
    file: FACILITATOR,
    name: "recordValidation",
    page: "/en/facilitator",
    args: (c) => [c.target.userId, "communicationEi", `Evidence ${c.run}`],
    refuse: PERSONAS,
    outcome: () => answers({ ok: false }),
    tables: ["Validation", "AuditLog"],
    why: "a validation only about a learner in the writer's scope (SP7)",
  },

  /* ---------------------------------------------------------- demo.ts --- */
  {
    kind: "call",
    file: "src/app/actions/demo.ts",
    name: "demoSignIn",
    page: "/en/demo",
    args: () => ["learner", "not-the-access-code"],
    refuse: PERSONAS,
    outcome: () => answers({ ok: false, error: "bad-code" }),
    tables: ["User", "Session", "Membership", "ProjectProfile"],
    why: "test sign-in only with the deployment's access code (D98)",
  },

  /* ---------------------------------------------------------- auth.ts --- */
  {
    kind: "open",
    file: "src/app/actions/auth.ts",
    name: "signInWithEmail",
    why: "signing in by email is open to everyone (rate-limited); it takes a form, not arguments",
  },
  {
    kind: "unbuilt",
    file: "src/app/actions/auth.ts",
    name: "signOutAction",
    why: "no page imports it",
  },

  /* ---------------------------------------------------------- a11y.ts --- */
  {
    kind: "call",
    file: A11Y,
    name: "loadA11yPrefs",
    page: "/en/learner",
    args: () => [],
    refuse: ["anonymous"],
    outcome: () => THROWN,
    tables: ["User"],
    why: "reading help settings: one's own only, and only signed in",
  },
  {
    kind: "call",
    file: A11Y,
    name: "saveA11yPrefs",
    page: "/en/learner",
    args: (c) => [{ fontSize: "xl", dyslexia: true, contrast: true }, c.target.userId],
    refuse: PERSONAS,
    outcome: (as) => (as === "anonymous" ? THROWN : answers(false)),
    tables: ["User"],
    why: "reading help settings are saved only for the account that loaded them",
  },

  /* ------------------------------------------- telemetry.ts, video.ts --- */
  {
    kind: "call",
    file: TELEMETRY,
    name: "recordCourseOpened",
    page: playerPage,
    args: (c) => [c.world.course.slug],
    refuse: ["anonymous"],
    outcome: ownData,
    tables: ["AuditLog"],
    why: "telemetry is the signed-in person's own; a guest writes nothing",
  },
  {
    kind: "call",
    file: TELEMETRY,
    name: "recordStageTime",
    page: playerPage,
    args: (c) => [{ courseSlug: c.world.course.slug, stage: c.world.course.lessonId, seconds: 30 }],
    refuse: ["anonymous"],
    outcome: ownData,
    tables: ["AuditLog"],
    why: "telemetry is the signed-in person's own; a guest writes nothing",
  },
  {
    kind: "call",
    file: VIDEO,
    name: "recordVideoCueAnswer",
    page: playerPage,
    args: (c) => [{ courseSlug: c.world.course.slug, cueId: `cue-${c.run}`, correct: true }],
    refuse: ["anonymous"],
    outcome: ownData,
    tables: ["AuditLog"],
    why: "video answers are the signed-in person's own; a guest writes nothing",
  },

  /* --------------------------------------------------------- parts.ts --- */
  {
    kind: "call",
    file: PARTS,
    name: "getPart",
    page: coursePage,
    args: (c) => [...part(c)],
    refuse: NOT_EDITORS,
    outcome: () => answers(null),
    tables: COURSE_TABLES,
    why: "editors only read a lesson's extra content in the editor",
  },
  editorAction(PARTS, "addPart", (c) => [...lesson(c), "text", null, "base", true], "editors only add content"),
  editorAction(PARTS, "movePart", (c) => [...part(c), -1, "base", true], "editors only move content"),
  editorAction(PARTS, "removePart", (c) => [...part(c), "base", null, true], "editors only remove content"),
  editorAction(
    PARTS,
    "savePartText",
    (c) => [...part(c), "en", [{ kind: "paragraph", text: `Changed ${c.run}` }], null],
    "editors only change content"
  ),
  editorAction(PARTS, "savePart", (c) => [...part(c), {}, {}], "editors only change content"),
  editorAction(PARTS, "savePartDraft", (c) => [...part(c), {}, {}], "editors only change content"),
  editorAction(PARTS, "discardPartDraft", (c) => [...part(c), {}], "editors only change content"),

  /* ----------------------------------------------------- structure.ts --- */
  {
    kind: "call",
    file: STRUCTURE,
    name: "getStructure",
    page: coursePage,
    args: (c) => [...lesson(c)],
    refuse: NOT_EDITORS,
    outcome: () => answers(null),
    tables: COURSE_TABLES,
    why: "editors only read an exercise in the editor",
  },
  editorAction(STRUCTURE, "saveStructure", (c) => [...lesson(c), {}, {}, true], "editors only change exercises"),
  editorAction(STRUCTURE, "saveStructureDraft", (c) => [...lesson(c), {}, {}], "editors only change exercises"),
  editorAction(STRUCTURE, "discardStructureDraft", (c) => [...lesson(c), {}], "editors only change exercises"),
  editorAction(STRUCTURE, "clearStructure", (c) => [...lesson(c), {}], "editors only change exercises"),

  /* ---------------------------------------------- comp-card-template.ts --- */
  {
    kind: "call",
    file: TEMPLATE,
    name: "getCompCardEditorState",
    page: "/en/content",
    args: () => ["el"],
    refuse: NOT_EDITORS,
    outcome: () => answers(null),
    tables: ["Project"],
    why: "editors only read the Comp Card template in the editor",
  },
  {
    kind: "call",
    file: TEMPLATE,
    name: "saveCompCardTemplate",
    page: "/en/content",
    args: (c) => ["el", [{ key: "wentWell", label: `Changed ${c.run}` }], []],
    refuse: NOT_EDITORS,
    outcome: forbidden,
    tables: ["Project"],
    why: "editors only change the Comp Card template",
  },
  {
    kind: "call",
    file: TEMPLATE,
    name: "clearCompCardTemplate",
    page: "/en/content",
    args: () => ["el"],
    refuse: NOT_EDITORS,
    outcome: forbidden,
    tables: ["Project"],
    why: "editors only reset the Comp Card template (the answer proves it: other specs change the template meanwhile)",
  },
];
