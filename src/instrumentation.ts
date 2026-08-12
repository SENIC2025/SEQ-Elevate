/**
 * Server + edge error monitoring (Sentry) — wired but INERT until a DSN is set.
 *
 * Activation is one step: set `SENTRY_DSN` (and `NEXT_PUBLIC_SENTRY_DSN` for the
 * browser) in the environment and redeploy. With no DSN, `@sentry/nextjs` is
 * never imported or initialised here, so there is zero runtime cost — the
 * dynamic `import()` lives behind the env check.
 *
 * Deliberately privacy-conservative for a vulnerable-youth platform:
 *   - `sendDefaultPii: false` — no IPs, cookies, or request bodies attached.
 *   - performance tracing off by default (`tracesSampleRate: 0`).
 *   - no session replay (configured on the client side).
 *
 * Source-map upload (`withSentryConfig` + `SENTRY_AUTH_TOKEN`) is intentionally
 * NOT wired, so nothing couples to the Turbopack build. Add it later if you
 * want symbolicated stack traces; error capture works without it.
 */

export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const runtime = process.env.NEXT_RUNTIME;
  if (runtime === "nodejs" || runtime === "edge") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      environment:
        process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "production",
    });
  }
}

/**
 * Next's per-request server error hook. Forwards to Sentry only when a DSN is
 * configured; a no-op otherwise. Loosely typed to avoid coupling to Next's
 * instrumentation types (the signature matches Next's onRequestError hook).
 */
export async function onRequestError(
  error: unknown,
  request: unknown,
  context: unknown
) {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  (
    Sentry.captureRequestError as (
      e: unknown,
      r: unknown,
      c: unknown
    ) => void
  )(error, request, context);
}
