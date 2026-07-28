import { Link } from "@/i18n/navigation";
import type { Locale } from "@/lib/cms/types";
import type { LegalDocId } from "@/data/legal";

/**
 * Global footer with the legal links (acceptance item O7). Server component;
 * link labels are localised inline so a DE/EL page doesn't show English nav
 * even while the legal bodies await their official translation.
 */

const LABELS: Record<LegalDocId, Record<Locale, string>> = {
  privacy: { en: "Privacy", de: "Datenschutz", el: "Απόρρητο" },
  terms: { en: "Terms", de: "Nutzungsbedingungen", el: "Όροι χρήσης" },
  cookies: { en: "Cookies", de: "Cookies", el: "Cookies" },
  accessibility: {
    en: "Accessibility",
    de: "Barrierefreiheit",
    el: "Προσβασιμότητα",
  },
};
const ORDER: LegalDocId[] = ["privacy", "terms", "cookies", "accessibility"];

export function SiteFooter({ locale }: { locale: string }) {
  const loc = (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;
  return (
    <footer className="mt-auto border-t border-[var(--border)] bg-[var(--surface-muted)]">
      <div className="mx-auto max-w-6xl px-4 py-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav
          aria-label="Legal and policies"
          className="flex flex-wrap gap-x-4 gap-y-1"
        >
          {ORDER.map((doc) => (
            <Link
              key={doc}
              href={`/legal/${doc}`}
              className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              {LABELS[doc][loc]}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-[var(--muted-foreground)]">
          SEQ Elevate · Created and powered by{" "}
          <a
            href="https://senic.world"
            className="underline hover:text-[var(--foreground)]"
            rel="noopener noreferrer"
          >
            SENIC
          </a>
        </p>
      </div>
    </footer>
  );
}
