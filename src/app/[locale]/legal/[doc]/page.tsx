import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  getLegal,
  hasLegalTranslation,
  LEGAL_DOCS,
  type LegalDocId,
} from "@/data/legal";
import type { Locale } from "@/lib/cms/types";
import { ChevronLeft, Info } from "lucide-react";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    LEGAL_DOCS.map((doc) => ({ locale, doc }))
  );
}

function toLocale(l: string): Locale {
  return (["en", "de", "el"].includes(l) ? l : "en") as Locale;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; doc: string }>;
}): Promise<Metadata> {
  const { locale, doc } = await params;
  const content = getLegal(doc as LegalDocId, toLocale(locale));
  return { title: content?.title ?? "Legal" };
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; doc: string }>;
}) {
  const { locale, doc } = await params;
  setRequestLocale(locale);
  const loc = toLocale(locale);
  if (!LEGAL_DOCS.includes(doc as LegalDocId)) notFound();
  const content = getLegal(doc as LegalDocId, loc);
  if (!content) notFound();

  const translationPending = loc !== "en" && !hasLegalTranslation(doc as LegalDocId, loc);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        SEQ Elevate
      </Link>

      <h1 className="text-3xl font-bold tracking-tight">{content.title}</h1>
      {content.intro ? (
        <p className="mt-3 text-[var(--muted-foreground)] leading-relaxed">
          {content.intro}
        </p>
      ) : null}

      {translationPending ? (
        <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--muted-foreground)]">
          The official translation of this page is being finalised; the English
          version is shown in the meantime.
        </p>
      ) : null}

      <div className="mt-8 space-y-8">
        {content.sections.map((s, i) => (
          <section key={i}>
            <h2 className="text-lg font-semibold">{s.heading}</h2>
            {s.body?.map((p, j) => (
              <p
                key={j}
                className="mt-2 text-sm leading-relaxed text-[var(--foreground)]"
              >
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
                <Info className="h-4 w-4 flex-shrink-0 text-[var(--warning)]" />
                <span>
                  <strong>To be completed before launch — </strong>
                  {s.needs}
                </span>
              </p>
            ) : null}
          </section>
        ))}
      </div>

      <p className="mt-10 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted-foreground)]">
        SEQ Elevate · Created and powered by SENIC
      </p>
    </div>
  );
}
