import "server-only";

/**
 * Sign-in email limits (D116): how many sign-in link emails the site sends,
 * checked by Auth.js's signIn callback (src/auth.ts) before a link is made
 * or sent, whichever way it was asked for (the sign-in form, or Auth.js's
 * own endpoint). Invitations have their own limits (src/lib/invitations.ts).
 *
 * Three limits, in this order; a request refused by one is not counted by
 * the next, so the hourly cap counts only emails about to be sent:
 * 1. Per client: SIGNIN_EMAILS_PER_IP_15MIN (default 30) in a 15-minute
 *    window, keyed by the first x-forwarded-for value (Vercel sets it to the
 *    address the request came from; Next.js sets it from the connection when
 *    nothing in front did). An IPv6 address counts by its /64, the block one
 *    connection is given; an IPv4 address written as IPv6 counts as itself.
 *    A request with no usable value counts in one fixed bucket.
 * 2. Per address: 5 in 15 minutes (D96, unchanged), keyed by the address.
 * 3. For the whole site: SIGNIN_EMAILS_PER_HOUR (default 200) in an hour.
 *
 * The defaults are set above what the pilot needs (about 120 learners, D24):
 * a whole group signing in in one room behind one shared address, and the
 * whole pilot signing in within the same hour, stay under them. A setting
 * that isn't a whole number of at least 1 means its default (logged once,
 * without the value).
 *
 * Over a limit, no email. When the limiter can't count (a database or
 * secret problem), each of the three allows, with one log line (the
 * limiter's fail-open prefixes, src/lib/rate-limit.ts): a limiter fault must
 * never stop every sign-in on the site, which is the very outage the caps
 * are there to prevent; and with the database down, Auth.js can't look the
 * address up or store a link, so no email goes out anyway. A limit is
 * enforced again as soon as the limiter counts again.
 *
 * Every key is stored only as a keyed hash (src/lib/rate-limit.ts): neither
 * the client's network address nor the email address is stored, and the
 * rows go within two hours.
 */

import { isIPv4, isIPv6 } from "node:net";
import { checkRateLimit, hashKey } from "@/lib/rate-limit";

type Env = Record<string, string | undefined>;

export const SIGN_IN_EMAIL_DEFAULTS = { perClient: 30, perHour: 200 } as const;

const QUARTER_HOUR_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Per address: as since D96. */
const PER_ADDRESS = { limit: 5, windowMs: QUARTER_HOUR_MS };

/** The bucket of every request whose first x-forwarded-for value isn't an IP address. */
export const FIXED_BUCKET = "unknown";

const SETTINGS = { perClient: "SIGNIN_EMAILS_PER_IP_15MIN", perHour: "SIGNIN_EMAILS_PER_HOUR" } as const;
const warned = new Set<string>();

function setting(env: Env, which: keyof typeof SETTINGS): number {
  const name = SETTINGS[which];
  const raw = env[name]?.trim();
  if (!raw) return SIGN_IN_EMAIL_DEFAULTS[which];
  const n = /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
  if (Number.isInteger(n) && n >= 1) return n;
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`[signin-limits] ${name} isn't a whole number of at least 1; using ${SIGN_IN_EMAIL_DEFAULTS[which]}`);
  }
  return SIGN_IN_EMAIL_DEFAULTS[which];
}

/** The two settings, as read (their defaults when unset or unusable). */
export function signInEmailCaps(env: Env = process.env): { perClient: number; perHour: number } {
  return { perClient: setting(env, "perClient"), perHour: setting(env, "perHour") };
}

/** An IPv6 address's first 64 bits, written "a:b:c:d::/64". */
function ipv6Block(address: string): string {
  let s = address.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    s = `${s.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const gap = s.indexOf("::");
  const head = (gap >= 0 ? s.slice(0, gap) : s).split(":").filter(Boolean);
  const tail = gap >= 0 ? s.slice(gap + 2).split(":").filter(Boolean) : [];
  const groups = gap >= 0 ? [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail] : head;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

/** The client a request is counted for: from the first x-forwarded-for value, else the fixed bucket. */
export function clientBucket(forwardedFor: string | null | undefined): string {
  const first = (forwardedFor ?? "").split(",")[0].trim();
  if (isIPv4(first)) return first;
  if (isIPv6(first)) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(first);
    if (mapped && isIPv4(mapped[1])) return mapped[1];
    return ipv6Block(first);
  }
  return FIXED_BUCKET;
}

/**
 * The address's key. Without a secret no key can be made; the limiter then
 * can't count either, and allows (the per-address limit fails open, D96).
 */
function addressKey(address: string): string {
  try {
    return hashKey("magiclink", address);
  } catch {
    return "magiclink:";
  }
}

export type SignInEmailVerdict = { ok: true } | { ok: false; limit: "client" | "address" | "hourly" };

/**
 * May a sign-in link be emailed to `address` (already normalised by the
 * sign-in address rule) for a request with this x-forwarded-for header?
 * Counts the request against each limit it reaches.
 */
export async function checkSignInEmail(
  request: { address: string; forwardedFor: string | null | undefined },
  env: Env = process.env
): Promise<SignInEmailVerdict> {
  const caps = signInEmailCaps(env);
  const client = await checkRateLimit(`magiclink-ip:${clientBucket(request.forwardedFor)}`, {
    limit: caps.perClient,
    windowMs: QUARTER_HOUR_MS,
  });
  if (!client.ok) return { ok: false, limit: "client" };
  const address = await checkRateLimit(addressKey(request.address), PER_ADDRESS);
  if (!address.ok) return { ok: false, limit: "address" };
  const hourly = await checkRateLimit("magiclink-all:site", { limit: caps.perHour, windowMs: HOUR_MS });
  if (!hourly.ok) return { ok: false, limit: "hourly" };
  return { ok: true };
}
