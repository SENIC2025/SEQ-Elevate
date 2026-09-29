import { notFound } from "next/navigation";

/**
 * Developer-only pages (CMS check, component gallery) show internals, so the
 * live site answers every /dev address with a 404. "Live" means Vercel's
 * production environment or any deployment with test sign-in switched off
 * (DEMO_LOGIN_DISABLED) — which also covers self-hosting.
 *
 * Call it first thing in EVERY /dev page, not only in the layout: Next.js
 * renders a page alongside its layout, so a layout-only 404 would still
 * build the page's data into the response.
 */
export function assertDevPagesAllowed(): void {
  if (
    process.env.VERCEL_ENV === "production" ||
    process.env.DEMO_LOGIN_DISABLED === "true"
  ) {
    notFound();
  }
}
