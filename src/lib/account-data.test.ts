import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
 * UD1 (spec 8, 10.4, 13.2, 14; D85, D86, D92): what erasing, resetting and
 * cleaning up do, and in which order.
 * - Erasure is one transaction that locks the person's user row first, and
 *   removes their activity records before the user row (or their actorId
 *   would already be null and nothing would find them); every other log row
 *   about them loses its link, except the erasure record written after;
 *   sign-in links go whatever the case of the address; rate-limit counters
 *   go by the keys made from the id and from the address.
 * - A reset first ends every session, committed on its own, then removes
 *   enrolments and badges together, never updating an enrolment.
 * - A request reference is REQ-YYYY-NNN, or CLEANUP-<run> for the clean-up
 *   run's own erasures, never free text.
 * - Queued course files: deleted only after 7 days, only on production with
 *   the switch on, and never while a record uses them again.
 */

vi.mock("server-only", () => ({}));

/** Every database call, in order, as "<client>.<model>.<method>". */
const calls: { what: string; args: unknown }[] = [];
const answers: Record<string, unknown> = {};

function client(name: string) {
  return new Proxy(
    {},
    {
      get(_, model: string) {
        if (model === "$queryRaw") {
          return (strings: TemplateStringsArray, ...values: unknown[]) => {
            calls.push({ what: `${name}.$queryRaw`, args: { sql: strings.join("?"), values } });
            return Promise.resolve(answers[`${name}.$queryRaw`] ?? answers["$queryRaw"] ?? []);
          };
        }
        if (model === "$transaction") {
          return async (fn: (t: unknown) => Promise<unknown>) => {
            calls.push({ what: `${name}.$transaction`, args: null });
            return fn(tx);
          };
        }
        return new Proxy(
          {},
          {
            get(_, method: string) {
              return (args: unknown) => {
                calls.push({ what: `${name}.${model}.${method}`, args });
                const key = `${model}.${method}`;
                const answer = answers[key];
                if (typeof answer === "function") return Promise.resolve((answer as (a: unknown) => unknown)(args));
                if (answer !== undefined) return Promise.resolve(answer);
                if (method === "deleteMany" || method === "updateMany") return Promise.resolve({ count: 1 });
                if (method === "count") return Promise.resolve(0);
                if (method === "findMany") return Promise.resolve([]);
                return Promise.resolve(null);
              };
            },
          }
        );
      },
    }
  );
}
const tx = client("tx");
const prisma = client("prisma");
vi.mock("@/lib/prisma", () => ({ prisma }));
const requireAdminProject = vi.fn<() => Promise<unknown>>(async () => null);
vi.mock("@/lib/scope", () => ({ requireAdminProject, PROJECT: "seq-elevate" }));
const del = vi.fn(async (url: string) => {
  if (url.includes("broken")) throw new Error("blob unavailable");
});
vi.mock("@vercel/blob", () => ({ del }));

const {
  eraseAccount,
  resetAccount,
  isRequestRef,
  isCleanupRef,
  cleanupRunId,
  deletePendingFiles,
  adminRefusal,
  planCleanup,
  getDataTools,
  brusselsDay,
  brusselsTime,
} = await import("./account-data");
const { TELEMETRY_ACTIONS } = await import("./gdpr-export");
const { rateLimitKeysOf } = await import("./rate-limit");

const PERSON = { id: "user-1", email: "Ana@Example.org" };
const order = () => calls.map((c) => c.what);
const call = (what: string) => calls.find((c) => c.what === what);
const index = (what: string) => order().indexOf(what);

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
  vi.stubEnv("AUTH_SECRET", "unit-test-secret-0123456789abcdef");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("eraseAccount", () => {
  beforeEach(() => {
    answers["tx.$queryRaw"] = [PERSON];
    answers["compCard.findMany"] = [{ id: "card-1" }];
    answers["projectProfile.findMany"] = [{ id: "profile-1" }];
  });

  it("runs on the caller's transaction only, starting with a lock on the user row", async () => {
    await eraseAccount(tx as never, PERSON.id, { by: "self" });
    expect(order().every((w) => w.startsWith("tx."))).toBe(true);
    const lock = calls[0];
    expect(lock.what).toBe("tx.$queryRaw");
    expect((lock.args as { sql: string }).sql).toMatch(/FROM "User" WHERE "id" = \? FOR UPDATE/);
    expect((lock.args as { values: unknown[] }).values).toEqual([PERSON.id]);
  });

  it("removes the activity records before the user row, by the person's id", async () => {
    await eraseAccount(tx as never, PERSON.id, { by: "self" });
    const activity = calls.find(
      (c) => c.what === "tx.auditLog.deleteMany" && JSON.stringify(c.args).includes("stage.time")
    );
    expect(activity?.args).toEqual({ where: { actorId: PERSON.id, action: { in: [...TELEMETRY_ACTIONS] } } });
    expect([...TELEMETRY_ACTIONS].sort()).toEqual(["course.opened", "stage.time", "video.cue_answered"]);
    expect(calls.indexOf(activity!)).toBeLessThan(index("tx.user.delete"));
    expect(call("tx.user.delete")?.args).toEqual({ where: { id: PERSON.id } });
    expect(index("tx.user.delete")).toBe(calls.length - 1);
  });

  it("removes the sharing log of the person's card", async () => {
    await eraseAccount(tx as never, PERSON.id, { by: "self" });
    expect(calls.some((c) => c.what === "tx.auditLog.deleteMany" && JSON.stringify(c.args) === JSON.stringify({
      where: { action: "compcard.sharing_changed", entityId: { in: ["card-1"] } },
    }))).toBe(true);
  });

  it("unlinks every other log row about the person or their profile, then writes the erasure record with the id", async () => {
    await eraseAccount(tx as never, PERSON.id, { by: "self" });
    expect(call("tx.auditLog.updateMany")?.args).toEqual({
      where: { entityId: { in: [PERSON.id, "profile-1"] } },
      data: { entityId: null },
    });
    const record = call("tx.auditLog.create");
    expect(index("tx.auditLog.updateMany")).toBeLessThan(index("tx.auditLog.create"));
    expect(index("tx.auditLog.create")).toBeLessThan(index("tx.user.delete"));
    expect(record?.args).toEqual({
      data: {
        projectId: "seq-elevate",
        actorId: PERSON.id,
        action: "account.deleted",
        entity: "User",
        entityId: PERSON.id,
        metadata: { selfService: true },
      },
    });
  });

  it("an admin's erasure records the admin and the request reference, no email or name", async () => {
    await eraseAccount(tx as never, PERSON.id, { by: "admin", adminId: "admin-1", requestRef: "REQ-2026-004" });
    const record = call("tx.auditLog.create")?.args as { data: { actorId: string; metadata: unknown } };
    expect(record.data.actorId).toBe("admin-1");
    expect(record.data.metadata).toEqual({ byAdmin: true, requestRef: "REQ-2026-004" });
    expect(JSON.stringify(record)).not.toMatch(/ana@example/i);
  });

  it("a marked test account may be erased without a reference; free text never goes in the record", async () => {
    await eraseAccount(tx as never, PERSON.id, { by: "admin", adminId: "admin-1", requestRef: null });
    expect((call("tx.auditLog.create")?.args as { data: { metadata: unknown } }).data.metadata).toEqual({
      byAdmin: true,
      testAccount: true,
    });
    calls.length = 0;
    await expect(
      eraseAccount(tx as never, PERSON.id, { by: "admin", adminId: "admin-1", requestRef: "Ana's request" })
    ).rejects.toThrow(/reference/);
    expect(calls).toEqual([]);
  });

  it("removes sign-in links whatever the case of the address", async () => {
    await eraseAccount(tx as never, PERSON.id, { by: "self" });
    expect(call("tx.verificationToken.deleteMany")?.args).toEqual({
      where: { identifier: { equals: PERSON.email, mode: "insensitive" } },
    });
  });

  it("removes the rate-limit counters keyed by the id and by the address", async () => {
    await eraseAccount(tx as never, PERSON.id, { by: "self" });
    const keys = (call("tx.rateLimit.deleteMany")?.args as { where: { key: { in: string[] } } }).where.key.in;
    expect(keys).toEqual(rateLimitKeysOf(PERSON));
    expect(keys).toHaveLength(7);
  });

  it("keeps the notes the person wrote (their author becomes null with the user row)", async () => {
    await eraseAccount(tx as never, PERSON.id, { by: "self" });
    expect(order().some((w) => /observation|validation/.test(w))).toBe(false);
  });

  it("does nothing more when the user is already gone", async () => {
    answers["tx.$queryRaw"] = [];
    await expect(eraseAccount(tx as never, PERSON.id, { by: "self" })).resolves.toBeNull();
    expect(order()).toEqual(["tx.$queryRaw"]);
  });
});

describe("resetAccount", () => {
  beforeEach(() => {
    answers["tx.$queryRaw"] = [{ id: PERSON.id }];
    answers["compCard.findMany"] = [{ id: "card-1" }];
  });

  it("ends every session first, committed on its own, then resets in one transaction", async () => {
    const record = vi.fn(async () => {});
    await resetAccount(PERSON.id, record);
    expect(calls[0]).toEqual({ what: "prisma.session.deleteMany", args: { where: { userId: PERSON.id } } });
    expect(calls[1].what).toBe("prisma.$transaction");
    expect(calls[2].what).toBe("tx.$queryRaw");
    expect((calls[2].args as { sql: string }).sql).toMatch(/FOR UPDATE/);
    expect(order().slice(2).every((w) => w.startsWith("tx."))).toBe(true);
  });

  it("deletes enrolments and badges together, and never updates an enrolment", async () => {
    await resetAccount(PERSON.id, vi.fn(async () => {}));
    expect(call("tx.courseEnrollment.deleteMany")?.args).toEqual({ where: { userId: PERSON.id } });
    expect(call("tx.userBadge.deleteMany")?.args).toEqual({ where: { userId: PERSON.id } });
    expect(order().some((w) => /courseEnrollment\.(update|upsert)/.test(w))).toBe(false);
  });

  it("deletes the card, notes and validations about the person, missions, activity and the sharing log", async () => {
    await resetAccount(PERSON.id, vi.fn(async () => {}));
    expect(call("tx.compCard.deleteMany")?.args).toEqual({ where: { userId: PERSON.id } });
    expect(call("tx.observation.deleteMany")?.args).toEqual({ where: { observedId: PERSON.id } });
    expect(call("tx.validation.deleteMany")?.args).toEqual({ where: { validatedId: PERSON.id } });
    expect(call("tx.missionProgress.deleteMany")?.args).toEqual({ where: { userId: PERSON.id } });
    const deleted = calls.filter((c) => c.what === "tx.auditLog.deleteMany").map((c) => c.args);
    expect(deleted).toContainEqual({ where: { actorId: PERSON.id, action: { in: [...TELEMETRY_ACTIONS] } } });
    expect(deleted).toContainEqual({ where: { action: "compcard.sharing_changed", entityId: { in: ["card-1"] } } });
  });

  it("keeps the account, its memberships and its profile", async () => {
    await resetAccount(PERSON.id, vi.fn(async () => {}));
    expect(order().some((w) => /\.(user|membership|projectProfile)\.(delete|update)/.test(w))).toBe(false);
  });

  it("records what it removed inside the same transaction", async () => {
    const record = vi.fn<(tx: unknown, counts: unknown) => Promise<void>>(async () => {});
    const counts = await resetAccount(PERSON.id, record);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toBe(tx);
    expect(record.mock.calls[0][1]).toEqual(counts);
    expect(counts).toMatchObject({ sessions: 1, enrolments: 1, badges: 1, compCards: 1 });
  });
});

describe("request references", () => {
  it("are REQ-YYYY-NNN only", () => {
    expect(isRequestRef("REQ-2026-004")).toBe(true);
    for (const bad of ["REQ-26-004", "REQ-2026-4", "req-2026-004", "REQ-2026-004 Ana", " REQ-2026-004", "Ana Smith", "", null, 4]) {
      expect(isRequestRef(bad), String(bad)).toBe(false);
    }
  });

  it("CLEANUP-<run> only for the clean-up run's own erasures", () => {
    const run = cleanupRunId();
    expect(run).toMatch(/^[a-z0-9]{8,32}$/);
    expect(isCleanupRef(`CLEANUP-${run}`)).toBe(true);
    expect(isRequestRef(`CLEANUP-${run}`)).toBe(false);
    for (const bad of ["CLEANUP-", "CLEANUP-Ana Smith", "cleanup-abc12345", "CLEANUP-ab"]) {
      expect(isCleanupRef(bad), bad).toBe(false);
    }
  });
});

describe("adminRefusal (reset and erase)", () => {
  it("refuses the admin's own account", async () => {
    await expect(adminRefusal("admin-1", { id: "admin-1", email: "me@example.org" }, {})).resolves.toBe("self");
  });

  it("refuses an ADMIN_EMAILS address, whose roles come back at the next sign-in", async () => {
    await expect(
      adminRefusal("admin-1", { id: "u2", email: "Boss@Example.org" }, { ADMIN_EMAILS: "boss@example.org" })
    ).resolves.toBe("admin-email");
  });

  it("refuses the last ADMIN", async () => {
    answers["membership.count"] = (args: { where: { userId?: unknown } }) =>
      JSON.stringify(args).includes('"not"') ? 0 : 1;
    await expect(adminRefusal("admin-1", { id: "u2", email: "u2@example.org" }, {})).resolves.toBe("last-admin");
  });

  it("allows anyone else", async () => {
    answers["membership.count"] = 0;
    await expect(adminRefusal("admin-1", { id: "u2", email: "u2@example.org" }, {})).resolves.toBeNull();
  });
});

describe("deletePendingFiles", () => {
  const NOW = new Date(Date.UTC(2026, 11, 1, 9));
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
  const HOST = "store.public.blob.vercel-storage.com";
  const url = (name: string) => `https://${HOST}/${name}`;
  const PRODUCTION = { VERCEL_ENV: "production", BLOB_PUBLIC_HOST: HOST };

  beforeEach(() => {
    answers["pendingFileDeletion.findMany"] = (args: { where: { queuedAt: { lt?: Date; gte?: Date } } }) =>
      args.where.queuedAt.lt
        ? [
            { url: url("old.pdf"), queuedAt: daysAgo(8) },
            { url: url("pasted-back.pdf"), queuedAt: daysAgo(9) },
            { url: url("poster.png"), queuedAt: daysAgo(10) },
          ]
        : [];
    answers["pendingFileDeletion.count"] = 2; // younger than 7 days
    answers["lessonDocument.findMany"] = [{ url: url("pasted-back.pdf") }];
    answers["lesson.findMany"] = [
      { video: { provider: "file", src: "/demo/sample.webm", poster: url("poster.png"), captions: [] } },
    ];
  });

  it("asks only for rows queued more than 7 days ago", async () => {
    await deletePendingFiles({ dryRun: true, now: NOW, env: PRODUCTION });
    expect(call("prisma.pendingFileDeletion.findMany")?.args).toMatchObject({ where: { queuedAt: { lt: daysAgo(7) } } });
  });

  it("on production deletes what nothing references, and drops from the queue what a record uses again", async () => {
    const result = await deletePendingFiles({ dryRun: false, now: NOW, env: PRODUCTION });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0][0]).toBe(url("old.pdf"));
    expect(result).toEqual({ deleted: 1, failed: 0, dropped: 2, kept: 0, waiting: 2, mode: "delete" });
    const removed = calls.filter((c) => c.what === "prisma.pendingFileDeletion.deleteMany").map((c) => c.args);
    expect(removed).toContainEqual({ where: { url: { in: [url("pasted-back.pdf"), url("poster.png")] } } });
    expect(removed).toContainEqual({ where: { url: url("old.pdf") } });
  });

  it("keeps a file whose deletion fails queued, and counts it", async () => {
    answers["pendingFileDeletion.findMany"] = (args: { where: { queuedAt: { lt?: Date } } }) =>
      args.where.queuedAt.lt ? [{ url: url("broken.pdf"), queuedAt: daysAgo(8) }] : [];
    answers["lessonDocument.findMany"] = [];
    answers["lesson.findMany"] = [];
    const result = await deletePendingFiles({ dryRun: false, now: NOW, env: PRODUCTION });
    expect(result).toMatchObject({ deleted: 0, failed: 1 });
    expect(calls.some((c) => c.what === "prisma.pendingFileDeletion.deleteMany")).toBe(false);
  });

  it.each([
    ["a preview", { VERCEL_ENV: "preview", BLOB_PUBLIC_HOST: HOST }],
    ["a local server", { BLOB_PUBLIC_HOST: HOST }],
    ["production with R3_BLOB_DELETE=off", { ...PRODUCTION, R3_BLOB_DELETE: "off" }],
  ])("deletes nothing on %s: due files are kept and stay queued", async (_, env) => {
    const result = await deletePendingFiles({ dryRun: false, now: NOW, env });
    expect(del).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 0, failed: 0, dropped: 2, kept: 1, waiting: 2, mode: "keep" });
    const removed = calls.filter((c) => c.what === "prisma.pendingFileDeletion.deleteMany").map((c) => c.args);
    expect(removed).toEqual([{ where: { url: { in: [url("pasted-back.pdf"), url("poster.png")] } } }]);
  });

  it("deletes only from our own store, even on production", async () => {
    answers["pendingFileDeletion.findMany"] = (args: { where: { queuedAt: { lt?: Date } } }) =>
      args.where.queuedAt.lt ? [{ url: "https://elsewhere.example/x.pdf", queuedAt: daysAgo(8) }] : [];
    answers["lessonDocument.findMany"] = [];
    answers["lesson.findMany"] = [];
    const result = await deletePendingFiles({ dryRun: false, now: NOW, env: PRODUCTION });
    expect(del).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deleted: 0, kept: 1 });
    // Without the store's address set, nothing at all.
    const unset = await deletePendingFiles({ dryRun: false, now: NOW, env: { VERCEL_ENV: "production" } });
    expect(unset).toMatchObject({ deleted: 0, kept: 1, mode: "keep" });
  });

  it("a dry run changes nothing and answers what the run would do", async () => {
    const dry = await deletePendingFiles({ dryRun: true, now: NOW, env: PRODUCTION });
    expect(dry).toEqual({ deleted: 1, failed: 0, dropped: 2, kept: 0, waiting: 2, mode: "delete" });
    expect(del).not.toHaveBeenCalled();
    expect(calls.some((c) => c.what.endsWith(".deleteMany"))).toBe(false);
  });
});

describe("deletePendingFiles: a record using a queued file again", () => {
  const NOW = new Date(Date.UTC(2026, 11, 1, 9));
  const HOST = "store.public.blob.vercel-storage.com";
  const PRODUCTION = { VERCEL_ENV: "production", BLOB_PUBLIC_HOST: HOST };
  const queued = (urls: string[]) => {
    answers["pendingFileDeletion.findMany"] = (args: { where: { queuedAt: { lt?: Date } } }) =>
      args.where.queuedAt.lt ? urls.map((url) => ({ url, queuedAt: new Date(NOW.getTime() - 8 * 86_400_000) })) : [];
  };

  it("keeps it when the two addresses differ only in the host's case, the query, the fragment or the path's encoding", async () => {
    // As the queue may store it, and as the record keeps what the editor saved.
    queued([`https://${HOST}/a.pdf`, `https://${HOST}/b.pdf`, `https://${HOST}/c%20d.pdf`, `https://${HOST}/e.vtt`]);
    answers["lessonDocument.findMany"] = [
      { url: `https://${HOST.toUpperCase()}/a.pdf` },
      { url: `https://${HOST}/b.pdf?download=1` },
      { url: `https://${HOST}/c d.pdf` },
    ];
    answers["lesson.findMany"] = [{ video: { provider: "file", src: "/demo/x.webm", captions: [{ src: `https://${HOST}/e.vtt#t=0` }] } }];
    const result = await deletePendingFiles({ dryRun: false, now: NOW, env: PRODUCTION });
    expect(del).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deleted: 0, dropped: 4 });
  });

  it("still deletes a file whose path differs", async () => {
    queued([`https://${HOST}/a.pdf`]);
    answers["lessonDocument.findMany"] = [{ url: `https://${HOST}/a2.pdf` }, { url: `https://other.example/a.pdf` }];
    answers["lesson.findMany"] = [];
    const result = await deletePendingFiles({ dryRun: false, now: NOW, env: PRODUCTION });
    expect(del.mock.calls.map((c) => c[0])).toEqual([`https://${HOST}/a.pdf`]);
    expect(result).toMatchObject({ deleted: 1, dropped: 0 });
  });
});

describe("planCleanup", () => {
  it("says which roles each account it erases holds", async () => {
    answers["user.findMany"] = (args: { where: { profiles?: unknown } }) =>
      args.where.profiles
        ? [
            { id: "u1", email: "fac@example.org", memberships: [{ role: "FACILITATOR" }, { role: "LEARNER" }] },
            { id: "u2", email: "tester@example.org", memberships: [] },
          ]
        : [];
    const plan = await planCleanup("admin-1", new Date(Date.UTC(2026, 11, 1)), {});
    expect(plan.accounts).toEqual([
      { id: "u1", email: "fac@example.org", roles: ["FACILITATOR", "LEARNER"] },
      { id: "u2", email: "tester@example.org", roles: [] },
    ]);
    expect(JSON.stringify(call("prisma.user.findMany")?.args)).toContain('"memberships"');
  });
});

describe("Brussels time", () => {
  it("shows a moment as the date and time in Brussels, summer and winter", () => {
    expect(brusselsTime(new Date("2026-11-30T08:15:00Z"))).toBe("2026-11-30 09:15");
    expect(brusselsTime(new Date("2026-07-01T08:15:00Z"))).toBe("2026-07-01 10:15");
    expect(brusselsDay(new Date("2026-11-30T23:00:00Z"))).toBe("2026-12-01");
  });
});

describe("getDataTools", () => {
  const ADMIN = { user: { id: "admin-1", email: "admin@example.org" }, roles: ["ADMIN"], profile: null, scope: { kind: "project" } };
  const staffActor = { email: "admin@example.org", staffHistory: [{ userId: "admin-1" }], memberships: [{ id: "m1" }] };

  it("is null for anyone but an ADMIN with project scope, before any read", async () => {
    await expect(getDataTools()).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it("dates a partner admin's addition by when the profile was made, which a later mark doesn't move", async () => {
    requireAdminProject.mockResolvedValueOnce(ADMIN);
    answers["user.findMany"] = (args: { where: { emailVerified?: unknown } }) =>
      "emailVerified" in args.where
        ? [
            {
              id: "u9",
              email: "added@example.org",
              profiles: [
                {
                  testAccountAt: new Date("2026-11-30T10:00:00Z"),
                  createdAt: new Date("2026-11-26T10:00:00Z"),
                  updatedAt: new Date("2026-11-30T10:00:00Z"),
                  organisation: { name: "Pro Arbeit" },
                },
              ],
            },
          ]
        : [];
    const tools = await getDataTools();
    expect(tools?.review["partner-never-signed-in"]).toEqual([
      { id: "u9", email: "added@example.org", testAccount: true, detail: "Pro Arbeit · 2026-11-26" },
    ]);
  });

  it("gives each log row its Brussels time and its details in words, organisations by name", async () => {
    requireAdminProject.mockResolvedValueOnce(ADMIN);
    answers["auditLog.findMany"] = (args: { distinct?: unknown }) =>
      args.distinct
        ? []
        : [
            {
              id: "r1",
              action: "account.exported",
              createdAt: new Date("2026-11-30T08:15:00Z"),
              metadata: { byAdmin: true, requestRef: "REQ-2026-004" },
              actor: staffActor,
            },
            {
              id: "r2",
              action: "person.organisation_changed",
              createdAt: new Date("2026-07-01T08:15:00Z"),
              metadata: { scope: "org-a" },
              actor: staffActor,
            },
            {
              id: "r3",
              action: "person.organisation_changed",
              createdAt: new Date("2026-07-01T08:15:00Z"),
              metadata: { scope: "project" },
              actor: staffActor,
            },
            {
              id: "r4",
              action: "account.deleted",
              createdAt: new Date("2026-11-30T08:15:00Z"),
              metadata: { selfService: true },
              actor: null,
            },
            {
              id: "r5",
              action: "data.cleanup_run",
              createdAt: new Date("2026-11-30T08:15:00Z"),
              metadata: { runId: "abc123", counts: { accountsErased: 2, demoSessions: 1, enrolments: 0 } },
              actor: staffActor,
            },
            {
              id: "r6",
              action: "account.reset",
              createdAt: new Date("2026-11-30T08:15:00Z"),
              metadata: { sessions: 1, enrolments: 2, badges: 0 },
              actor: staffActor,
            },
          ];
    answers["organisation.findMany"] = [{ id: "org-a", name: "Pro Arbeit" }];
    const tools = await getDataTools();
    expect(tools?.log.map((r) => [r.when, r.details])).toEqual([
      ["2026-11-30 09:15", "by an admin · reference REQ-2026-004"],
      ["2026-07-01 10:15", "scope: Pro Arbeit"],
      ["2026-07-01 10:15", "scope: whole project"],
      ["2026-11-30 09:15", "by the account holder"],
      ["2026-11-30 09:15", "run abc123 · accounts erased: 2, showcase sign-in sessions: 1"],
      ["2026-11-30 09:15", "sessions: 1, enrolments: 2"],
    ]);
    expect(tools?.log[0]).toMatchObject({ at: "2026-11-30T08:15:00.000Z", action: "account.exported", who: "admin@example.org" });
  });

  it("says in words whether a guardian's permission recorded on Manage people covers sharing the Comp Card", async () => {
    requireAdminProject.mockResolvedValueOnce(ADMIN);
    // Manage people (actions/admin.ts) records the permission with
    // `sharing`: whether it also covers sharing the card (spec 5.6).
    const recorded = (id: string, sharing: boolean) => ({
      id,
      action: "member.guardian_consent_recorded",
      createdAt: new Date("2026-11-30T08:15:00Z"),
      metadata: { scope: "org-a", sharing },
      actor: staffActor,
    });
    answers["auditLog.findMany"] = (args: { distinct?: unknown }) =>
      args.distinct ? [] : [recorded("g1", true), recorded("g2", false)];
    answers["organisation.findMany"] = [{ id: "org-a", name: "Pro Arbeit" }];
    const tools = await getDataTools();
    expect(tools?.log.map((r) => r.details)).toEqual([
      "scope: Pro Arbeit · covers sharing the Comp Card",
      "scope: Pro Arbeit · doesn't cover sharing the Comp Card",
    ]);
  });
});
