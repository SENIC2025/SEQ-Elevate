import { notFound } from "next/navigation";

/**
 * Developer-only pages (CMS check, component gallery). They show internals,
 * so the live site answers every /dev address with a 404.
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.VERCEL_ENV === "production") notFound();
  return children;
}
