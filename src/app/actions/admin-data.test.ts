import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
 * Spec 8, 13.4, 14 (SP31, D85, D88): the data tools are for an ADMIN with
 * project scope only, and each says no in the cases the spec names.
 * - Every action refuses anyone else and touches nothing.
 * - Marking sets or clears the test mark (creating the profile if needed)
 *   and is audited; an admin doesn't mark themselves.
 * - Reset is for marked test accounts only; reset and erase are refused for
 *   the admin's own account, the last ADMIN and ADMIN_EMAILS addresses.
 * - Erase needs the address typed again and a REQ-YYYY-NNN reference,
 *   unless the account is a marked test account; free text never passes.
 * - The run needs "ERASE <n> TEST ACCOUNTS" with the dry run's n, and is
 *   recorded with its id and counts, never an address.
 */

const ADMIN = { id: "admin-1", email: "admin@example.org" };
const requireAdminProject = vi.fn();
const adminRefusal = vi.fn();
const eraseAccount = vi.fn(async () => ({ activity: 0 }));
const resetAccount = vi.fn();
const planCleanup = vi.fn();
const runCleanupSteps = vi.fn();

const tx = {
  projectProfile: { upsert: vi.fn<(args: unknown) => Promise<{ id: string }>>(async () => ({ id: "profile-9" })) },
  auditLog: { create: vi.fn<(args: unknown) => Promise<unknown>>(async () => ({})) },
};
const prisma = {
  user: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  auditLog: { create: vi.fn<(args: unknown) => Promise<unknown>>(async () => ({})) },
  $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
};

vi.mock("@/lib/scope", () => ({ requireAdminProject }));
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/account-data", async () => {
  const actual = await vi.importActual<typeof import("@/lib/account-data")>("@/lib/account-data");
  return {
    isRequestRef: actual.isRequestRef,
    cleanupRunId: () => "run12345abc",
    adminRefusal,
    eraseAccount,
    resetAccount,
    planCleanup,
    runCleanupSteps,
  };
});
vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));

const actions = await import("./admin-data");
const { findPeople, markTestAccount, resetTestAccount, eraseAccountByAdmin, previewCleanup, runCleanup } = actions;

const TARGET = { id: "user-2", email: "Test@Example.org" };
const marked = (on: boolean) => ({ ...TARGET, profiles: on ? [{ id: "profile-2", testAccountAt: new Date() }] : [] });

const PLAN = {
  accounts: [{ id: "user-2", email: "test@example.org" }, { id: "user-3", email: "t3@example.org" }],
  kept: [{ id: "admin-2", email: "boss@example.org", reason: "admin-email" }],
  rows: { enrolments: 3 },
};

beforeEach(() => {
  requireAdminProject.mockResolvedValue({ user: ADMIN, roles: ["ADMIN"], profile: null, scope: { kind: "project" } });
  adminRefusal.mockResolvedValue(null);
  prisma.user.findUnique.mockResolvedValue(marked(true));
  planCleanup.mockResolvedValue(PLAN);
  runCleanupSteps.mockResolvedValue({
    runId: "run12345abc",
    erased: 2,
    rows: { enrolments: 3 },
    failed: [],
    demoSessions: 1,
    expiredSessions: 4,
    expiredSignInLinks: 2,
    files: { deleted: 0, failed: 0, dropped: 1, kept: 1, waiting: 0, mode: "keep" },
  });
  resetAccount.mockImplementation(async (_id: string, record: (t: typeof tx, c: unknown) => Promise<unknown>) => {
    const counts = { sessions: 1, enrolments: 2, badges: 1 };
    await record(tx, counts);
    return counts;
  });
});
afterEach(() => vi.clearAllMocks());

const touched = () =>
  prisma.$transaction.mock.calls.length +
  prisma.auditLog.create.mock.calls.length +
  eraseAccount.mock.calls.length +
  resetAccount.mock.calls.length +
  runCleanupSteps.mock.calls.length;

describe("who may use the data tools", () => {
  it.each([
    ["findPeople", () => findPeople("example.org")],
    ["markTestAccount", () => markTestAccount(TARGET.id, true)],
    ["resetTestAccount", () => resetTestAccount(TARGET.id)],
    ["eraseAccountByAdmin", () => eraseAccountByAdmin(TARGET.id, { confirmEmail: TARGET.email, requestRef: "REQ-2026-001" })],
    ["previewCleanup", () => previewCleanup()],
    ["runCleanup", () => runCleanup({ confirm: "ERASE 2 TEST ACCOUNTS" })],
  ])("%s: only an ADMIN with project scope; anyone else is refused and nothing is read or changed", async (_, call) => {
    requireAdminProject.mockResolvedValue(null);
    await expect(call()).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(touched()).toBe(0);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(planCleanup).not.toHaveBeenCalled();
  });

  it("the file exports exactly the six actions", () => {
    expect(Object.keys(actions).sort()).toEqual(
      ["eraseAccountByAdmin", "findPeople", "markTestAccount", "previewCleanup", "resetTestAccount", "runCleanup"].sort()
    );
  });
});

describe("findPeople", () => {
  it("looks anyone up by part of the address, member or not", async () => {
    await findPeople("  exam ");
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: { contains: "exam", mode: "insensitive" } }, take: 20 })
    );
  });

  it("needs three characters", async () => {
    await expect(findPeople("ab")).resolves.toEqual({ ok: false, error: "too-short" });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});

describe("markTestAccount", () => {
  it("marks, creating the profile if needed, and audits it by the profile", async () => {
    prisma.user.findUnique.mockResolvedValue(marked(false));
    await expect(markTestAccount(TARGET.id, true)).resolves.toEqual({ ok: true, testAccount: true });
    const upsert = tx.projectProfile.upsert.mock.calls[0][0] as unknown as {
      create: { testAccountAt: Date };
      update: { testAccountAt: Date };
    };
    expect(upsert).toMatchObject({ where: { userId_projectId: { userId: TARGET.id, projectId: "seq-elevate" } } });
    expect(upsert.create.testAccountAt).toBeInstanceOf(Date);
    expect(JSON.stringify(upsert)).not.toContain("organisation");
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        projectId: "seq-elevate",
        actorId: ADMIN.id,
        action: "account.test_marked",
        entity: "ProjectProfile",
        entityId: "profile-9",
      },
    });
  });

  it("unmarks", async () => {
    await expect(markTestAccount(TARGET.id, false)).resolves.toEqual({ ok: true, testAccount: false });
    const upsert = tx.projectProfile.upsert.mock.calls[0][0] as unknown as { update: { testAccountAt: unknown } };
    expect(upsert.update.testAccountAt).toBeNull();
    expect((tx.auditLog.create.mock.calls[0][0] as unknown as { data: { action: string } }).data.action).toBe(
      "account.test_unmarked"
    );
  });

  it("writes nothing when the mark is already so, and refuses the admin's own account", async () => {
    await expect(markTestAccount(TARGET.id, true)).resolves.toEqual({ ok: true, testAccount: true });
    await expect(markTestAccount(ADMIN.id, true)).resolves.toEqual({ ok: false, error: "self" });
    await expect(markTestAccount(TARGET.id, "yes" as unknown as boolean)).resolves.toEqual({ ok: false, error: "bad-input" });
    expect(touched()).toBe(0);
  });
});

describe("resetTestAccount", () => {
  it("resets a marked account and audits the counts in the same transaction", async () => {
    await expect(resetTestAccount(TARGET.id)).resolves.toEqual({
      ok: true,
      counts: { sessions: 1, enrolments: 2, badges: 1 },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        projectId: "seq-elevate",
        actorId: ADMIN.id,
        action: "account.reset",
        entity: "ProjectProfile",
        entityId: "profile-2",
        metadata: { sessions: 1, enrolments: 2, badges: 1 },
      },
    });
  });

  it("refuses an account that isn't marked", async () => {
    prisma.user.findUnique.mockResolvedValue(marked(false));
    await expect(resetTestAccount(TARGET.id)).resolves.toEqual({ ok: false, error: "not-test-account" });
    expect(resetAccount).not.toHaveBeenCalled();
  });

  it.each(["self", "last-admin", "admin-email"])("refuses %s", async (reason) => {
    adminRefusal.mockResolvedValue(reason);
    await expect(resetTestAccount(TARGET.id)).resolves.toEqual({ ok: false, error: reason });
    expect(resetAccount).not.toHaveBeenCalled();
  });
});

describe("eraseAccountByAdmin", () => {
  const erase = (requestRef: string | null | undefined, confirmEmail = " test@example.org ") =>
    eraseAccountByAdmin(TARGET.id, { confirmEmail, requestRef });

  it("erases with the address typed again and a request reference", async () => {
    prisma.user.findUnique.mockResolvedValue(marked(false));
    await expect(erase("REQ-2026-004")).resolves.toEqual({ ok: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(eraseAccount).toHaveBeenCalledWith(tx, TARGET.id, { by: "admin", adminId: ADMIN.id, requestRef: "REQ-2026-004" });
  });

  it("needs a reference unless the account is a marked test account", async () => {
    prisma.user.findUnique.mockResolvedValue(marked(false));
    await expect(erase(null)).resolves.toEqual({ ok: false, error: "request-ref" });
    await expect(erase("")).resolves.toEqual({ ok: false, error: "request-ref" });
    expect(eraseAccount).not.toHaveBeenCalled();
    prisma.user.findUnique.mockResolvedValue(marked(true));
    await expect(erase(undefined)).resolves.toEqual({ ok: true });
    expect(eraseAccount).toHaveBeenCalledWith(tx, TARGET.id, { by: "admin", adminId: ADMIN.id, requestRef: null });
  });

  it("never takes free text as a reference, marked or not", async () => {
    for (const ref of ["Ana's request", "REQ-2026-4", "REQ-2026-004 Ana", "CLEANUP-abcdef12"]) {
      await expect(erase(ref)).resolves.toEqual({ ok: false, error: "request-ref" });
    }
    expect(eraseAccount).not.toHaveBeenCalled();
  });

  it("refuses another address typed", async () => {
    await expect(erase("REQ-2026-004", "someone@example.org")).resolves.toEqual({
      ok: false,
      error: "confirmation-mismatch",
    });
    expect(eraseAccount).not.toHaveBeenCalled();
  });

  it.each(["self", "last-admin", "admin-email"])("refuses %s", async (reason) => {
    adminRefusal.mockResolvedValue(reason);
    await expect(erase("REQ-2026-004")).resolves.toEqual({ ok: false, error: reason });
    expect(eraseAccount).not.toHaveBeenCalled();
  });
});

describe("the clean-up", () => {
  it("previewCleanup answers the dry run and changes nothing", async () => {
    await expect(previewCleanup()).resolves.toEqual({ ok: true, plan: PLAN });
    expect(planCleanup).toHaveBeenCalledWith(ADMIN.id);
    expect(touched()).toBe(0);
  });

  it("runCleanup needs ERASE <n> TEST ACCOUNTS with the dry run's n", async () => {
    for (const confirm of ["ERASE 3 TEST ACCOUNTS", "erase 2 test accounts", "", "yes"]) {
      await expect(runCleanup({ confirm })).resolves.toEqual({
        ok: false,
        error: "confirm-mismatch",
        expected: "ERASE 2 TEST ACCOUNTS",
      });
    }
    expect(runCleanupSteps).not.toHaveBeenCalled();
  });

  it("runs over the dry run's accounts and records the run without an address", async () => {
    const res = await runCleanup({ confirm: " ERASE 2 TEST ACCOUNTS " });
    expect(res.ok).toBe(true);
    expect(runCleanupSteps).toHaveBeenCalledWith(ADMIN.id, "run12345abc", PLAN.accounts);
    const record = prisma.auditLog.create.mock.calls[0][0] as unknown as {
      data: { action: string; actorId: string; metadata: { runId: string; counts: Record<string, number> } };
    };
    expect(record.data).toMatchObject({ action: "data.cleanup_run", actorId: ADMIN.id });
    expect(record.data.metadata.runId).toBe("run12345abc");
    expect(record.data.metadata.counts).toMatchObject({
      accountsErased: 2,
      accountsKept: 1,
      enrolments: 3,
      demoSessions: 1,
      expiredSessions: 4,
      expiredSignInLinks: 2,
      filesDropped: 1,
      filesKept: 1,
    });
    expect(JSON.stringify(record)).not.toMatch(/@example\.org/);
  });
});
