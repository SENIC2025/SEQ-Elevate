import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash, createHmac } from "node:crypto";

/*
 * UD3 (spec 13.6, D96): the rate limiter.
 * - Every key is stored as a keyed hash (HMAC-SHA256 under RATE_LIMIT_SECRET,
 *   else a key derived from AUTH_SECRET), whatever the caller passes; so is
 *   hashKey's output. A plain SHA-256 of an address can be undone by hashing
 *   likely addresses; a keyed one can't without the secret.
 * - A window's start is stored in epoch seconds, so windows of different
 *   lengths compare, and the clean-up removes only rows whose window started
 *   more than two hours ago: a short-window call never deletes a
 *   long-window counter.
 * - When the limiter can't count, the key's prefix decides: staff-only
 *   callers (upload-, invite-by:, invite:, add-by:) and unknown prefixes are
 *   refused; sign-in links (magiclink:) are allowed, with one log line.
 * - The keys of one person (for erasure) are the ones the callers make.
 */

vi.mock("server-only", () => ({}));

type Row = { key: string; windowStart: number; count: number };
const rows: Row[] = [];
let failing = false;

const rateLimit = {
  upsert: vi.fn(async (args: { where: { key_windowStart: { key: string; windowStart: number } } }) => {
    if (failing) throw new Error("connection lost");
    const { key, windowStart } = args.where.key_windowStart;
    let row = rows.find((r) => r.key === key && r.windowStart === windowStart);
    if (!row) rows.push((row = { key, windowStart, count: 0 }));
    row.count += 1;
    return { ...row };
  }),
  deleteMany: vi.fn(async (args: { where: { windowStart: { lt: number } } }) => {
    const before = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].windowStart < args.where.windowStart.lt) rows.splice(i, 1);
    return { count: before - rows.length };
  }),
};
vi.mock("@/lib/prisma", () => ({ prisma: { rateLimit } }));

const { checkRateLimit, hashKey, storedKey, rateLimitKeysOf } = await import("./rate-limit");

const SECRET = "test-auth-secret-0123456789abcdef";
const T0 = Date.UTC(2026, 10, 20, 10, 0, 0); // a window boundary for 1 min, 15 min and 1 h
const HOUR = 3_600_000;
const flush = () => new Promise((r) => setTimeout(r, 0));

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

beforeEach(() => {
  rows.length = 0;
  failing = false;
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("RATE_LIMIT_SECRET", "");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("stored keys", () => {
  it("are a keyed hash of what the caller passes, under the caller's prefix", async () => {
    await checkRateLimit("upload-video:user-123", { limit: 30, windowMs: 60_000 });
    const [row] = rows;
    expect(row.key).toMatch(/^upload-video:[0-9a-f]{64}$/);
    expect(row.key).not.toContain("user-123");
    expect(row.key).toBe(storedKey("upload-video:user-123"));
  });

  it("hashKey is a keyed hash too, not a plain SHA-256 of the address", () => {
    const key = hashKey("magiclink", " Ana@Example.org ");
    expect(key).toMatch(/^magiclink:[0-9a-f]{64}$/);
    const digest = key.slice("magiclink:".length);
    expect(sha256("ana@example.org")).not.toContain(digest);
    expect(digest).not.toContain(sha256("ana@example.org").slice(0, 32));
    // The same address, however it is typed.
    expect(hashKey("magiclink", "ana@example.org")).toBe(key);
  });

  it("depend on the secret: AUTH_SECRET (through a derived key), or RATE_LIMIT_SECRET when set", () => {
    const a = hashKey("invite", "ana@example.org");
    const k = storedKey("add-by:u1");
    vi.stubEnv("AUTH_SECRET", "another-secret-of-the-same-length!");
    expect(hashKey("invite", "ana@example.org")).not.toBe(a);
    expect(storedKey("add-by:u1")).not.toBe(k);
    // The derived key is not AUTH_SECRET itself.
    const plain = createHmac("sha256", "another-secret-of-the-same-length!").update("add-by:u1").digest("hex");
    expect(storedKey("add-by:u1")).not.toBe(`add-by:${plain}`);
    vi.stubEnv("RATE_LIMIT_SECRET", "its-own-secret-0123456789");
    const own = storedKey("add-by:u1");
    vi.stubEnv("AUTH_SECRET", SECRET);
    expect(storedKey("add-by:u1")).toBe(own);
  });

  it("can't be made without a secret", () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => storedKey("upload-doc:u1")).toThrow(/secret/);
  });
});

describe("windows", () => {
  it("start at the window's first second, in epoch seconds", async () => {
    vi.setSystemTime(T0 + 90_000);
    await checkRateLimit("upload-doc:u1", { limit: 30, windowMs: 60_000 });
    await checkRateLimit(hashKey("magiclink", "ana@example.org"), { limit: 5, windowMs: 15 * 60_000 });
    expect(rows.map((r) => r.windowStart)).toEqual([(T0 + 60_000) / 1000, T0 / 1000]);
  });

  it("count within a window and start again in the next", async () => {
    const key = "invite-by:admin-1";
    const opts = { limit: 2, windowMs: HOUR };
    expect((await checkRateLimit(key, opts)).ok).toBe(true);
    expect((await checkRateLimit(key, opts)).ok).toBe(true);
    expect(await checkRateLimit(key, opts)).toEqual({ ok: false, count: 3, limit: 2 });
    vi.setSystemTime(T0 + HOUR);
    expect(await checkRateLimit(key, opts)).toEqual({ ok: true, count: 1, limit: 2 });
  });

  it("a short-window call never deletes a long-window counter", async () => {
    const long = { limit: 100, windowMs: HOUR };
    await checkRateLimit("invite-by:admin-1", long);
    await checkRateLimit("invite-by:admin-1", long);
    // Half an hour later, a one-minute caller runs the clean-up.
    vi.setSystemTime(T0 + HOUR / 2);
    await checkRateLimit("upload-doc:u1", { limit: 30, windowMs: 60_000 });
    await flush();
    const counter = rows.find((r) => r.key === storedKey("invite-by:admin-1"));
    expect(counter?.count).toBe(2);
    expect((await checkRateLimit("invite-by:admin-1", long)).count).toBe(3);
  });

  it("the clean-up removes rows whose window started more than two hours ago", async () => {
    // A row of the earlier format (a small window number) and an old one of this format.
    rows.push({ key: "magiclink:old", windowStart: 1_965_000, count: 1 });
    rows.push({ key: "upload-doc:old", windowStart: T0 / 1000 - 2 * 3600 - 1, count: 1 });
    rows.push({ key: "upload-doc:recent", windowStart: T0 / 1000 - 2 * 3600, count: 1 });
    await checkRateLimit("upload-doc:u1", { limit: 30, windowMs: 60_000 });
    await flush();
    expect(rateLimit.deleteMany).toHaveBeenCalledWith({ where: { windowStart: { lt: T0 / 1000 - 7200 } } });
    expect(rows.map((r) => r.key).sort()).toEqual(["upload-doc:recent", storedKey("upload-doc:u1")].sort());
  });
});

describe("when the limiter can't count", () => {
  const opts = { limit: 5, windowMs: 60_000 };

  it.each([
    "upload-video:u1",
    "upload-doc:u1",
    "upload-caption:u1",
    "invite-by:admin-1",
    "add-by:admin-1",
    "something-new:u1",
    "no-prefix",
  ])("refuses %s (staff-only callers and unknown prefixes fail closed)", async (key) => {
    failing = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await checkRateLimit(key, opts)).ok).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).not.toContain("u1");
  });

  it("refuses an invitation to an address (invite:)", async () => {
    failing = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await checkRateLimit(hashKey("invite", "ana@example.org"), opts)).ok).toBe(false);
  });

  it("allows a sign-in link (magiclink:), with one log line and no address", async () => {
    failing = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await checkRateLimit(hashKey("magiclink", "ana@example.org"), opts)).ok).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).not.toMatch(/ana|example/);
  });

  it("refuses when there is no secret to make the key with, except a sign-in link", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await checkRateLimit("upload-doc:u1", opts)).ok).toBe(false);
    expect((await checkRateLimit("magiclink:abc", opts)).ok).toBe(true);
    expect(rateLimit.upsert).not.toHaveBeenCalled();
  });
});

describe("rateLimitKeysOf (erasure)", () => {
  it("are the stored keys every caller makes from the person's id and address", async () => {
    const person = { id: "user-9", email: "Ana@Example.org" };
    const opts = { limit: 100, windowMs: 60_000 };
    // What the callers pass (auth.ts, invitations.ts, the three upload routes, addMember).
    for (const key of [
      hashKey("magiclink", "ana@example.org"),
      hashKey("invite", "ana@example.org"),
      "upload-video:user-9",
      "upload-doc:user-9",
      "upload-caption:user-9",
      "invite-by:user-9",
      "add-by:user-9",
    ]) {
      await checkRateLimit(key, opts);
    }
    expect(rateLimitKeysOf(person).sort()).toEqual(rows.map((r) => r.key).sort());
    expect(rateLimitKeysOf(person)).toHaveLength(7);
    // Someone else's keys are not among them.
    expect(rateLimitKeysOf(person)).not.toContain(storedKey("upload-doc:user-90"));
  });
});
