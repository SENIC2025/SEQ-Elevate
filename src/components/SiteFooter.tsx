import { Link } from "@/i18n/navigation";
import type { Locale } from "@/lib/cms/types";
import { LEGAL_DOCS, type LegalDocId } from "@/data/legal";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import { LifeBuoy } from "lucide-react";

/**
 * Global footer (acceptance item O7): the "Need help?" link to every
 * country's safeguarding contacts (D93, spec 11.3), first and in the same
 * place on every page (WCAG 3.2.6), then the legal links. Server component
 * that reads no database: it renders on prerendered pages too. The legal
 * links are those of the documents that have a text (LEGAL_DOCS: the legal
 * notice once its English text is in), labelled inline so a German or Greek
 * page never shows English navigation, the links' landmark name included.
 *
 * Each link is at least 24 px tall (WCAG 2.5.8 target size): on a phone,
 * in German, the links wrap onto several rows, and 16 px rows 4 px apart
 * failed axe on the player page at 320 px (spec 5.12).
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
  // Greek to be confirmed by the partners (spec 12.3).
  notice: { en: "Legal notice", de: "Impressum", el: "Νομική σημείωση" },
};
const ORDER: LegalDocId[] = ["privacy", "terms", "cookies", "accessibility", "notice"];
const NAV_LABEL: Record<Locale, string> = {
  en: "Legal and policies",
  de: "Rechtliches und Richtlinien",
  el: "Νομικά και πολιτικές",
};
/** safeguarding.footerLink, in each language. */
const HELP: Record<Locale, string> = {
  en: en.safeguarding.footerLink,
  de: de.safeguarding.footerLink,
  el: el.safeguarding.footerLink,
};

const LINK = "inline-flex min-h-6 items-center text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]";

export function SiteFooter({ locale }: { locale: string }) {
  const loc = (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;
  return (
    <footer className="mt-auto border-t border-[var(--border)] bg-[var(--surface-muted)]">
      <div className="mx-auto max-w-6xl px-4 py-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <Link
            href="/help"
            className="inline-flex min-h-6 items-center gap-1.5 text-xs font-medium text-[var(--foreground)] underline-offset-2 hover:underline"
          >
            <LifeBuoy className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden="true" />
            {HELP[loc]}
          </Link>
          <nav aria-label={NAV_LABEL[loc]} className="flex flex-wrap gap-x-4 gap-y-1">
            {ORDER.filter((doc) => LEGAL_DOCS.includes(doc)).map((doc) => (
              <Link key={doc} href={`/legal/${doc}`} className={LINK}>
                {LABELS[doc][loc]}
              </Link>
            ))}
          </nav>
        </div>
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
