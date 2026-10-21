"use server";

/**
 * Release 3 (D85, D88; spec 8, 13.4, 14): the data tools of /admin/data.
 * ADMIN with project scope only (requireAdminProject: the ADMIN role and a
 * complete profile of their own): DIESIS is the controller, and partner
 * admins don't handle data requests. Each change is audited, with no
 * personal data in the row; finding people and the dry run change nothing
 * and write no row.
 *
 * - findPeople: anyone by address, member or not (removed people, and
 *   accounts that never finished the profile step, included).
 * - markTestAccount: marks or unmarks a test account (statistics leave it
 *   out at once; the clean-up run erases it).
 * - resetTestAccount: a marked account's learner data and sessions go; the
 *   account, its roles and profile stay.
 * - eraseAccountByAdmin: erases any account, with its address typed again
 *   and a request reference (REQ-YYYY-NNN) unless it is a marked test
 *   account.
 * - previewCleanup / runCleanup: the go-live clean-up's dry run, and the
 *   run, confirmed by typing "ERASE <n> TEST ACCOUNTS".
 * - readDataTools: the page's review lists and log, read again after a
 *   change (the page shows a change from this answer, never from a router
 *   refresh, which can be lost).
 * Reset and erase are refused for the admin's own account, the last ADMIN
 * and ADMIN_EMAILS addresses. The internals are src/lib/account-data.ts.
 */

import { prisma } from "@/lib/prisma";
import { requireAdminProject } from "@/lib/scope";
import {
  adminRefusal,
  cleanupRunId,
  eraseAccount,
  getDataTools,
  isRequestRef,
  planCleanup,
  resetAccount,
  runCleanupSteps,
  type FoundPerson,
} from "@/lib/account-data";

const PROJECT = "seq-elevate";
const FIND_MIN = 3;
const FIND_LIMIT = 20;

const forbidden = { ok: false as const, error: "forbidden" as const };
const badInput = { ok: false as const, error: "bad-input" as const };
const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 64;

/** The signed-in ADMIN with project scope, or null. */
async function requireDataAdmin() {
  const admin = await requireAdminProject();
  return admin?.user ? { id: admin.user.id } : null;
}

/** The person an action is about, with what the refusals need. */
async function personOf(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      profiles: { where: { projectId: PROJECT }, select: { id: true, testAccountAt: true } },
    },
  });
}

/** Anyone whose address contains `query` (at least three characters), member or not. */
export async function findPeople(query: string) {
  const admin = await requireDataAdmin();
  if (!admin) return forbidden;
  const q = typeof query === "string" ? query.trim() : "";
  if (q.length < FIND_MIN) return { ok: false as const, error: "too-short" as const };
  if (q.length > 254) return badInput;
  const people = await prisma.user.findMany({
    where: { email: { contains: q, mode: "insensitive" } },
    orderBy: { email: "asc" },
    take: FIND_LIMIT,
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      emailVerified: true,
      memberships: { where: { projectId: PROJECT }, select: { role: true } },
      profiles: {
        where: { projectId: PROJECT },
        select: { profileCompletedAt: true, testAccountAt: true, organisation: { select: { name: true } } },
      },
      staffHistory: { where: { projectId: PROJECT }, select: { firstAt: true } },
      _count: { select: { enrollments: true, compCards: true } },
    },
  });
  const found: FoundPerson[] = [];
  for (const p of people) {
    const profile = p.profiles[0] ?? null;
    found.push({
      id: p.id,
      email: p.email,
      name: p.name,
      createdAt: p.createdAt.toISOString(),
      signedIn: p.emailVerified !== null,
      roles: p.memberships.map((m) => m.role),
      organisation: profile?.organisation?.name ?? null,
      profileComplete: !!profile?.profileCompletedAt,
      testAccount: !!profile?.testAccountAt,
      everStaff: p.staffHistory.length > 0,
      enrolments: p._count.enrollments,
      compCard: p._count.compCards > 0,
      refusal: await adminRefusal(admin.id, p),
    });
  }
  return { ok: true as const, people: found };
}

/**
 * Marks (`on`) or unmarks a test account, creating the person's profile if
 * they have none. Statistics leave a marked account out at once (D85).
 */
export async function markTestAccount(userId: string, on: boolean) {
  const admin = await requireDataAdmin();
  if (!admin) return forbidden;
  if (!isId(userId) || typeof on !== "boolean") return badInput;
  if (userId === admin.id) return { ok: false as const, error: "self" as const };
  const person = await personOf(userId);
  if (!person) return { ok: false as const, error: "not-found" as const };
  if (!!person.profiles[0]?.testAccountAt === on) return { ok: true as const, testAccount: on };
  await prisma.$transaction(async (tx) => {
    const profile = await tx.projectProfile.upsert({
      where: { userId_projectId: { userId, projectId: PROJECT } },
      create: { userId, projectId: PROJECT, testAccountAt: on ? new Date() : null },
      update: { testAccountAt: on ? new Date() : null },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        projectId: PROJECT,
        actorId: admin.id,
        action: on ? "account.test_marked" : "account.test_unmarked",
        entity: "ProjectProfile",
        entityId: profile.id,
      },
    });
  });
  return { ok: true as const, testAccount: on };
}

/**
 * Resets a marked test account (spec 8): its sessions end first, then its
 * learner data goes; the account, its roles and its profile stay. Audited
 * with the counts per table.
 */
export async function resetTestAccount(userId: string) {
  const admin = await requireDataAdmin();
  if (!admin) return forbidden;
  if (!isId(userId)) return badInput;
  const person = await personOf(userId);
  if (!person) return { ok: false as const, error: "not-found" as const };
  const refusal = await adminRefusal(admin.id, person);
  if (refusal) return { ok: false as const, error: refusal };
  const profile = person.profiles[0];
  if (!profile?.testAccountAt) return { ok: false as const, error: "not-test-account" as const };
  const counts = await resetAccount(userId, (tx, removed) =>
    tx.auditLog.create({
      data: {
        projectId: PROJECT,
        actorId: admin.id,
        action: "account.reset",
        entity: "ProjectProfile",
        entityId: profile.id,
        metadata: { ...removed },
      },
    })
  );
  if (!counts) return { ok: false as const, error: "not-found" as const };
  return { ok: true as const, counts };
}

/**
 * Erases any account (spec 13.4): its address typed again, and a request
 * reference from DIESIS's register (REQ-YYYY-NNN) unless it is a marked
 * test account.
 */
export async function eraseAccountByAdmin(
  userId: string,
  input: { confirmEmail: string; requestRef?: string | null }
) {
  const admin = await requireDataAdmin();
  if (!admin) return forbidden;
  if (!isId(userId) || !input || typeof input.confirmEmail !== "string") return badInput;
  const ref = typeof input.requestRef === "string" ? input.requestRef.trim() : null;
  const person = await personOf(userId);
  if (!person) return { ok: false as const, error: "not-found" as const };
  const refusal = await adminRefusal(admin.id, person);
  if (refusal) return { ok: false as const, error: refusal };
  if (input.confirmEmail.trim().toLowerCase() !== person.email.toLowerCase()) {
    return { ok: false as const, error: "confirmation-mismatch" as const };
  }
  const marked = !!person.profiles[0]?.testAccountAt;
  if (ref ? !isRequestRef(ref) : !marked) return { ok: false as const, error: "request-ref" as const };
  const done = await prisma.$transaction((tx) =>
    eraseAccount(tx, userId, { by: "admin", adminId: admin.id, requestRef: ref || null })
  );
  return done ? { ok: true as const } : { ok: false as const, error: "not-found" as const };
}

/** The page's review lists and log as they are now (spec 14 items 2 and 5); nothing changes. */
export async function readDataTools() {
  const tools = await getDataTools();
  if (!tools) return forbidden;
  return { ok: true as const, review: tools.review, log: tools.log };
}

/** The clean-up's dry run (spec 14 item 3): counts of what a run would delete; nothing changes. */
export async function previewCleanup() {
  const admin = await requireDataAdmin();
  if (!admin) return forbidden;
  return { ok: true as const, plan: await planCleanup(admin.id) };
}

/**
 * The clean-up run (spec 14 item 4), confirmed by typing
 * "ERASE <n> TEST ACCOUNTS" with n the number the dry run says it erases.
 * Recorded as data.cleanup_run with the run's id and counts (no addresses).
 * Run again, it does only what has become due since.
 */
export async function runCleanup(input: { confirm: string }) {
  const admin = await requireDataAdmin();
  if (!admin) return forbidden;
  const plan = await planCleanup(admin.id);
  const expected = `ERASE ${plan.accounts.length} TEST ACCOUNTS`;
  if (!input || typeof input.confirm !== "string" || input.confirm.trim() !== expected) {
    return { ok: false as const, error: "confirm-mismatch" as const, expected };
  }
  const runId = cleanupRunId();
  const result = await runCleanupSteps(admin.id, runId, plan.accounts);
  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId: admin.id,
      action: "data.cleanup_run",
      entity: "Project",
      entityId: PROJECT,
      metadata: {
        runId,
        counts: {
          accountsErased: result.erased,
          accountsFailed: result.failed.length,
          accountsKept: plan.kept.length,
          ...result.rows,
          demoSessions: result.demoSessions,
          expiredSessions: result.expiredSessions,
          expiredSignInLinks: result.expiredSignInLinks,
          filesDeleted: result.files.deleted,
          filesFailed: result.files.failed,
          filesDropped: result.files.dropped,
          filesKept: result.files.kept,
        },
      },
    },
  });
  return { ok: true as const, result, kept: plan.kept };
}
