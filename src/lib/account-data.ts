import "server-only";

/**
 * Release 3 (D85, D86, D88, D92; spec 8, 10.4, 13.2, 13.9, 14): what erasing,
 * resetting and cleaning up do. Server-only, NOT a "use server" file: none
 * of these is an endpoint. They are called by a person's own deletion
 * (actions/gdpr.ts), and by an ADMIN with project scope through
 * actions/admin-data.ts and the admin export route, which check that first.
 *
 * - Erasure (eraseAccount) is one transaction that locks the user row first,
 *   so an open tab can't add an activity record that would survive it; it
 *   removes the person's activity records, the log of their Comp Card's
 *   sharing, their sign-in links and their rate-limit counters, unlinks
 *   every other log row about them, keeps the notes they wrote (unsigned),
 *   writes one erasure record that keeps their id (so erasures can be
 *   applied again after a restore) and deletes the user row, whose
 *   cascade takes everything else.
 * - A reset (resetAccount, marked test accounts only) ends every session
 *   first, then deletes the learner data and keeps the account, its roles
 *   and its profile.
 * - The clean-up run (planCleanup, runCleanupSteps) erases marked test
 *   accounts, ends every demo session, purges expired sessions and sign-in
 *   links, and deletes queued course files (deletePendingFiles).
 *
 * The only audit actions named in this file are the records of a person's
 * own requests (account.deleted, account.exported): r3-migration.test.ts
 * reads them as actions a learner can cause. The admin actions write their
 * own rows (admin-data.ts).
 */

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { parseAdminEmails } from "@/lib/admin-bootstrap";
import { resolveBlobToken } from "@/lib/blob-token";
import { DEMO_PROFILES } from "@/lib/demo-profiles";
import { TELEMETRY_ACTIONS } from "@/lib/gdpr-export";
import { blobDeleteOn } from "@/lib/r3-switches";
import { rateLimitKeysOf } from "@/lib/rate-limit";
import { requireAdminProject } from "@/lib/scope";
import { statsFrom } from "@/lib/stats-from";

type Env = Record<string, string | undefined>;
type Db = Prisma.TransactionClient;

const PROJECT = "seq-elevate";

/** The log of a Comp Card's sharing (one row per change, by card id). */
const SHARING_ACTION = "compcard.sharing_changed";
/** Demo sign-in's session tokens (actions/demo.ts). */
const DEMO_TOKEN_PREFIX = "demo-";

/* ----------------------------------------------------- request references --- */

const REQUEST_REF = /^REQ-\d{4}-\d{3}$/;
const CLEANUP_REF = /^CLEANUP-[a-z0-9]{8,32}$/;

/**
 * A data request's reference in DIESIS's register (docs/data-management.md):
 * REQ-YYYY-NNN, never free text, because it is kept in log rows that outlive
 * the erasure and must hold no name or address.
 */
export const isRequestRef = (value: unknown): value is string => typeof value === "string" && REQUEST_REF.test(value);

/** The reference of the clean-up run's own erasures: CLEANUP-<run>. */
export const isCleanupRef = (value: unknown): value is string => typeof value === "string" && CLEANUP_REF.test(value);

/** A new clean-up run's id: lower-case letters and digits. */
export const cleanupRunId = () => `${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;

/* ------------------------------------------------------------- erasure --- */

export type ErasedBy =
  | { by: "self" }
  /** requestRef null only for a marked test account (admin-data.ts decides). */
  | { by: "admin"; adminId: string; requestRef: string | null };

export interface ErasureCounts {
  activity: number;
  sharingLog: number;
  logUnlinked: number;
  signInLinks: number;
  rateLimits: number;
}

/** Locks the user row for the rest of the transaction; answers it, or undefined when it is gone. */
async function lockUser(db: Db, userId: string) {
  const [user] = await db.$queryRaw<{ id: string; email: string }[]>`
    SELECT "id", "email" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  return user;
}

/**
 * Erases the account `userId` on the caller's transaction (spec 13.2, in
 * this order). Answers what it removed, or null when the account is already
 * gone. Throws on a reference that isn't REQ-YYYY-NNN or CLEANUP-<run>.
 */
export async function eraseAccount(tx: Db, userId: string, who: ErasedBy): Promise<ErasureCounts | null> {
  if (who.by === "admin" && who.requestRef !== null && !isRequestRef(who.requestRef) && !isCleanupRef(who.requestRef)) {
    throw new Error("eraseAccount: a request reference is REQ-YYYY-NNN or CLEANUP-<run>");
  }
  // 0. A course page still open elsewhere inserts activity rows naming this
  // user; their foreign-key check waits for this lock, then fails.
  const user = await lockUser(tx, userId);
  if (!user) return null;
  // 1. Activity, while it still names the user.
  const activity = await tx.auditLog.deleteMany({ where: { actorId: userId, action: { in: [...TELEMETRY_ACTIONS] } } });
  // 2. The log of the Comp Card's sharing.
  const cards = await tx.compCard.findMany({ where: { userId }, select: { id: true } });
  const sharingLog = cards.length
    ? await tx.auditLog.deleteMany({ where: { action: SHARING_ACTION, entityId: { in: cards.map((c) => c.id) } } })
    : { count: 0 };
  // 3. Every other row about the person or their profile loses the link.
  const profiles = await tx.projectProfile.findMany({ where: { userId }, select: { id: true } });
  const logUnlinked = await tx.auditLog.updateMany({
    where: { entityId: { in: [userId, ...profiles.map((p) => p.id)] } },
    data: { entityId: null },
  });
  // 4. Sign-in and invitation links, stored as the address was typed.
  const signInLinks = await tx.verificationToken.deleteMany({
    where: { identifier: { equals: user.email, mode: "insensitive" } },
  });
  // 5. Rate-limit counters, by the keys made from the id and the address.
  const rateLimits = await tx.rateLimit.deleteMany({ where: { key: { in: rateLimitKeysOf(user) } } });
  // 6. Notes and validations the person wrote stay: their author becomes
  // null with the user row (D89).
  // 7. The erasure record: the one row that keeps the id; no address, no name.
  await tx.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId: who.by === "self" ? userId : who.adminId,
      action: "account.deleted",
      entity: "User",
      entityId: userId,
      metadata:
        who.by === "self"
          ? { selfService: true }
          : who.requestRef
            ? { byAdmin: true, requestRef: who.requestRef }
            : { byAdmin: true, testAccount: true },
    },
  });
  // 8. The user row; its cascade takes sessions, roles, profile, staff
  // history, enrolments, Comp Card, badges and the notes about them.
  await tx.user.delete({ where: { id: userId } });
  return {
    activity: activity.count,
    sharingLog: sharingLog.count,
    logUnlinked: logUnlinked.count,
    signInLinks: signInLinks.count,
    rateLimits: rateLimits.count,
  };
}

/** Records that someone's data was exported: by themselves, or by an ADMIN for a request. */
export async function recordDataExport(entry: { actorId: string; userId: string; requestRef?: string }) {
  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId: entry.actorId,
      action: "account.exported",
      entity: "User",
      entityId: entry.userId,
      metadata: entry.requestRef ? { byAdmin: true, requestRef: entry.requestRef } : { selfService: true },
    },
  });
}

/* ------------------------------------------------------- who is refused --- */

export type AdminRefusal = "self" | "last-admin" | "admin-email";

/** A person found by address on /admin/data (findPeople), member or not. */
export interface FoundPerson {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  /** Has signed in by link at least once. */
  signedIn: boolean;
  roles: string[];
  organisation: string | null;
  profileComplete: boolean;
  testAccount: boolean;
  /** In StaffHistory: held a staff role in the project at some point. */
  everStaff: boolean;
  enrolments: number;
  compCard: boolean;
  /** Why this admin may not reset or erase them, if so. */
  refusal: AdminRefusal | null;
}

/**
 * Why an ADMIN may not reset or erase `target`, or null: their own account,
 * the project's last ADMIN, or an ADMIN_EMAILS address (its roles come back
 * at the next sign-in).
 */
export async function adminRefusal(
  adminId: string,
  target: { id: string; email: string },
  env: Env = process.env
): Promise<AdminRefusal | null> {
  if (target.id === adminId) return "self";
  if (parseAdminEmails(env.ADMIN_EMAILS).has(target.email.trim().toLowerCase())) return "admin-email";
  const holdsAdmin = await prisma.membership.count({ where: { userId: target.id, projectId: PROJECT, role: "ADMIN" } });
  if (holdsAdmin > 0) {
    const others = await prisma.membership.count({
      where: { projectId: PROJECT, role: "ADMIN", userId: { not: target.id } },
    });
    if (others === 0) return "last-admin";
  }
  return null;
}

/* --------------------------------------------------------------- reset --- */

export interface ResetCounts {
  sessions: number;
  enrolments: number;
  badges: number;
  compCards: number;
  notes: number;
  validations: number;
  missions: number;
  activity: number;
  sharingLog: number;
}

/**
 * Resets a test account (spec 8): first, on its own and committed, every
 * session ends, so no open tab can start a new save; then, in one
 * transaction that locks the user row, the learner data goes. Enrolments
 * and badges are deleted together (a badge alone would be given back for
 * a completed enrolment), and never updated. The account, its roles, its
 * profile and its reading-help settings stay. `record` writes the audit row
 * in the same transaction. Answers null when the account is gone.
 */
export async function resetAccount(
  userId: string,
  record: (tx: Db, counts: ResetCounts) => Promise<unknown>
): Promise<ResetCounts | null> {
  const sessions = await prisma.session.deleteMany({ where: { userId } });
  return prisma.$transaction(async (tx) => {
    if (!(await lockUser(tx, userId))) return null;
    const enrolments = await tx.courseEnrollment.deleteMany({ where: { userId } });
    const badges = await tx.userBadge.deleteMany({ where: { userId } });
    const cards = await tx.compCard.findMany({ where: { userId }, select: { id: true } });
    const sharingLog = cards.length
      ? await tx.auditLog.deleteMany({ where: { action: SHARING_ACTION, entityId: { in: cards.map((c) => c.id) } } })
      : { count: 0 };
    const compCards = await tx.compCard.deleteMany({ where: { userId } });
    const notes = await tx.observation.deleteMany({ where: { observedId: userId } });
    const validations = await tx.validation.deleteMany({ where: { validatedId: userId } });
    const missions = await tx.missionProgress.deleteMany({ where: { userId } });
    const activity = await tx.auditLog.deleteMany({ where: { actorId: userId, action: { in: [...TELEMETRY_ACTIONS] } } });
    const counts: ResetCounts = {
      sessions: sessions.count,
      enrolments: enrolments.count,
      badges: badges.count,
      compCards: compCards.count,
      notes: notes.count,
      validations: validations.count,
      missions: missions.count,
      activity: activity.count,
      sharingLog: sharingLog.count,
    };
    await record(tx, counts);
    return counts;
  });
}

/* ----------------------------------------------------- queued course files --- */

export interface FileCounts {
  /** Deleted from the store (a dry run: would be). */
  deleted: number;
  /** Their deletion failed: still queued. */
  failed: number;
  /** A record uses them again: taken off the queue, the file kept. */
  dropped: number;
  /** Not deleted here (not production, switched off, or not our store): still queued. */
  kept: number;
  /** Queued less than the waiting time ago: not looked at yet. */
  waiting: number;
  /** Whether this server deletes files at all. */
  mode: "delete" | "keep";
}

/** Every file URL a lesson's video uses: its source, poster and captions. */
function videoUrls(video: unknown): string[] {
  if (!video || typeof video !== "object") return [];
  const v = video as { src?: unknown; poster?: unknown; captions?: unknown };
  const captions = Array.isArray(v.captions) ? v.captions.map((c) => (c as { src?: unknown } | null)?.src) : [];
  return [v.src, v.poster, ...captions].filter((u): u is string => typeof u === "string" && u.length > 0);
}

/** Is `url` a file of our own store (https and exactly BLOB_PUBLIC_HOST)? */
function onOurStore(url: string, env: Env): boolean {
  const host = env.BLOB_PUBLIC_HOST?.trim().toLowerCase();
  if (!host) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/**
 * The queued course files of removed records (D92, spec 10.4), as a step of
 * the admin clean-up run and its dry run. Each queued more than
 * `olderThanDays` ago: if a lesson document or a lesson's video (source,
 * poster, captions) uses it again, it leaves the queue and the file stays;
 * otherwise it is deleted from the store and leaves the queue — only on
 * production (VERCEL_ENV), with R3_BLOB_DELETE not off, and only from our own
 * store (BLOB_PUBLIC_HOST), since other deployments may share the store.
 * Elsewhere it stays queued and is counted as kept. A failed deletion stays
 * queued and is counted. A dry run changes nothing and answers what the run
 * would do.
 */
export async function deletePendingFiles(opts: {
  dryRun: boolean;
  olderThanDays?: number;
  now?: Date;
  env?: Env;
  remove?: (url: string) => Promise<unknown>;
}): Promise<FileCounts> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.olderThanDays ?? 7) * 86_400_000);
  const mode = env.VERCEL_ENV === "production" && blobDeleteOn(env) && !!env.BLOB_PUBLIC_HOST?.trim() ? "delete" : "keep";
  const remove = opts.remove ?? ((url: string) => del(url, { token: resolveBlobToken(env) }));

  const due = await prisma.pendingFileDeletion.findMany({ where: { queuedAt: { lt: cutoff } }, orderBy: { queuedAt: "asc" } });
  const waiting = await prisma.pendingFileDeletion.count({ where: { queuedAt: { gte: cutoff } } });
  const counts: FileCounts = { deleted: 0, failed: 0, dropped: 0, kept: 0, waiting, mode };
  if (due.length === 0) return counts;

  const urls = due.map((d) => d.url);
  const documents = await prisma.lessonDocument.findMany({ where: { url: { in: urls } }, select: { url: true } });
  const lessons = await prisma.lesson.findMany({
    where: { NOT: { video: { equals: Prisma.DbNull } } },
    select: { video: true },
  });
  const used = new Set([...documents.map((d) => d.url), ...lessons.flatMap((l) => videoUrls(l.video))]);

  const usedAgain = urls.filter((u) => used.has(u));
  counts.dropped = usedAgain.length;
  if (!opts.dryRun && usedAgain.length) {
    await prisma.pendingFileDeletion.deleteMany({ where: { url: { in: usedAgain } } });
  }

  for (const url of urls.filter((u) => !used.has(u))) {
    if (mode === "keep" || !onOurStore(url, env)) {
      counts.kept += 1;
      continue;
    }
    if (opts.dryRun) {
      counts.deleted += 1;
      continue;
    }
    try {
      await remove(url);
      await prisma.pendingFileDeletion.deleteMany({ where: { url } });
      counts.deleted += 1;
    } catch (e) {
      counts.failed += 1;
      // Which kind of failure only; the URL stays queued for the next run.
      console.error(`[clean-up] a queued file couldn't be deleted: ${e instanceof Error ? e.name : "error"}`);
    }
  }
  return counts;
}

/* ------------------------------------------------------- the clean-up run --- */

/** What erasing an account removes, per table (its cascade included). */
export interface AccountRows {
  enrolments: number;
  compCards: number;
  badges: number;
  notesAbout: number;
  validationsAbout: number;
  missions: number;
  sessions: number;
  activity: number;
  signInLinks: number;
  rateLimits: number;
}

const NO_ROWS: AccountRows = {
  enrolments: 0,
  compCards: 0,
  badges: 0,
  notesAbout: 0,
  validationsAbout: 0,
  missions: 0,
  sessions: 0,
  activity: 0,
  signInLinks: 0,
  rateLimits: 0,
};

const addRows = (a: AccountRows, b: AccountRows): AccountRows =>
  Object.fromEntries(Object.keys(a).map((k) => [k, a[k as keyof AccountRows] + b[k as keyof AccountRows]])) as unknown as AccountRows;

/** The rows erasing `person` removes, counted on `db` (a dry run, or inside the erasure's transaction). */
async function accountRows(db: Db, person: { id: string; email: string }): Promise<AccountRows> {
  const userId = person.id;
  const [enrolments, compCards, badges, notesAbout, validationsAbout, missions, sessions, activity, signInLinks, rateLimits] =
    await Promise.all([
      db.courseEnrollment.count({ where: { userId } }),
      db.compCard.count({ where: { userId } }),
      db.userBadge.count({ where: { userId } }),
      db.observation.count({ where: { observedId: userId } }),
      db.validation.count({ where: { validatedId: userId } }),
      db.missionProgress.count({ where: { userId } }),
      db.session.count({ where: { userId } }),
      db.auditLog.count({ where: { actorId: userId, action: { in: [...TELEMETRY_ACTIONS] } } }),
      db.verificationToken.count({ where: { identifier: { equals: person.email, mode: "insensitive" } } }),
      db.rateLimit.count({ where: { key: { in: rateLimitKeysOf(person) } } }),
    ]);
  return { enrolments, compCards, badges, notesAbout, validationsAbout, missions, sessions, activity, signInLinks, rateLimits };
}

export interface CleanupAccount {
  id: string;
  email: string;
}

export interface CleanupPlan {
  /** Marked test accounts the run erases. */
  accounts: CleanupAccount[];
  /** Marked test accounts the run leaves, and why. */
  kept: (CleanupAccount & { reason: AdminRefusal })[];
  /** What erasing `accounts` removes, per table. */
  rows: AccountRows;
  /** Sessions whose token starts "demo-", whatever their expiry (not of an account above). */
  demoSessions: number;
  /** Other sessions past their expiry (not of an account above). */
  expiredSessions: number;
  /** Sign-in and invitation links past their expiry (not of an account above). */
  expiredSignInLinks: number;
  /** Queued course files, as the run would treat them. */
  files: FileCounts;
  /** For information: created courses still live whose only learners are marked test accounts or staff. */
  trialCourses: { slug: string; title: string; status: string; learners: number }[];
}

/** The marked test accounts, split into the ones `adminId` may erase and the ones it may not. */
async function markedAccounts(adminId: string, env: Env) {
  const marked = await prisma.user.findMany({
    where: { profiles: { some: { projectId: PROJECT, testAccountAt: { not: null } } } },
    select: { id: true, email: true },
    orderBy: { email: "asc" },
  });
  const accounts: CleanupAccount[] = [];
  const kept: CleanupPlan["kept"] = [];
  for (const person of marked) {
    const reason = await adminRefusal(adminId, person, env);
    if (reason) kept.push({ ...person, reason });
    else accounts.push(person);
  }
  return { accounts, kept };
}

/** Created courses not archived, with learners, every one of them a marked test account or (former) staff. */
async function trialCoursesStillLive(): Promise<CleanupPlan["trialCourses"]> {
  const courses = await prisma.course.findMany({
    where: { projectId: PROJECT, status: { not: "archived" }, NOT: { meta: { equals: Prisma.DbNull } } },
    select: {
      slug: true,
      status: true,
      meta: true,
      enrollments: {
        select: {
          user: {
            select: {
              profiles: { where: { projectId: PROJECT, testAccountAt: { not: null } }, select: { id: true } },
              staffHistory: { where: { projectId: PROJECT }, select: { userId: true } },
              memberships: { where: { projectId: PROJECT, role: { not: "LEARNER" } }, select: { id: true } },
            },
          },
        },
      },
    },
    orderBy: { slug: "asc" },
  });
  return courses
    .filter(
      (c) =>
        c.enrollments.length > 0 &&
        c.enrollments.every(
          (e) => e.user.profiles.length > 0 || e.user.staffHistory.length > 0 || e.user.memberships.length > 0
        )
    )
    .map((c) => {
      const title = (c.meta as { en?: { title?: unknown } } | null)?.en?.title;
      return { slug: c.slug, title: typeof title === "string" ? title : c.slug, status: c.status, learners: c.enrollments.length };
    });
}

/** Neither a demo session nor an account the run erases: what "expired" counts. */
const notTheirs = (ids: string[]): Prisma.SessionWhereInput => (ids.length ? { userId: { notIn: ids } } : {});
const notTheirLinks = (emails: string[]): Prisma.VerificationTokenWhereInput =>
  emails.length ? { NOT: { OR: emails.map((e) => ({ identifier: { equals: e, mode: "insensitive" as const } })) } } : {};

/**
 * The dry run (spec 14 item 3): what a clean-up run by `adminId` would
 * delete, per table, without changing anything. Read only behind
 * previewCleanup and runCleanup (ADMIN, SP31).
 */
export async function planCleanup(adminId: string, now: Date = new Date(), env: Env = process.env): Promise<CleanupPlan> {
  const { accounts, kept } = await markedAccounts(adminId, env);
  let rows = NO_ROWS;
  for (const person of accounts) rows = addRows(rows, await accountRows(prisma, person));
  const ids = accounts.map((a) => a.id);
  const demoSessions = await prisma.session.count({
    where: { AND: [{ sessionToken: { startsWith: DEMO_TOKEN_PREFIX } }, notTheirs(ids)] },
  });
  const expiredSessions = await prisma.session.count({
    where: { AND: [{ expires: { lt: now } }, { NOT: { sessionToken: { startsWith: DEMO_TOKEN_PREFIX } } }, notTheirs(ids)] },
  });
  const expiredSignInLinks = await prisma.verificationToken.count({
    where: { AND: [{ expires: { lt: now } }, notTheirLinks(accounts.map((a) => a.email))] },
  });
  const files = await deletePendingFiles({ dryRun: true, now, env });
  return { accounts, kept, rows, demoSessions, expiredSessions, expiredSignInLinks, files, trialCourses: await trialCoursesStillLive() };
}

export interface CleanupResult {
  runId: string;
  /** Accounts erased, and what went with them. */
  erased: number;
  rows: AccountRows;
  /** Accounts the run tried and couldn't erase (listed; the run went on). */
  failed: CleanupAccount[];
  demoSessions: number;
  expiredSessions: number;
  expiredSignInLinks: number;
  files: FileCounts;
}

/**
 * The run (spec 14 item 4) over the accounts a plan listed: each erased in a
 * transaction of its own (reference CLEANUP-<runId>), a failure listed and
 * the run going on; then every demo session, the expired sessions and
 * sign-in links, and the queued course files. Called only by runCleanup
 * (ADMIN, SP31), which checks the confirmation and records the run.
 */
export async function runCleanupSteps(
  adminId: string,
  runId: string,
  accounts: readonly CleanupAccount[],
  now: Date = new Date(),
  env: Env = process.env
): Promise<CleanupResult> {
  let rows = NO_ROWS;
  let erased = 0;
  const failed: CleanupAccount[] = [];
  for (const person of accounts) {
    try {
      const counted = await prisma.$transaction(async (tx) => {
        const before = await accountRows(tx, person);
        const done = await eraseAccount(tx, person.id, { by: "admin", adminId, requestRef: `CLEANUP-${runId}` });
        return done ? before : null;
      });
      if (counted) {
        rows = addRows(rows, counted);
        erased += 1;
      }
    } catch (e) {
      failed.push(person);
      console.error(`[clean-up] an account couldn't be erased: ${e instanceof Error ? e.name : "error"}`);
    }
  }
  const demoSessions = await prisma.session.deleteMany({ where: { sessionToken: { startsWith: DEMO_TOKEN_PREFIX } } });
  const expiredSessions = await prisma.session.deleteMany({ where: { expires: { lt: now } } });
  const expiredSignInLinks = await prisma.verificationToken.deleteMany({ where: { expires: { lt: now } } });
  const files = await deletePendingFiles({ dryRun: false, now, env });
  return {
    runId,
    erased,
    rows,
    failed,
    demoSessions: demoSessions.count,
    expiredSessions: expiredSessions.count,
    expiredSignInLinks: expiredSignInLinks.count,
    files,
  };
}

/* --------------------------------------------- the data page (ADMIN only) --- */

export type ReviewKey =
  | "no-profile"
  | "showcase"
  | "before-stats"
  | "staff-with-data"
  | "member-targets"
  | "partner-never-signed-in"
  | "country-mismatch";

export interface ReviewPerson {
  id: string;
  email: string;
  testAccount: boolean;
  /** What else the list says about the person (an organisation and a date). */
  detail?: string;
}

export interface LogRow {
  id: string;
  at: string;
  action: string;
  /** An admin's address, "the account holder" (their own request), or null (erased, or the system). */
  who: string | null;
  /** The request reference or run, and counts: never personal data. */
  details: string;
}

export interface DataTools {
  adminId: string;
  review: Record<ReviewKey, ReviewPerson[]>;
  log: LogRow[];
}

const REVIEW_LIMIT = 200;
const LOG_LIMIT = 200;

/** Has learner data in the project: an enrolment in one of its courses, or a Comp Card. */
const HAS_LEARNER_DATA: Prisma.UserWhereInput = {
  OR: [
    { enrollments: { some: { course: { projectId: PROJECT } } } },
    { compCards: { some: { projectId: PROJECT } } },
  ],
};
const MARKED: Prisma.UserWhereInput = { profiles: { some: { projectId: PROJECT, testAccountAt: { not: null } } } };
const EVER_STAFF: Prisma.UserWhereInput = { staffHistory: { some: { projectId: PROJECT } } };

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The review lists of spec 14 item 2 (and 2.6): people an ADMIN may want to mark as test accounts. */
async function reviewLists(): Promise<DataTools["review"]> {
  const person = { id: true, email: true, profiles: { where: { projectId: PROJECT }, select: { testAccountAt: true } } } as const;
  const row = (u: { id: string; email: string; profiles: { testAccountAt: Date | null }[] }, detail?: string): ReviewPerson => ({
    id: u.id,
    email: u.email,
    testAccount: u.profiles.some((p) => p.testAccountAt !== null),
    ...(detail ? { detail } : {}),
  });
  const list = (where: Prisma.UserWhereInput) =>
    prisma.user.findMany({ where, select: person, orderBy: { email: "asc" }, take: REVIEW_LIMIT });

  const from = statsFrom();
  const memberTargetIds = (
    await prisma.auditLog.findMany({
      where: { projectId: PROJECT, action: { startsWith: "member." }, entityId: { not: null } },
      select: { entityId: true },
      distinct: ["entityId"],
    })
  ).flatMap((r) => (r.entityId ? [r.entityId] : []));

  const [noProfile, showcase, beforeStats, staffWithData, memberTargets] = await Promise.all([
    list({
      AND: [HAS_LEARNER_DATA, { profiles: { none: { projectId: PROJECT, profileCompletedAt: { not: null } } } }],
    }),
    list({ email: { in: DEMO_PROFILES.map((p) => p.email) } }),
    from
      ? list({
          AND: [
            { enrollments: { some: { enrolledAt: { lt: from }, course: { projectId: PROJECT } } } },
            { NOT: MARKED },
            { staffHistory: { none: { projectId: PROJECT } } },
          ],
        })
      : Promise.resolve([]),
    list({ AND: [EVER_STAFF, HAS_LEARNER_DATA] }),
    memberTargetIds.length
      ? list({ AND: [{ id: { in: memberTargetIds } }, { staffHistory: { none: { projectId: PROJECT } } }] })
      : Promise.resolve([]),
  ]);

  // Added or claimed by a partner admin, never signed in (a sign-in by link sets emailVerified).
  const partnerAdded = await prisma.user.findMany({
    where: {
      emailVerified: null,
      profiles: { some: { projectId: PROJECT, organisationSource: "partner-admin" } },
    },
    select: {
      ...person,
      profiles: {
        where: { projectId: PROJECT },
        select: { testAccountAt: true, updatedAt: true, organisation: { select: { name: true } } },
      },
    },
    orderBy: { email: "asc" },
    take: REVIEW_LIMIT,
  });

  // The organisation was released by the country rule, or the country maps elsewhere (learners only).
  const mappings = await prisma.countryMapping.findMany({ where: { projectId: PROJECT }, select: { country: true, organisationId: true } });
  const mapped = new Map(mappings.map((m) => [m.country, m.organisationId]));
  const profiles = await prisma.projectProfile.findMany({
    where: {
      projectId: PROJECT,
      OR: [{ organisationSource: "released" }, { country: { not: null }, organisationId: { not: null } }],
      user: { memberships: { none: { projectId: PROJECT, role: { not: "LEARNER" } } } },
    },
    select: {
      country: true,
      organisationId: true,
      organisationSource: true,
      testAccountAt: true,
      organisation: { select: { name: true } },
      user: { select: { id: true, email: true } },
    },
    orderBy: { user: { email: "asc" } },
    take: REVIEW_LIMIT,
  });
  const mismatch = profiles
    .filter(
      (p) =>
        p.organisationSource === "released" ||
        (p.country !== null && mapped.has(p.country) && mapped.get(p.country) !== p.organisationId)
    )
    .map((p) => ({
      id: p.user.id,
      email: p.user.email,
      testAccount: p.testAccountAt !== null,
      detail:
        p.organisationSource === "released"
          ? `organisation released (country ${p.country ?? "not set"})`
          : `country ${p.country} · organisation ${p.organisation?.name ?? "none"}`,
    }));

  return {
    "no-profile": noProfile.map((u) => row(u)),
    showcase: showcase.map((u) => row(u)),
    "before-stats": beforeStats.map((u) => row(u)),
    "staff-with-data": staffWithData.map((u) => row(u)),
    "member-targets": memberTargets.map((u) => row(u)),
    "partner-never-signed-in": partnerAdded.map((u) => {
      const p = u.profiles[0];
      return row(u, p ? `${p.organisation?.name ?? "no organisation"} · ${day(p.updatedAt)}` : undefined);
    }),
    "country-mismatch": mismatch,
  };
}

/** The actions the log viewer shows (spec 14 item 5). */
const LOGGED: Prisma.AuditLogWhereInput = {
  projectId: PROJECT,
  OR: [
    { action: { startsWith: "data." } },
    { action: { startsWith: "account." } },
    { action: { startsWith: "person." } },
    {
      action: {
        in: ["profile.organisation_released", "member.add_refused", "member.guardian_consent_recorded", "safeguarding.saved"],
      },
    },
  ],
};

/** What a log row's metadata says, without personal data (references, runs, counts, flags). */
function detailsOf(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (key === "requestRef" || key === "runId" || key === "reason" || key === "scope" || key === "to" || key === "version") {
      if (typeof value === "string") parts.push(`${key} ${value}`);
    } else if (typeof value === "boolean" && value) {
      parts.push(key);
    } else if (typeof value === "number") {
      parts.push(`${key} ${value}`);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      const numbers = Object.entries(value as Record<string, unknown>).filter(([, n]) => typeof n === "number" && n > 0);
      if (numbers.length) parts.push(`${key}: ${numbers.map(([k, n]) => `${k} ${n}`).join(", ")}`);
    }
  }
  return parts.join(" · ");
}

/** The last rows of the data and account log, with who did them (an admin's address), never a learner's name. */
async function logRows(): Promise<LogRow[]> {
  const rows = await prisma.auditLog.findMany({
    where: LOGGED,
    orderBy: { createdAt: "desc" },
    take: LOG_LIMIT,
    select: {
      id: true,
      action: true,
      createdAt: true,
      metadata: true,
      actor: {
        select: {
          email: true,
          staffHistory: { where: { projectId: PROJECT }, select: { userId: true } },
          memberships: { where: { projectId: PROJECT, role: { not: "LEARNER" } }, select: { id: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    action: r.action,
    who: r.actor
      ? r.actor.staffHistory.length || r.actor.memberships.length
        ? r.actor.email
        : "the account holder"
      : null,
    details: detailsOf(r.metadata),
  }));
}

/** Everything /admin/data shows on load, for an ADMIN with project scope; null for anyone else. */
export async function getDataTools(): Promise<DataTools | null> {
  const admin = await requireAdminProject();
  if (!admin?.user) return null;
  const [review, log] = await Promise.all([reviewLists(), logRows()]);
  return { adminId: admin.user.id, review, log };
}
