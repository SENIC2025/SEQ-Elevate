import { notFound } from "next/navigation";
import { demoLoginAllowed } from "@/lib/demo-gate";

/**
 * Developer-only pages (CMS check, component gallery) show internals, so
 * they exist only on test copies: a deployment that opted in to test sign-in
 * (demoLoginAllowed, D98), never Vercel's production environment. Anywhere
 * else, self-hosting included, every /dev address is a 404.
 *
 * Call it first thing in EVERY /dev page, not only in the layout: Next.js
 * renders a page alongside its layout, so a layout-only 404 would still
 * build the page's data into the response.
 */
export function assertDevPagesAllowed(): void {
  if (process.env.VERCEL_ENV === "production" || !demoLoginAllowed()) {
    notFound();
  }
}
