import { PERSONAS, THROWN, answers, type Persona, type Row } from "./kit";

/**
 * The action table's rows for Stream B's files (spec 17.3): learner.ts and
 * profile.ts, and the route a page sends a course save to as it goes
 * (POST /api/progress/beacon, D37), which saves through learner.ts. A
 * learner's own data is keyed to the session: a save names the account it
 * was loaded for (`forUser`), and one aimed at anyone else is refused;
 * with no session nothing is read or written. The profile step
 * takes no one's id at all: it is the signed-in person's own, and after
 * the first completion a call changes only the Terms, the consent and a
 * blank name (SP34).
 */

const LEARNER = "src/app/actions/learner.ts";
const PROFILE = "src/app/actions/profile.ts";
const PAGE = "/en/learner";

/** The e2e server's own origin: the beacon route refuses any other. */
const appOrigin = () => `http://localhost:${process.env.E2E_PORT ?? "3000"}`;

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
    partnerAdmin: "anyone",
    outcome: otherAccount({ ok: false, error: "other-account" }),
    tables: ["CourseEnrollment", "UserBadge", "AuditLog"],
    why: "progress is saved only for the account it was loaded for",
  },
  {
    kind: "route",
    route: "POST /api/progress/beacon",
    method: "POST",
    path: () => "/api/progress/beacon",
    // This site's own page, and a well-formed save: only whose it is is wrong.
    headers: () => ({ Origin: appOrigin(), "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }),
    body: (c) => ({ v: 1, slug: c.world.course.slug, forUser: c.target.userId, patch: { v: 2, completed: ["context"] } }),
    refuse: PERSONAS,
    partnerAdmin: "anyone",
    status: (as) => (as === "anonymous" ? 401 : 403),
    tables: ["CourseEnrollment", "UserBadge", "AuditLog"],
    why: "a course save sent as the page goes is saved only for the account it was loaded for (D37)",
  },
  {
    kind: "call",
    file: LEARNER,
    name: "saveCourseProgress",
    page: PAGE,
    args: (c) => [c.world.course.slug, { stagesCompleted: [] }, c.target.userId],
    refuse: PERSONAS,
    partnerAdmin: "anyone",
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
    partnerAdmin: "anyone",
    outcome: otherAccount({ ok: false, error: "other-account" }),
    tables: ["CompCard"],
    why: "a Comp Card is saved only for the account it was loaded for, and never shares it (D80)",
  },
  {
    kind: "call",
    file: LEARNER,
    name: "setCompCardSharing",
    page: "/en/learner/comp-card",
    args: (c) => ["facilitators", c.target.userId],
    refuse: PERSONAS,
    partnerAdmin: "anyone",
    outcome: otherAccount({ ok: false, error: "other-account" }),
    tables: ["CompCard", "AuditLog"],
    why: "a Comp Card's sharing changes only for the account it was loaded for (D80, SP34)",
  },
  {
    kind: "call",
    file: PROFILE,
    name: "completeProfile",
    page: "/en/welcome",
    args: (c) => [
      {
        name: `Renamed ${c.run}`,
        country: "CY",
        age: "invited",
        termsAccepted: true,
        consent: true,
        organisationId: c.other.id,
        userId: c.target.userId,
      },
    ],
    refuse: PERSONAS,
    partnerAdmin: "anyone",
    // A completed profile: another country, age rule, organisation or name
    // sent again changes nothing ("ok", nothing to store). FI's profile isn't
    // complete: its first completion is refused, as the invited age rule
    // needs a guardian's permission an inviter recorded. No session: no one.
    outcome: (as) =>
      as === "anonymous"
        ? answers({ ok: false, error: "signed-out" })
        : as === "FI"
          ? answers({ ok: false, errors: { age: "not-invited" } })
          : answers({ ok: true }),
    tables: ["ProjectProfile", "User", "Membership", "CompCard", "AuditLog"],
    why: "the profile step is one's own: no one else's, and after the first completion no country, age rule, organisation or name (SP34, UB2)",
  },
  {
    kind: "call",
    file: LEARNER,
    name: "claimGuestWork",
    page: PAGE,
    args: (c) => [
      {
        claim: 1,
        course: { slug: c.world.course.slug, patch: { v: 2, completed: ["context"] } },
        compCard: { wentWell: `Overwritten ${c.run}`, difficult: "", improve: "", behaviour: "", confidence: 1 },
        badges: [],
      },
      c.target.userId,
    ],
    refuse: PERSONAS,
    partnerAdmin: "anyone",
    outcome: otherAccount({ ok: false, error: "other-account" }),
    tables: ["CourseEnrollment", "CompCard", "UserBadge"],
    why: "a browser's guest work is added only to the account it was loaded for (D79)",
  },
  {
    kind: "call",
    file: LEARNER,
    name: "awardBadgeAction",
    page: PAGE,
    args: (c) => [c.world.course.slug, c.target.userId],
    refuse: PERSONAS,
    partnerAdmin: "anyone",
    outcome: otherAccount({ ok: false, reason: "other-account" }),
    tables: ["UserBadge", "Badge"],
    why: "a badge only for the account it was earned in",
  },
];
