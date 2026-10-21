import type { PrismaClient } from "@prisma/client";
import type { ActionAnswer } from "../server-action";
import type { OrganisationKey, Person, World, WorldKey, WorldOrganisation } from "../people";

/**
 * Release 3 (spec 18.3): what a row of the action table says, and the
 * helpers the table files share. The table lists every exported server
 * action (and every route a stream names) with: the page to post to, the
 * arguments that aim it at someone the caller must not reach, the personas
 * that must be refused, what a refusal answers, and the tables that must
 * not change. e2e/r3-actions.spec.ts runs it, and fails when an exported
 * action has no row.
 *
 * Each stream keeps the rows of the files it owns (spec 17.3) in its own
 * file of this folder; the Foundation keeps the rows of files no stream
 * owns.
 */

/** Who calls: the world's people of spec 18.2's FD-E11, and someone with no session. */
export const PERSONAS = ["FA", "FB", "FN", "FI", "PAA", "EA", "LA1", "anonymous"] as const;
export type Persona = (typeof PERSONAS)[number];

/** Everyone but the ADMINs and the editor's own work: the default refusal list of a people or staff action. */
export const NOT_PEOPLE_MANAGERS: readonly Persona[] = ["FA", "FB", "FN", "FI", "PAA", "EA", "LA1", "anonymous"];
/** Who may not edit content: everyone but the editor and the partner admin (D76: a partner admin edits every course). */
export const NOT_EDITORS: readonly Persona[] = ["FA", "FB", "FN", "FI", "LA1", "anonymous"];

/**
 * The person a call is aimed at: one the caller must not reach.
 *   FA, PAA   a learner of another organisation (LB1)
 *   FB        a learner of another organisation (LA1)
 *   FN        anyone: staff with no organisation reach no one (LA1)
 *   FI        a learner of their own organisation: staff whose own profile
 *             isn't complete reach no one (LA2)
 *   EA        a learner of their own organisation: an editor supports no
 *             one (LA2)
 *   LA1       another learner (LA2)
 *   anonymous another learner (LA2)
 */
export function targetOf(as: Persona): WorldKey {
  switch (as) {
    case "FA":
    case "PAA":
      return "LB1";
    case "FB":
    case "FN":
      return "LA1";
    default:
      return "LA2";
  }
}

/** An organisation that isn't the caller's (B, or A for FB). */
export function otherOrganisationOf(as: Persona): OrganisationKey {
  return as === "FB" ? "A" : "B";
}

/** What a row's arguments are built from. */
export interface Ctx {
  world: World;
  as: Persona;
  /** The person the call is aimed at (targetOf). */
  target: Person;
  /** An organisation that isn't the caller's, with a cohort of it. */
  other: WorldOrganisation;
  /** Unique to the run: names made by a call that slips through can be found. */
  run: string;
}

/** What a refused call must answer. */
export type Outcome =
  /** The action returned this (compared with toEqual). */
  | { result: unknown }
  /** The action threw (a production build sends only a digest). */
  | { thrown: true };

export const answers = (result: unknown): Outcome => ({ result });
export const THROWN: Outcome = { thrown: true };
/** `{ ok: false, error: "forbidden" }` for everyone. */
export const forbidden = (): Outcome => answers({ ok: false, error: "forbidden" });

/** The tables a call may touch, each read only where it holds the world's rows (see snapshot). */
export type TableName =
  | "User"
  | "Membership"
  | "ProjectProfile"
  | "Session"
  | "StaffHistory"
  | "CompCard"
  | "Observation"
  | "Validation"
  | "CourseEnrollment"
  | "UserBadge"
  | "AuditLog"
  | "Organisation"
  | "Cohort"
  | "CountryMapping"
  | "Course"
  | "Lesson"
  | "LessonDocument"
  | "Badge"
  | "Project"
  | "VerificationToken";

/** The tables about people: what a call about a person may touch. */
export const PEOPLE_TABLES: readonly TableName[] = [
  "User",
  "Membership",
  "ProjectProfile",
  "Session",
  "StaffHistory",
  "CompCard",
  "Observation",
  "Validation",
  "CourseEnrollment",
  "UserBadge",
  "AuditLog",
];
/** The tables of a course's content. */
export const COURSE_TABLES: readonly TableName[] = ["Course", "Lesson", "LessonDocument", "Badge", "AuditLog"];

/**
 * Why a row refuses the partner admin. The role doesn't exist before
 * Release 3, so its refusal can't be shown red on the old build; a
 * negative control (spec 18.3) shows it can fail instead, and which one
 * depends on what refuses it:
 *   "scope"   the target is outside its organisation: a guard, red when
 *             every staff role gets project scope and inScope answers true
 *   "role"    the action needs a power the role doesn't carry (an
 *             ADMIN's): a role guard, red when a partner admin holds
 *             ADMIN's powers
 *   "anyone"  it is refused as any other signed-in person is (someone
 *             else's own data, a wrong access code): the role plays no
 *             part, so the row is no guard
 */
export type PartnerAdminRefusal = "scope" | "role" | "anyone";

interface Base {
  /** One line: what the row proves. */
  why: string;
}

interface RefusesPartnerAdmin {
  /** Why the partner admin is refused: required when `refuse` names it (coverage.test.ts). */
  partnerAdmin?: PartnerAdminRefusal;
}

/** A server action, called directly as each persona in `refuse`. */
export interface CallRow extends Base, RefusesPartnerAdmin {
  kind: "call";
  /** The "use server" file, from the repository root. */
  file: string;
  /** Its exported name. */
  name: string;
  /** The page posted to. */
  page: string | ((c: Ctx) => string);
  args: (c: Ctx) => unknown[];
  /** The personas that must be refused. */
  refuse: readonly Persona[];
  /** What each refused persona's call answers. */
  outcome: (as: Persona) => Outcome;
  /** The tables that must not change. */
  tables: readonly TableName[];
  /**
   * Personas the owning stream's change will refuse, which today's code
   * still lets through: run as `fixme` until that stream lands the change
   * and moves them into `refuse`.
   */
  pending?: { personas: readonly Persona[]; by: string };
  /**
   * For a read whose refusal looks like an empty answer (null): someone it
   * serves, and what they get, so the refusals are shown to come from who
   * calls and not from the data (a row that answers null to everyone can't
   * fail).
   */
  control?: { as: Persona; answer: (result: unknown) => boolean; what: string };
}

/**
 * An export no page imports: the build gives it no action id, so no
 * request can reach it. The spec checks that the build indeed has none.
 */
export interface UnbuiltRow extends Base {
  kind: "unbuilt";
  file: string;
  name: string;
}

/** An action open to everyone by design (signing in by email). */
export interface OpenRow extends Base {
  kind: "open";
  file: string;
  name: string;
}

/** A route, requested directly as each persona in `refuse`. */
export interface RouteRow extends Base, RefusesPartnerAdmin {
  kind: "route";
  /** "METHOD /path/[param]": what the row is known by. */
  route: string;
  method: "GET" | "POST";
  path: (c: Ctx) => string;
  headers?: (c: Ctx) => Record<string, string>;
  body?: (c: Ctx) => unknown;
  refuse: readonly Persona[];
  /** The status each refused persona gets. */
  status: (as: Persona) => number;
  tables: readonly TableName[];
  pending?: { personas: readonly Persona[]; by: string };
}

export type Row = CallRow | UnbuiltRow | OpenRow | RouteRow;

/** A row's name: "file#export" for an action, the route for a route. */
export const rowKey = (row: Row) => (row.kind === "route" ? row.route : `${row.file}#${row.name}`);

/**
 * What a refusal's title adds for the partner admin: the negative control
 * that can show it failing (PartnerAdminRefusal). A row that doesn't say
 * is taken for a scope guard, so the scope control shows whether it fails.
 */
export function guardLabel(row: CallRow | RouteRow, as: Persona): string {
  if (as !== "PAA") return "";
  switch (row.partnerAdmin) {
    case "role":
      return " (role guard)";
    case "anyone":
      return "";
    default:
      return " (guard)";
  }
}

/**
 * Does the call's answer match the outcome? A throw is the action's own
 * thrown error only: Next answers it with status 500 and an RSC payload
 * whose result is an `E` row. A response with no action result in it (the
 * page doesn't serve that action: Next's 404 "Server action not found.", an
 * error page, an empty body) means the action never ran, so it is no throw.
 */
export function matches(answer: ActionAnswer, outcome: Outcome): { ok: boolean; got: unknown } {
  if ("thrown" in outcome) {
    const ok = answer.thrown === true && answer.status === 500 && answer.contentType.includes("text/x-component");
    return { ok, got: answer.thrown ? `threw ${answer.error}` : `${answer.error ?? answer.result} (status ${answer.status})` };
  }
  return {
    ok: answer.error === undefined && JSON.stringify(answer.result) === JSON.stringify(outcome.result),
    got: answer.error !== undefined ? `threw ${answer.error}` : answer.result,
  };
}

/* ---------------------------------------------------------- snapshots --- */

/**
 * Each table's rows that belong to the world (or that a call aimed at it
 * could make, found by the run's marker), so that what other specs running
 * at the same time write never shows. A refusal may be logged (an audit
 * action ending in "_refused"); nothing else may change. A session's
 * expiry is left out: Auth.js extends a session it reads.
 */
function filterOf(table: TableName, world: World): { columns: string; where: string; params: unknown[] } {
  const users = Object.values(world.people).map((p) => p.userId);
  const emails = Object.values(world.people).map((p) => p.email);
  const orgs = Object.values(world.organisations).map((o) => o.id);
  const cohorts = Object.values(world.organisations).map((o) => o.cohortId);
  const like = `%${world.run}%`;
  const all = "t.*";
  switch (table) {
    case "User":
      return { columns: all, where: `"id" = ANY($1::text[])`, params: [users] };
    case "Membership":
    case "ProjectProfile":
    case "StaffHistory":
    case "CompCard":
    case "UserBadge":
      return { columns: all, where: `"userId" = ANY($1::text[])`, params: [users] };
    case "Session":
      return { columns: `t."id", t."sessionToken", t."userId"`, where: `"userId" = ANY($1::text[])`, params: [users] };
    case "Observation":
      return { columns: all, where: `"observedId" = ANY($1::text[]) OR "observerId" = ANY($1::text[])`, params: [users] };
    case "Validation":
      return { columns: all, where: `"validatedId" = ANY($1::text[]) OR "validatorId" = ANY($1::text[])`, params: [users] };
    case "CourseEnrollment":
      return { columns: all, where: `"userId" = ANY($1::text[]) OR "courseId" = $2`, params: [users, world.course.id] };
    case "AuditLog":
      return {
        columns: all,
        where: `("actorId" = ANY($1::text[]) OR "entityId" = ANY($2::text[]) OR "entityId" LIKE $3) AND "action" NOT LIKE '%\\_refused'`,
        params: [
          users,
          [...users, ...orgs, ...cohorts, world.course.id, world.course.slug, world.course.documentId],
          like,
        ],
      };
    case "Organisation":
      return { columns: all, where: `"id" = ANY($1::text[]) OR "name" LIKE $2`, params: [orgs, like] };
    case "Cohort":
      return {
        columns: all,
        where: `"id" = ANY($1::text[]) OR "organisationId" = ANY($2::text[]) OR "name" LIKE $3`,
        params: [cohorts, orgs, like],
      };
    case "CountryMapping":
      // Rows naming the world's organisations only: a refused call aims at
      // one of them (Ctx.other), and other specs set the mapping meanwhile.
      return { columns: all, where: `"organisationId" = ANY($1::text[])`, params: [orgs] };
    case "Course":
      return { columns: all, where: `"id" = $1 OR "slug" LIKE $2`, params: [world.course.id, like] };
    case "Lesson":
      return { columns: all, where: `"courseSlug" LIKE $1`, params: [like] };
    case "LessonDocument":
      return {
        columns: all,
        where: `"lessonId" IN (SELECT "id" FROM "Lesson" WHERE "courseSlug" LIKE $1) OR "name" LIKE $1`,
        params: [like],
      };
    case "Badge":
      return { columns: all, where: `"slug" LIKE $1`, params: [like] };
    case "Project":
      // Only whether the run's marker landed in the project's settings (a
      // refused Comp Card template save names it): other specs change the
      // template at the same time.
      return { columns: `(t."compCardTemplate"::text LIKE $1) AS marked`, where: `"id" = 'seq-elevate'`, params: [like] };
    case "VerificationToken":
      return { columns: all, where: `"identifier" = ANY($1::text[])`, params: [emails] };
  }
}

export type Snapshot = Record<string, { rows: number; sum: string } | "absent">;

/** A row count and checksum of each table's world rows. */
export async function snapshot(prisma: PrismaClient, world: World, tables: readonly TableName[]): Promise<Snapshot> {
  const out: Snapshot = {};
  for (const table of tables) {
    const [exists] = await prisma.$queryRawUnsafe<{ t: string | null }[]>(`SELECT to_regclass('"${table}"')::text AS t`);
    if (!exists.t) {
      out[table] = "absent";
      continue;
    }
    const { columns, where, params } = filterOf(table, world);
    const [row] = await prisma.$queryRawUnsafe<{ rows: number; sum: string }[]>(
      `SELECT count(*)::int AS rows,
              coalesce(md5(string_agg(md5(r::text), ',' ORDER BY md5(r::text))), '') AS sum
         FROM (SELECT ${columns} FROM "${table}" t WHERE ${where}) r`,
      ...params
    );
    out[table] = row;
  }
  return out;
}
