/**
 * Release 3 (D95, spec 13.7): the security headers every response carries,
 * set in one place, next.config.ts (two content security policies would
 * combine to the stricter one). This module only builds the values: it is
 * pure, has no "@/" imports and no "server-only", because next.config.ts is
 * compiled outside the app and imports it by relative path. Next reads the
 * headers when it builds, so a change of the settings below needs a
 * redeploy.
 *
 * The policy names every host the browser may load from, and no other:
 * - our own origin;
 * - the Blob store our uploads are served from: BLOB_PUBLIC_HOST, the exact
 *   host; unset (or unreadable), every Vercel Blob store
 *   (*.public.blob.vercel-storage.com), with one warning in the build log;
 * - YouTube's player API script (www.youtube.com) and its player frame
 *   (www.youtube-nocookie.com): the player loads them only after the viewer
 *   presses play (spec 10.2), so nothing of YouTube loads before that;
 * - Vercel's upload API (vercel.com), which editors' uploads go through;
 * - Plausible, only when NEXT_PUBLIC_PLAUSIBLE_DOMAIN switches it on, and
 *   Sentry's ingest host, only when NEXT_PUBLIC_SENTRY_DSN is set.
 * Scripts and styles may be inline (Next's own; no nonce in Release 3:
 * a nonce makes every page dynamic, the prerendered ones included).
 * 'unsafe-eval' only on a development server, which needs it.
 *
 * R3_CSP=report-only sends the same policy as
 * Content-Security-Policy-Report-Only, so the browser reports what it would
 * block and blocks nothing; the other four headers stay.
 */

type Env = Record<string, string | undefined>;
type Warn = (line: string) => void;

export interface Header {
  key: string;
  value: string;
}

/** YouTube's player API script; loaded only after the press (InteractiveVideoPlayer). */
export const YOUTUBE_API_ORIGIN = "https://www.youtube.com";
/** The player frame YouTube's API opens for us: the reduced-cookie domain. */
export const YOUTUBE_PLAYER_ORIGIN = "https://www.youtube-nocookie.com";
/** Every Vercel Blob store's public host, used while BLOB_PUBLIC_HOST is unset. */
export const BLOB_WILDCARD_HOST = "*.public.blob.vercel-storage.com";
/** Where @vercel/blob's browser uploads go. */
export const BLOB_UPLOAD_ORIGIN = "https://vercel.com";
/** Plausible's script when NEXT_PUBLIC_PLAUSIBLE_SRC doesn't name another (Analytics.tsx). */
export const PLAUSIBLE_DEFAULT_SRC = "https://plausible.io/js/script.js";

/** One lower-case DNS host name: letters, digits and hyphens in dot-separated labels, at least two labels. */
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Settings already reported in the build log: each is said once. */
const reported = new Set<string>();
function warnOnce(key: string, line: string, warn: Warn) {
  if (reported.has(key)) return;
  reported.add(key);
  warn(line);
}

const setting = (value: string | undefined) => value?.trim() ?? "";

/**
 * The host our uploads are served from: BLOB_PUBLIC_HOST when it is one
 * host name, else every Vercel Blob store's (with a warning: the wildcard
 * admits every Vercel customer's store).
 */
export function blobHost(env: Env = process.env, warn: Warn = console.warn): string {
  const value = setting(env.BLOB_PUBLIC_HOST).toLowerCase();
  if (HOST.test(value)) return value;
  warnOnce(
    value ? "blob:unreadable" : "blob:unset",
    value
      ? `[security-headers] BLOB_PUBLIC_HOST is not one host name; the content security policy admits every Vercel Blob store (${BLOB_WILDCARD_HOST}).`
      : `[security-headers] BLOB_PUBLIC_HOST is not set; the content security policy admits every Vercel Blob store (${BLOB_WILDCARD_HOST}).`,
    warn
  );
  return BLOB_WILDCARD_HOST;
}

/** The https origin of `url`, or null. */
function httpsOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && HOST.test(parsed.hostname) ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * Plausible's origin (its script and the events it sends), only when
 * NEXT_PUBLIC_PLAUSIBLE_DOMAIN switches it on: the origin of
 * NEXT_PUBLIC_PLAUSIBLE_SRC (self-hosted), else plausible.io.
 */
export function plausibleOrigin(env: Env = process.env, warn: Warn = console.warn): string | null {
  if (!setting(env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN)) return null;
  const origin = httpsOrigin(setting(env.NEXT_PUBLIC_PLAUSIBLE_SRC) || PLAUSIBLE_DEFAULT_SRC);
  if (!origin) {
    warnOnce(
      "plausible",
      "[security-headers] NEXT_PUBLIC_PLAUSIBLE_SRC is not an https address; the content security policy leaves Plausible out.",
      warn
    );
  }
  return origin;
}

/** Sentry's ingest origin, from the browser's DSN (NEXT_PUBLIC_SENTRY_DSN), only when it is set. */
export function sentryOrigin(env: Env = process.env, warn: Warn = console.warn): string | null {
  const dsn = setting(env.NEXT_PUBLIC_SENTRY_DSN);
  if (!dsn) return null;
  const origin = httpsOrigin(dsn);
  if (!origin) {
    warnOnce(
      "sentry",
      "[security-headers] NEXT_PUBLIC_SENTRY_DSN is not an https address; the content security policy leaves Sentry out.",
      warn
    );
  }
  return origin;
}

export interface PolicyOptions {
  /** A development server (next dev): it needs 'unsafe-eval'. */
  dev?: boolean;
  warn?: Warn;
}

const isDev = (env: Env) => env.NODE_ENV === "development";

/** The content security policy, one directive after another. */
export function contentSecurityPolicy(env: Env = process.env, options: PolicyOptions = {}): string {
  const warn = options.warn ?? console.warn;
  const dev = options.dev ?? isDev(env);
  const blob = `https://${blobHost(env, warn)}`;
  const plausible = plausibleOrigin(env, warn);
  const sentry = sentryOrigin(env, warn);
  const optional = (...origins: (string | null)[]) => origins.filter((o): o is string => o !== null);
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", "'unsafe-inline'", YOUTUBE_API_ORIGIN, ...optional(plausible), ...(dev ? ["'unsafe-eval'"] : [])],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:", blob],
    ["media-src", "'self'", "blob:", blob],
    ["font-src", "'self'"],
    ["connect-src", "'self'", BLOB_UPLOAD_ORIGIN, ...optional(plausible, sentry)],
    ["frame-src", blob, YOUTUBE_PLAYER_ORIGIN],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ["upgrade-insecure-requests"],
  ];
  return directives.map((d) => d.join(" ")).join("; ");
}

/** What the YouTube player frame may use besides our own pages. */
const PLAYER = `(self "${YOUTUBE_PLAYER_ORIGIN}")`;

/** Browser features no page of ours uses are off; the player frame may play full screen and on its own. */
export const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "browsing-topics=()",
  `fullscreen=${PLAYER}`,
  `autoplay=${PLAYER}`,
  `encrypted-media=${PLAYER}`,
  `picture-in-picture=${PLAYER}`,
].join(", ");

/**
 * R3_CSP=report-only: the policy only reports. The same rule as
 * r3-switches.ts's cspReportOnly (security-headers.test.ts keeps the two
 * equal), which this module can't import: r3-switches.ts reads the messages
 * through the "@/" alias, and next.config.ts is compiled without it.
 */
export function cspReportOnly(env: Env = process.env): boolean {
  return env.R3_CSP?.trim().toLowerCase() === "report-only";
}

/** Every security header, for next.config.ts's headers() on every path. */
export function securityHeaders(env: Env = process.env, options: PolicyOptions = {}): Header[] {
  return [
    {
      key: cspReportOnly(env) ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
      value: contentSecurityPolicy(env, options),
    },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  ];
}
