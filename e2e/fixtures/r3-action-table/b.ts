import { PERSONAS, THROWN, answers, type Persona, type Row } from "./kit";

/**
 * The action table's rows for Stream B's files (spec 17.3): learner.ts
 * (and profile.ts once it exists). A learner's own data is keyed to the
 * session: a save names the account it was loaded for (`forUser`), and one
 * aimed at anyone else is refused; with no session nothing is read or
 * written.
 */

const LEARNER = "src/app/actions/learner.ts";
const PAGE = "/en/learner";

/** No session: the action throws (requireLearner). Signed in: `refused`. */
const otherAccount = (refused: unknown) => (as: Persona) => (as === "anonymous" ? THROWN : answers(refused));

export const rows: Row[] = [
  {
    kind: "call",
    file: LEARNER,
    name: "ensureLearnerMembership",
    page: PAGE,
    args: () => [],
    refuse: ["anonymous"],
    outcome: () => THROWN,
    tables: ["Membership"],
    why: "a learner membership only for the signed-in person",
  },
  {
    kind: "call",
    file: LEARNER,
    name: "loadLearnerGlobal",
    page: PAGE,
    args: () => [],
    refuse: ["anonymous"],
    outcome: () => THROWN,
    tables: ["CompCard"],
    why: "one's own Comp Card, badges and enrolments, only signed in",
  },
  {
    kind: "call",
    file: LEARNER,
    name: "loadCourseProgress",
    page: PAGE,
    args: (c) => [c.world.course.slug, "en"],
    refuse: ["anonymous"],
    outcome: () => THROWN,
    tables: ["CourseEnrollment"],
    why: "one's own progress, only signed in",
  },
  {
    kind: "call",
    file: LEARNER,
    name: "saveCourseProgressPatch",
    page: PAGE,
    args: (c) => [c.world.course.slug, { stagesCompleted: [] }, c.target.userId],
    refuse: PERSONAS,
    outcome: otherAccount({ ok: false, error: "other-account" }),
    tables: ["CourseEnrollment", "UserBadge", "AuditLog"],
    why: "progress is saved only for the account it was loaded for",
  },
  {
    kind: "call",
    file: LEARNER,
    name: "saveCourseProgress",
    page: PAGE,
    args: (c) => [c.world.course.slug, { stagesCompleted: [] }, c.target.userId],
    refuse: PERSONAS,
    outcome: otherAccount(undefined),
    tables: ["CourseEnrollment", "UserBadge", "AuditLog"],
    why: "progress is saved only for the account it was loaded for",
  },
  {
    kind: "call",
    file: LEARNER,
    name: "saveCompCard",
    page: PAGE,
    args: (c) => [
      {
        wentWell: `Overwritten ${c.run}`,
        difficult: "",
        improve: "",
        behaviour: "",
        confidence: 1,
        privacy: "facilitator",
      },
      c.target.userId,
    ],
    refuse: PERSONAS,
    outcome: otherAccount(undefined),
    tables: ["CompCard"],
    why: "a Comp Card is saved only for the account it was loaded for, and never shares it (D80)",
  },
  {
    kind: "call",
    file: LEARNER,
    name: "awardBadgeAction",
    page: PAGE,
    args: (c) => [c.world.course.slug, c.target.userId],
    refuse: PERSONAS,
    outcome: otherAccount({ ok: false, reason: "other-account" }),
    tables: ["UserBadge", "Badge"],
    why: "a badge only for the account it was earned in",
  },
];
