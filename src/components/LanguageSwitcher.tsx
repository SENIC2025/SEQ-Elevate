"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { useTransition } from "react";
import { Globe } from "lucide-react";
import { mayNavigate } from "@/lib/before-navigate";

const LABELS: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  el: "Ελληνικά",
};

/**
 * The page's language. Below md the pill shows only the short code ("EN")
 * so the signed-in header fits from a 360px phone up; the real select lies
 * invisibly over the whole pill, so a tap still opens the full list and
 * screen readers still hear "Language, English" — in the page's language.
 *
 * Switching keeps the query string: it carries an editor's sandboxed preview
 * (?preview=1) and the course page's lesson and content language. A page
 * with unsaved work may ask first (mayNavigate); if the person says no, the
 * select — controlled by `locale` — simply stays where it was.
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations("common");
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <label className="relative flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm focus-within:ring-2 focus-within:ring-[var(--ring)]">
      <Globe className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{t("language")}</span>
      <span aria-hidden="true" className="font-medium uppercase md:hidden">
        {locale}
      </span>
      <select
        value={locale}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.value;
          if (!mayNavigate("ui-language")) return;
          // Read here, not with useSearchParams: the header then needs no
          // Suspense boundary. Dropping ?preview=1 would turn an editor's
          // preview into a real, recorded session.
          const search = window.location.search;
          startTransition(() => {
            router.replace(pathname + search, { locale: next });
          });
        }}
        className="bg-transparent text-sm focus:outline-none cursor-pointer max-md:absolute max-md:inset-0 max-md:h-full max-md:w-full max-md:opacity-0"
      >
        {routing.locales.map((l) => (
          <option key={l} value={l}>
            {LABELS[l] ?? l}
          </option>
        ))}
      </select>
    </label>
  );
}
