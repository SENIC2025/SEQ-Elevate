import { hasLocale } from "next-intl";
import { notFound, permanentRedirect } from "next/navigation";
import { routing } from "@/i18n/routing";

/**
 * Old address of a preview mock-up that no longer exists. Kept as a permanent
 * redirect so saved links land on the authoring page instead of a 404.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Pages render alongside the locale layout's own check, so only ever build
  // the redirect from a known locale (never from raw URL input).
  if (!hasLocale(routing.locales, locale)) notFound();
  permanentRedirect(`/${locale}/content`);
}
