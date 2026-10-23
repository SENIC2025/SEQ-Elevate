"use client";

import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BookOpen } from "lucide-react";
import { QuickLink } from "@/components/rich-text/QuickLink";
import { itemLanguageMark, linkPlace } from "@/lib/cms/lesson-links";
import type { LessonLinkRef } from "@/lib/cms/reading-types";
import type { Locale } from "@/lib/cms/types";
import { linkSite, linkWords, textIsSite } from "@/lib/rich-text/link-site";
import { useContentLang } from "./CourseText";

/**
 * A lesson's further reading (Release 4, D107; spec 4.5): drawn after the
 * lesson's own content, so learners meet the lesson before its links out,
 * and the heading order stays the lesson's h2, then "Further reading" (h3).
 * The section is named by that heading (aria-labelledby), so its name is
 * the heading's own words. Nothing at all for a lesson without links.
 *
 * Each item: its title as a link (QuickLink: a new tab, and screen readers
 * hear that it opens one), an email link's bare address under it, then its
 * description. The loaders only ever pass addresses checkLinkHref accepted
 * (lesson-links.ts), so `url` is an accepted, normalised address here.
 *
 * Learners see the site each named link opens (the owner's decision of 22
 * October 2026; D104, D105): a web link's title is followed, inside the
 * link, by a ", " only screen readers hear and the site in a box
 * (link-site.ts; the look is globals.css's, as in lesson text), so the link
 * is heard as "title, site (opens in a new tab)". The box is left out only
 * when the whole title is the link's address (textIsSite). The title is
 * drawn with each run of blank characters as one space (linkWords), so no
 * blank pushes the box away from its words. The site is the
 * one D104 compares (the registrable domain, in punycode for an
 * international name), never a host that begins with another site's name,
 * and the box is the one place a web link's site is shown.
 *
 * Course text and the page's words (WCAG 3.1.2): an item for some languages
 * only, none of them the one the course text is shown in, carries that
 * language and a small label ("In German"), in the page's language; any
 * other item reads in the course text's language (Release 3's
 * ContentLangContext). The link's hidden "(opens in a new tab)" stays in
 * the page's language. No learner sees an http warning (Q13).
 */
export function LessonFurtherReading({ links }: { links?: readonly LessonLinkRef[] }) {
  const t = useTranslations("furtherReading");
  const page = useLocale() as Locale;
  const courseLang = useContentLang();
  const headingId = useId();
  if (!links?.length) return null;
  const text = courseLang ?? page;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h3 id={headingId} className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <BookOpen className="h-4 w-4 text-[var(--accent)]" aria-hidden />
        {t("title")}
      </h3>
      <ul className="space-y-3">
        {links.map((link) => {
          const mark = itemLanguageMark(link.languages, text, page);
          const lang = mark ?? courseLang;
          const site = link.kind === "web" ? linkSite(link.url) : null;
          // An email link's bare address; a web link's site is in its box.
          const place = site === null ? linkPlace(link) : "";
          return (
            <li key={link.id} className="text-sm">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <QuickLink href={link.url}>
                  <span lang={lang} className="font-medium">
                    {linkWords([link.title])[0]}
                  </span>
                  {site !== null && !textIsSite(link.title, link.url) ? (
                    <>
                      <span className="seq-link-sep">, </span>
                      <span className="seq-link-site">{site}</span>
                    </>
                  ) : null}
                </QuickLink>
                {mark ? (
                  <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)]">
                    {t(`language.${mark}`)}
                  </span>
                ) : null}
              </p>
              {place ? (
                <p className="break-all text-xs text-[var(--muted-foreground)]">{place}</p>
              ) : null}
              {link.description ? (
                <p lang={lang} className="mt-0.5 text-[var(--muted-foreground)]">
                  {link.description}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
