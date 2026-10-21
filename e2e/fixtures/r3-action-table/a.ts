import { NOT_PEOPLE_MANAGERS, PEOPLE_TABLES, answers, forbidden, type Persona, type Row } from "./kit";

/**
 * The action table's rows for Stream A's files (spec 17.3): admin.ts.
 * Every call is aimed outside the caller's reach: another organisation, or
 * its cohort, or a person the caller may not manage (kit.ts, targetOf).
 *
 * Who is refused, and why (spec 3.4 SP16–SP26):
 * - organisations and the country mapping are an ADMIN's: everyone else,
 *   the partner admin included, is "forbidden" (partnerAdmin: "role", a
 *   role guard);
 * - people and cohorts are a people manager's, within its scope: everyone
 *   but the partner admin is "forbidden"; the partner admin manages its
 *   own organisation, so it is refused because the target is another
 *   organisation's (partnerAdmin: "scope", a guard the scope control of
 *   spec 18.3 shows failing), answered as someone or something unknown
 *   ("not-found", "unknown-org", "unknown-cohort"), or, adding an address
 *   in use elsewhere, "out-of-scope". Its calls within its organisation
 *   succeed: e2e/r3-people.spec.ts is their positive control.
 */

const ADMIN = "src/app/actions/admin.ts";
const PEOPLE = "/en/admin/people";
const ORGANISATIONS = "/en/admin/cohorts";

/** The partner admin's refusal of a target outside its organisation; everyone else's "forbidden". */
const outOfReach = (error: string) => (as: Persona) => (as === "PAA" ? answers({ ok: false, error }) : forbidden());

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
    name: "setCountryMapping",
    page: ORGANISATIONS,
    args: (c) => ["GR", c.other.id, { assignUnplaced: true }],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: ["CountryMapping", "ProjectProfile", "CompCard", "AuditLog"],
    why: "only an ADMIN with project scope maps a country to an organisation, or places learners by it (SP25)",
  },
  {
    kind: "call",
    file: ADMIN,
    name: "createCohort",
    page: ORGANISATIONS,
    args: (c) => [c.other.id, `E2E refused cohort ${c.run}`],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "scope",
    outcome: outOfReach("unknown-org"),
    tables: ["Cohort", "AuditLog"],
    why: "a cohort only in an organisation in scope (SP17)",
  },
  {
    kind: "call",
    file: ADMIN,
    name: "updateCohort",
    page: ORGANISATIONS,
    args: (c) => [c.other.cohortId, { name: `E2E refused cohort ${c.run}` }],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "scope",
    outcome: outOfReach("unknown-cohort"),
    tables: ["Cohort", "AuditLog"],
    why: "only a cohort in scope is renamed (SP18)",
  },
  {
    kind: "call",
    file: ADMIN,
    name: "deleteCohort",
    page: ORGANISATIONS,
    args: (c) => [c.other.cohortId],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "scope",
    outcome: outOfReach("unknown-cohort"),
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
    partnerAdmin: "scope",
    outcome: outOfReach("out-of-scope"),
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
    partnerAdmin: "scope",
    outcome: outOfReach("not-found"),
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
    partnerAdmin: "scope",
    outcome: outOfReach("not-found"),
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
    partnerAdmin: "scope",
    outcome: outOfReach("not-found"),
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
    partnerAdmin: "scope",
    outcome: outOfReach("not-found"),
    tables: PEOPLE_TABLES,
    why: "only people in scope are removed (SP23)",
  },
  {
    kind: "call",
    file: ADMIN,
    name: "updatePersonProfile",
    page: PEOPLE,
    args: (c) => [c.target.userId, { name: `Renamed ${c.run}` }],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "scope",
    outcome: outOfReach("not-found"),
    tables: PEOPLE_TABLES,
    why: "a name only of someone in scope; country and organisation only by an ADMIN (SP26)",
  },
  {
    kind: "call",
    file: ADMIN,
    name: "setGuardianSharing",
    page: PEOPLE,
    args: (c) => [c.target.userId, false],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "scope",
    outcome: outOfReach("not-found"),
    tables: PEOPLE_TABLES,
    why: "a guardian's permission only for a learner in scope (SP19a)",
  },
];
