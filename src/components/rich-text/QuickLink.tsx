import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";

/**
 * A link in lesson text: an address typed in the text (a quick link, see
 * src/lib/rich-text/linkify.ts) or words an author linked (a named link,
 * D104). Every link opens in a new tab (D105), an email link too: a browser
 * may hand mailto: to a web mail service, and the lesson stays where the
 * learner left it. It gives the other page no handle on this one
 * (noopener) and doesn't tell it where the learner came from (noreferrer).
 *
 * Screen readers hear what the link opens after its words: "(opens in a
 * new tab)" for a web link, "(opens your email program)" for an email link
 * (its kind read from `href`). Those are the interface's words inside
 * course text, which can be in another language (a German learner on a
 * course still shown in English), so they carry the interface's lang. The
 * look comes from .seq-link in globals.css.
 *
 * `href` is only ever one checkLinkHref accepted: https, http or mailto.
 *
 * Its own component, so the renderer around it stays free of hooks and
 * only text that has a link needs the interface messages.
 */
export function QuickLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const t = useTranslations("lessonLinks");
  const locale = useLocale();
  const opens = /^mailto:/i.test(href) ? t("email") : t("newTab");
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="seq-link"
    >
      {children}
      <span className="sr-only" lang={locale}> {opens}</span>
    </a>
  );
}
