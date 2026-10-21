import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getLegal, hasLegalTranslation, LEGAL_DOCS, type LegalDoc, type LegalDocId } from "@/data/legal";
import { LegalBody } from "@/components/legal/LegalBody";
import type { Locale } from "@/lib/cms/types";
import { ChevronLeft, Info } from "lucide-react";

/*
 * A legal page (D94, spec 12.3): prerendered for every language and every
 * document that has a text. The text is counsel's final one in the page's
 * language, else in English (marked lang="en", WCAG 3.1.2, under a note in
 * the page's language), else the text written before counsel's, whose
 * open points show as highlighted boxes until counsel's text replaces them.
 * The page's own words (back link, version line, notes) are in the page's
 * language. It is the skip link's target (<main id="main-content">).
 */

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => LEGAL_DOCS.map((doc) => ({ locale, doc })));
}

function toLocale(l: string): Locale {
  return (["en", "de", "el"].includes(l) ? l : "en") as Locale;
}

/** The document, if it is one with a text. */
function documentOf(doc: string, locale: Locale): LegalDoc | null {
  return LEGAL_DOCS.includes(doc as LegalDocId) ? getLegal(doc as LegalDocId, locale) : null;
}

/** "21 October 2026" in the page's language. */
function longDate(day: string, locale: Locale): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; doc: string }>;
}): Promise<Metadata> {
  const { locale, doc } = await params;
  return { title: documentOf(doc, toLocale(locale))?.title ?? "Legal" };
}

export default async function Page({ params }: { params: Promise<{ locale: string; doc: string }> }) {
  const { locale, doc } = await params;
  setRequestLocale(locale);
  const loc = toLocale(locale);
  const content = documentOf(doc, loc);
  if (!content) notFound();
  const t = await getTranslations("legal");

  const translationPending = loc !== "en" && !hasLegalTranslation(content.slug, loc);
  // The page's own words inside an article in another language say theirs.
  const chromeLang = content.lang !== loc ? loc : undefined;

  return (
    <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Link
          href="/"
          className="mb-4 inline-flex min-h-6 items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {t("backHome")}
        </Link>

        {translationPending ? (
          <p className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--muted-foreground)]">
            {t("translationPending")}
          </p>
        ) : null}

        <article lang={content.lang !== loc ? content.lang : undefined}>
          <h1 className="text-3xl font-bold tracking-tight">{content.title}</h1>
          <p lang={chromeLang} className="mt-2 text-xs text-[var(--muted-foreground)]">
            {t("version", { version: content.version, date: longDate(content.lastUpdated, loc) })}
          </p>
          {content.kind === "final" ? (
            <LegalBody source={content.body} label={content.title} />
          ) : (
            <LegacyBody content={content} needsLabel={t("toBeCompleted")} needsLang={chromeLang} />
          )}
        </article>

        <p className="mt-10 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted-foreground)]">
          {t("poweredBy")}
        </p>
      </div>
    </main>
  );
}

/**
 * A text written before counsel's: its sections, and a highlighted box for
 * each point the data controller must still decide. Deleted, with `needs`,
 * by the commit that adds the last English final text (spec 12.3).
 */
function LegacyBody({
  content,
  needsLabel,
  needsLang,
}: {
  content: Extract<LegalDoc, { kind: "legacy" }>;
  needsLabel: string;
  needsLang: string | undefined;
}) {
  return (
    <>
      {content.intro ? <p className="mt-3 leading-relaxed text-[var(--muted-foreground)]">{content.intro}</p> : null}
      <div className="mt-8 space-y-8">
        {content.sections.map((s, i) => (
          <section key={i}>
            <h2 className="text-lg font-semibold">{s.heading}</h2>
            {s.body?.map((p, j) => (
              <p key={j} className="mt-2 text-sm leading-relaxed text-[var(--foreground)]">
                {p}
              </p>
            ))}
            {s.list ? (
              <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-[var(--foreground)]">
                {s.list.map((li, k) => (
                  <li key={k}>{li}</li>
                ))}
              </ul>
            ) : null}
            {s.needs ? (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--foreground)]">
                <Info className="h-4 w-4 flex-shrink-0 text-[var(--warning)]" aria-hidden />
                <span>
                  <strong lang={needsLang}>{needsLabel} </strong>
                  {s.needs}
                </span>
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </>
  );
}
