/**
 * Browser error monitoring (Sentry) — wired but INERT until a DSN is set.
 *
 * `NEXT_PUBLIC_SENTRY_DSN` is inlined at build time, so when it is unset the
 * `if` is statically false and the dynamic `import("@sentry/nextjs")` is
 * tree-shaken out entirely — the Sentry client SDK is not shipped to learners
 * at all. Set the var and redeploy to activate.
 *
 * Privacy-conservative by default: no PII, no performance tracing, and NO
 * session replay (replay would record the screen — inappropriate for a
 * vulnerable-youth platform unless deliberately enabled with a DPIA).
 */

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "production",
    });
  });
}

/**
 * Instruments client-side route transitions when Sentry is active. Next calls
 * this if it is exported from the client instrumentation file; a no-op without
 * a DSN.
 */
export async function onRouterTransitionStart(...args: unknown[]) {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  (Sentry.captureRouterTransitionStart as (...a: unknown[]) => void)(...args);
}
