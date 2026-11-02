import "server-only";

/**
 * Small DB-backed fixed-window rate limiter (D96, spec 13.6). Serverless-safe:
 * the DB is the shared source of truth, so it works across Vercel lambdas.
 *
 * - **No identifier is stored.** Every key is stored as `<prefix>:` plus a
 *   keyed hash (HMAC-SHA256) of what the caller passed, under a server
 *   secret: RATE_LIMIT_SECRET, else a key derived from AUTH_SECRET with a
 *   fixed label. hashKey (for an email address) is a keyed hash too, so an
 *   address can't be found again by hashing likely addresses. Changing the
 *   secret starts every counter again (harmless).
 * - **Windows compare.** A row's windowStart is its window's first second, in
 *   epoch seconds (fits an Int until 2038). The clean-up removes rows whose
 *   window started more than two hours ago (the longest window is one hour),
 *   so a short-window caller never removes a long-window counter.
 * - **Failing is decided by the key's prefix**, so no caller changes:
 *   sign-in links' limits (per address `magiclink:`, and D116's per client
 *   `magiclink-ip:` and per hour `magiclink-all:`) allow when the limiter
 *   can't count (a database hiccup must never lock learners out of signing
 *   in; src/lib/signin-email-limits.ts says why), with one log line;
 *   everything else — the staff-only callers (`upload-…`, `invite-by:`,
 *   `invite:`, `add-by:`), a learner's activity records (`activity:`, D117:
 *   nothing is recorded then) and any prefix this file doesn't know — is
 *   refused.
 */

import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";

type Env = Record<string, string | undefined>;

export interface RateLimitResult {
  ok: boolean;
  count: number;
  limit: number;
}

/** The longest window a caller may use; rows are kept twice as long. */
const MAX_WINDOW_MS = 60 * 60 * 1000;
const KEEP_SECONDS = 2 * 60 * 60;
/** What the key derived from AUTH_SECRET is made for (changing it resets every counter). */
const DERIVATION_LABEL = "seq-elevate rate-limit keys v1";

/** The only prefixes allowed through when the limiter can't count: sign-in links' limits (D96, D116). */
const FAIL_OPEN_PREFIXES: ReadonlySet<string> = new Set(["magiclink", "magiclink-ip", "magiclink-all"]);

/** The HMAC key: RATE_LIMIT_SECRET, else one derived from AUTH_SECRET. Throws when neither is set. */
function limiterKey(env: Env): Buffer {
  const own = env.RATE_LIMIT_SECRET?.trim();
  if (own) return Buffer.from(own, "utf8");
  const auth = env.AUTH_SECRET?.trim();
  if (!auth) throw new Error("rate-limit: no secret (RATE_LIMIT_SECRET or AUTH_SECRET)");
  return createHmac("sha256", auth).update(DERIVATION_LABEL).digest();
}

const keyed = (value: string, env: Env) => createHmac("sha256", limiterKey(env)).update(value).digest("hex");

/** A key's prefix: what comes before its first colon ("" when there is none). */
const prefixOf = (key: string) => (key.includes(":") ? key.slice(0, key.indexOf(":")) : "");

/** A key for a sensitive identifier (an email address): its keyed hash, the same however it is typed. */
export function hashKey(prefix: string, value: string, env: Env = process.env): string {
  return `${prefix}:${keyed(value.trim().toLowerCase(), env)}`;
}

/** How a key is stored: its prefix, then the keyed hash of the whole key. */
export function storedKey(key: string, env: Env = process.env): string {
  return `${prefixOf(key) || "key"}:${keyed(key, env)}`;
}

/** The prefixes callers key by a person's id, and by their email address (through hashKey). */
const ID_PREFIXES = ["upload-video", "upload-doc", "upload-caption", "invite-by", "add-by", "activity"] as const;
const EMAIL_PREFIXES = ["magiclink", "invite"] as const;

/**
 * Every stored key the callers make for one person (from their id and from
 * their address), so erasing the person removes their counters too.
 */
export function rateLimitKeysOf(person: { id: string; email: string }, env: Env = process.env): string[] {
  return [
    ...ID_PREFIXES.map((prefix) => storedKey(`${prefix}:${person.id}`, env)),
    ...EMAIL_PREFIXES.map((prefix) => storedKey(hashKey(prefix, person.email, env), env)),
  ];
}

/**
 * Count this request against `key` in the current time window. Returns ok=false
 * once the count exceeds `limit` within `windowMs` (at most an hour), and when
 * the limiter can't count, except for sign-in links' limits (see the top of this file).
 */
export async function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  try {
    if (!(windowMs >= 1000 && windowMs <= MAX_WINDOW_MS)) throw new Error("rate-limit: window out of range");
    const stored = storedKey(key);
    const seconds = Math.round(windowMs / 1000);
    const windowStart = Math.floor(now / seconds) * seconds;
    const row = await prisma.rateLimit.upsert({
      where: { key_windowStart: { key: stored, windowStart } },
      create: { key: stored, windowStart, count: 1 },
      update: { count: { increment: 1 } },
    });

    // Rows whose window started more than two hours ago, whatever their
    // window's length, so the table can't grow without bound. Best-effort.
    prisma.rateLimit.deleteMany({ where: { windowStart: { lt: now - KEEP_SECONDS } } }).catch(() => {});

    return { ok: row.count <= limit, count: row.count, limit };
  } catch (e) {
    const open = FAIL_OPEN_PREFIXES.has(prefixOf(key));
    // The kind of key and of failure only: never the key itself.
    console.error(
      `[rate-limit] couldn't count a "${prefixOf(key) || "(no prefix)"}" request (${e instanceof Error ? e.name : "error"}); ${open ? "allowed" : "refused"}`
    );
    return { ok: open, count: 0, limit };
  }
}
