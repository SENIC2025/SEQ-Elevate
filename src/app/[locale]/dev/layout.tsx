import { notFound } from "next/navigation";

/**
 * Developer-only pages (CMS check, component gallery). They show internals,
 * so the live site answers every /dev address with a 404. "Live" means either
 * Vercel's production environment or any deployment with test sign-in
 * switched off (DEMO_LOGIN_DISABLED) — which also covers self-hosting.
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (
    process.env.VERCEL_ENV === "production" ||
    process.env.DEMO_LOGIN_DISABLED === "true"
  ) {
    notFound();
  }
  return children;
}
