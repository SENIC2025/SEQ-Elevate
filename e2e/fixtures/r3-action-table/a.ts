import { NOT_PEOPLE_MANAGERS, PEOPLE_TABLES, forbidden, type Row } from "./kit";

/**
 * The action table's rows for Stream A's files (spec 17.3): admin.ts.
 * Every call is aimed outside the caller's reach: another organisation, or
 * its cohort, or a person the caller may not manage (kit.ts, targetOf).
 * Until Stream A lets partner admins manage their own organisation, every
 * action of admin.ts is ADMIN-only, so a partner admin is refused there
 * too; Stream A keeps these rows current (a partner admin's refusal of
 * another organisation's person may then answer "out-of-scope"). Until
 * then the partner admin's refusals are role guards (partnerAdmin: "role");
 * a row whose refusal becomes the organisation's turns "scope", a guard the
 * scope control (spec 18.3) must show failing.
 */

const ADMIN = "src/app/actions/admin.ts";
const PEOPLE = "/en/admin/people";
const ORGANISATIONS = "/en/admin/cohorts";

export const rows: Row[] = [
  {
    kind: "call",
    file: ADMIN,
    name: "createOrganisation",
    page: ORGANISATIONS,
    args: (c) => [`E2E refused ${c.run}`, `R ${c.run}`],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: ["Organisation", "AuditLog"],
    why: "only an ADMIN with project scope creates organisations (SP16)",
  },
  {
    kind: "call",
    file: ADMIN,
    name: "deleteOrganisation",
    page: ORGANISATIONS,
    args: (c) => [c.other.id],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: ["Organisation", "Cohort", "ProjectProfile", "AuditLog"],
    why: "only an ADMIN with project scope deletes organisations (SP16)",
  },
  {
    kind: "call",
    file: ADMIN,
    name: "createCohort",
    page: ORGANISATIONS,
    args: (c) => [c.other.id, `E2E refused cohort ${c.run}`],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: ["Cohort", "AuditLog"],
    why: "a cohort only in an organisation in scope (SP17)",
  },
  {
    kind: "unbuilt",
    file: ADMIN,
    name: "updateCohort",
    why: "no page imports it yet (when one does, it needs a row that calls it: only a cohort in scope is changed, SP18)",
  },
  {
    kind: "call",
    file: ADMIN,
    name: "deleteCohort",
    page: ORGANISATIONS,
    args: (c) => [c.other.cohortId],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: ["Cohort", "Membership", "AuditLog"],
    why: "only a cohort in scope is deleted (SP18)",
  },
  {
    kind: "call",
    file: ADMIN,
    name: "addMember",
    page: PEOPLE,
    args: (c) => [c.target.email, "FACILITATOR", `Renamed ${c.run}`, { invite: true, locale: "en" }],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: [...PEOPLE_TABLES, "VerificationToken"],
    why: "no one outside the caller's scope is added, renamed or invited (SP19)",
  },
  {
    kind: "call",
    file: ADMIN,
    name: "resendInvitation",
    page: PEOPLE,
    args: (c) => [c.target.userId, "en"],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: ["AuditLog", "VerificationToken"],
    why: "invitations only for people in scope (SP20)",
  },
  {
    kind: "call",
    file: ADMIN,
    name: "setMemberRoles",
    page: PEOPLE,
    args: (c) => [c.target.userId, ["FACILITATOR"]],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: PEOPLE_TABLES,
    why: "roles only of people in scope, and only grantable ones (SP21)",
  },
  {
    kind: "call",
    file: ADMIN,
    name: "assignCohort",
    page: PEOPLE,
    args: (c) => [c.target.userId, c.other.cohortId],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: [...PEOPLE_TABLES, "Cohort"],
    why: "a cohort only for a person in scope, never moving their organisation (SP22)",
  },
  {
    kind: "call",
    file: ADMIN,
    name: "removeMember",
    page: PEOPLE,
    args: (c) => [c.target.userId],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: PEOPLE_TABLES,
    why: "only people in scope are removed (SP23)",
  },
];
