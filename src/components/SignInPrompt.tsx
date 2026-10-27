import { getLocale, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { SignInHereLink } from "@/components/SignInHereLink";

/**
 * The way to sign in on a staff page's notice (AccessNotice, and the
 * facilitator workspace's, the statistics' and the admin screens' own),
 * for a visitor who is signed out: "Sign in", back to this page after the
 * email's link (src/lib/sign-in-link.ts). Nothing for anyone signed in:
 * they see the notice as before.
 *
 * `lang`: the notice's language when it isn't the page's ("en" on the
 * English-only staff notices); the link is in it too.
 */
export async function SignInPrompt({ lang }: { lang?: string }) {
  if (await getCurrentUser()) return null;
  const locale = await getLocale();
  const t = await getTranslations({ locale: lang ?? locale, namespace: "auth" });
  return (
    <p className="mt-6">
      <SignInHereLink locale={locale} label={t("signIn")} lang={lang && lang !== locale ? lang : undefined} />
    </p>
  );
}
