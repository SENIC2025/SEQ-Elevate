import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

/**
 * A web or email address in lesson text, as a link (quick links, see
 * src/lib/rich-text/linkify.ts). It opens in a new tab so the lesson stays
 * where the learner left it, without giving the other page a handle on
 * this one (noopener) or telling it where the learner came from
 * (noreferrer). Screen readers hear "(opens in a new tab)" in the
 * interface language; the look comes from .seq-link in globals.css.
 *
 * `href` is only ever one linkify built: https, http or mailto.
 *
 * Its own component, so the renderer around it stays free of hooks and
 * only text that has an address needs the interface messages.
 */
export function QuickLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const t = useTranslations("lessonLinks");
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="seq-link"
    >
      {children}
      <span className="sr-only"> {t("newTab")}</span>
    </a>
  );
}
