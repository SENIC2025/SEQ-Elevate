import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
 * Sign-in email limits (D116), checked before a sign-in link is made or sent:
 * - per client (SIGNIN_EMAILS_PER_IP_15MIN, default 30 per 15 minutes),
 *   keyed by the first x-forwarded-for value (an IPv6 address by its /64),
 *   else one fixed bucket;
 * - per address: 5 per 15 minutes, as since D96;
 * - for the whole site (SIGNIN_EMAILS_PER_HOUR, default 200 per hour).
 * Checked in that order; a request refused by one is not counted by the next,
 * so the hourly cap counts only emails about to be sent. Over a limit, no
 * email. When the limiter can't count, every one of the three allows (a
 * database hiccup must never stop sign-in), with one log line each.
 *
 * The limiter runs for real on the limiter's in-memory test double (as in
 * rate-limit.test.ts): counts by stored key and window, or fails.
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

const { checkSignInEmail, clientBucket, signInEmailCaps, SIGN_IN_EMAIL_DEFAULTS } = await import("./signin-email-limits");

const SECRET = "test-auth-secret-0123456789abcdef";
const T0 = Date.UTC(2026, 10, 20, 10, 0, 0); // a window boundary for 15 min and 1 h
const MIN = 60_000;
const NO_SETTINGS = {};

const ask = (address: string, forwardedFor: string | null = "203.0.113.7", env: Record<string, string | undefined> = NO_SETTINGS) =>
  checkSignInEmail({ address, forwardedFor }, env);

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
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("the settings", () => {
  it("default to 30 per client per 15 minutes and 200 per hour", () => {
    expect(SIGN_IN_EMAIL_DEFAULTS).toEqual({ perClient: 30, perHour: 200 });
    expect(signInEmailCaps({})).toEqual({ perClient: 30, perHour: 200 });
    expect(signInEmailCaps({ SIGNIN_EMAILS_PER_IP_15MIN: "", SIGNIN_EMAILS_PER_HOUR: " " })).toEqual({ perClient: 30, perHour: 200 });
  });

  it("are read as whole numbers of at least one", () => {
    expect(signInEmailCaps({ SIGNIN_EMAILS_PER_IP_15MIN: "12", SIGNIN_EMAILS_PER_HOUR: " 500 " })).toEqual({ perClient: 12, perHour: 500 });
    expect(signInEmailCaps({ SIGNIN_EMAILS_PER_IP_15MIN: "1", SIGNIN_EMAILS_PER_HOUR: "1" })).toEqual({ perClient: 1, perHour: 1 });
  });

  it("anything else means the default, logged without the value", () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of ["0", "-5", "2.5", "ten", "1e3", "30 per minute"]) {
      expect(signInEmailCaps({ SIGNIN_EMAILS_PER_IP_15MIN: bad, SIGNIN_EMAILS_PER_HOUR: bad }), bad).toEqual({ perClient: 30, perHour: 200 });
    }
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("SIGNIN_EMAILS_PER_IP_15MIN"))).toBe(true);
    expect(lines.some((l) => l.includes("SIGNIN_EMAILS_PER_HOUR"))).toBe(true);
    expect(lines.join("\n")).not.toMatch(/ten|per minute|-5|2\.5|1e3/);
  });
});

describe("the client a request is counted for", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    ["203.0.113.7, 10.0.0.1, 10.0.0.2", "203.0.113.7"],
    ["  198.51.100.20 ,10.0.0.1", "198.51.100.20"],
    // An IPv6 address counts by its /64, the block one connection is given.
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"],
    ["2001:DB8:0001:0002:ffff::1", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["64:ff9b::192.0.2.1", "64:ff9b:0:0::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    // An IPv4 address written as IPv6 is the IPv4 address.
    ["::ffff:203.0.113.7", "203.0.113.7"],
  ])("%j → %j", (header, bucket) => {
    expect(clientBucket(header)).toBe(bucket);
  });

  it("is one fixed bucket when there is no usable first value", () => {
    for (const header of [null, undefined, "", " ", "unknown", "evil, 203.0.113.7", "203.0.113.7:4711", "300.1.1.1", "<script>"]) {
      expect(clientBucket(header), JSON.stringify(header)).toBe("unknown");
    }
  });
});

describe("per client", () => {
  it("allows 30 emails in 15 minutes from one client, to any addresses, and refuses the 31st", async () => {
    for (let i = 0; i < 30; i++) expect(await ask(`learner-${i}@example.org`), `email ${i + 1}`).toEqual({ ok: true });
    expect(await ask("learner-30@example.org")).toEqual({ ok: false, limit: "client" });
    // Another client is not held up.
    expect(await ask("learner-30@example.org", "198.51.100.20")).toEqual({ ok: true });
  });

  it("counts the addresses of one IPv6 /64 as one client", async () => {
    const env = { SIGNIN_EMAILS_PER_IP_15MIN: "2" };
    expect(await ask("a@example.org", "2001:db8:1:2::a", env)).toEqual({ ok: true });
    expect(await ask("b@example.org", "2001:db8:1:2::b", env)).toEqual({ ok: true });
    expect(await ask("c@example.org", "2001:db8:1:2:ffff:ffff:ffff:ffff", env)).toEqual({ ok: false, limit: "client" });
    expect(await ask("c@example.org", "2001:db8:1:3::1", env)).toEqual({ ok: true });
  });

  it("counts requests with no usable address together", async () => {
    const env = { SIGNIN_EMAILS_PER_IP_15MIN: "2" };
    expect(await ask("a@example.org", null, env)).toEqual({ ok: true });
    expect(await ask("b@example.org", "nonsense", env)).toEqual({ ok: true });
    expect(await ask("c@example.org", "", env)).toEqual({ ok: false, limit: "client" });
  });

  it("starts again in the next 15 minutes, and follows the setting", async () => {
    const env = { SIGNIN_EMAILS_PER_IP_15MIN: "3" };
    for (let i = 0; i < 3; i++) expect(await ask(`l${i}@example.org`, "203.0.113.7", env)).toEqual({ ok: true });
    expect(await ask("l3@example.org", "203.0.113.7", env)).toEqual({ ok: false, limit: "client" });
    vi.setSystemTime(T0 + 15 * MIN);
    expect(await ask("l3@example.org", "203.0.113.7", env)).toEqual({ ok: true });
  });

  it("stores no address of the client, only its keyed hash", async () => {
    await ask("ana@example.org", "203.0.113.7");
    const keys = rows.map((r) => r.key).join("\n");
    expect(keys).not.toContain("203.0.113.7");
    expect(keys).not.toContain("ana@example.org");
    expect(rows.map((r) => r.key.split(":")[0]).sort()).toEqual(["magiclink", "magiclink-all", "magiclink-ip"]);
  });
});

describe("per address (as since D96)", () => {
  it("allows 5 links to one address in 15 minutes, from any clients, and refuses the 6th", async () => {
    for (let i = 0; i < 5; i++) expect(await ask("ana@example.org", `203.0.113.${i + 1}`)).toEqual({ ok: true });
    expect(await ask("ana@example.org", "203.0.113.99")).toEqual({ ok: false, limit: "address" });
    expect(await ask("beth@example.org", "203.0.113.99")).toEqual({ ok: true });
    vi.setSystemTime(T0 + 15 * MIN);
    expect(await ask("ana@example.org", "203.0.113.99")).toEqual({ ok: true });
  });
});

describe("for the whole site, per hour", () => {
  it("allows 200 emails an hour from many clients, and refuses the next until the hour has passed", async () => {
    for (let i = 0; i < 200; i++) {
      expect(await ask(`learner-${i}@example.org`, `198.51.100.${i % 50}`), `email ${i + 1}`).toEqual({ ok: true });
    }
    expect(await ask("one-more@example.org", "203.0.113.200")).toEqual({ ok: false, limit: "hourly" });
    vi.setSystemTime(T0 + 59 * MIN);
    expect(await ask("one-more@example.org", "203.0.113.201")).toEqual({ ok: false, limit: "hourly" });
    vi.setSystemTime(T0 + 60 * MIN);
    expect(await ask("one-more@example.org", "203.0.113.202")).toEqual({ ok: true });
  });

  it("follows the setting", async () => {
    const env = { SIGNIN_EMAILS_PER_HOUR: "2" };
    expect(await ask("a@example.org", "203.0.113.1", env)).toEqual({ ok: true });
    expect(await ask("b@example.org", "203.0.113.2", env)).toEqual({ ok: true });
    expect(await ask("c@example.org", "203.0.113.3", env)).toEqual({ ok: false, limit: "hourly" });
  });

  it("counts only emails about to be sent: a request refused per client or per address uses none of the hour", async () => {
    const env = { SIGNIN_EMAILS_PER_IP_15MIN: "1", SIGNIN_EMAILS_PER_HOUR: "3" };
    expect(await ask("a@example.org", "203.0.113.1", env)).toEqual({ ok: true }); // hour: 1
    for (let i = 0; i < 5; i++) {
      expect(await ask(`x${i}@example.org`, "203.0.113.1", env)).toEqual({ ok: false, limit: "client" });
    }
    for (let i = 0; i < 4; i++) expect(await ask("ana@example.org", `198.51.100.${i}`, { SIGNIN_EMAILS_PER_HOUR: "100" })).toEqual({ ok: true });
    expect(await ask("ana@example.org", "198.51.100.9", { SIGNIN_EMAILS_PER_HOUR: "100" })).toEqual({ ok: true }); // 5th to ana
    expect(await ask("ana@example.org", "198.51.100.10", env)).toEqual({ ok: false, limit: "address" });
    // The hour holds 1 + 5 = 6 emails sent; with a cap of 7 one more goes, then none.
    const seven = { SIGNIN_EMAILS_PER_HOUR: "7" };
    expect(await ask("b@example.org", "198.51.100.20", seven)).toEqual({ ok: true });
    expect(await ask("c@example.org", "198.51.100.21", seven)).toEqual({ ok: false, limit: "hourly" });
  });
});

describe("when the limiter can't count", () => {
  it("allows the email (sign-in must not stop), with a log line per limit and neither address", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    failing = true;
    expect(await ask("ana@example.org", "203.0.113.7")).toEqual({ ok: true });
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(3);
    expect(lines.join("\n")).toMatch(/magiclink-ip.*allowed/);
    expect(lines.join("\n")).toMatch(/magiclink-all.*allowed/);
    expect(lines.join("\n")).not.toMatch(/ana@|203\.0\.113/);
  });

  it("allows the email when there is no secret to make the keys with", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("AUTH_SECRET", "");
    expect(await ask("ana@example.org", "203.0.113.7")).toEqual({ ok: true });
  });

  it("still refuses once it counts again and a limit is reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = { SIGNIN_EMAILS_PER_IP_15MIN: "1" };
    failing = true;
    expect(await ask("a@example.org", "203.0.113.7", env)).toEqual({ ok: true });
    failing = false;
    expect(await ask("b@example.org", "203.0.113.7", env)).toEqual({ ok: true });
    expect(await ask("c@example.org", "203.0.113.7", env)).toEqual({ ok: false, limit: "client" });
  });
});
