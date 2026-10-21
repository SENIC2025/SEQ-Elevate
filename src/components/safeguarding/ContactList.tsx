import { useLocale, useTranslations } from "next-intl";
import { telHref, textIn, type SafeguardingContact } from "@/lib/safeguarding";
import { Globe, Mail, Phone } from "lucide-react";

/**
 * One country's safeguarding contacts (D93, spec 11.3), as the box beside a
 * learner's pages and /help list them: the organisation's contact first
 * (its name and role), then help lines ("Help line: …"), each with the ways
 * to reach it as links: a phone number to call, an address to write to, a
 * web address. Hours and notes in the page's language, else in English,
 * marked as such (WCAG 3.1.2). Plain text throughout.
 *
 * No hooks but translations and the locale, so it renders in the server
 * components that use it.
 */
export function ContactList({ contacts }: { contacts: readonly SafeguardingContact[] }) {
  const t = useTranslations("safeguarding");
  const locale = useLocale();
  const link = "inline-flex min-h-6 items-center gap-1.5 underline underline-offset-2 hover:text-[var(--accent)] break-all";
  return (
    <ul className="mt-2 space-y-3">
      {contacts.map((c, i) => {
        const hours = textIn(c.hours, locale);
        const note = textIn(c.note, locale);
        return (
          <li key={i} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <p className="font-medium">
              {c.kind === "helpline" ? `${t("helpline")} ` : null}
              {c.organisation}
              {c.role ? <span className="font-normal text-[var(--muted-foreground)]"> · {c.role}</span> : null}
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {c.phone ? (
                <li>
                  <a href={telHref(c.phone)} className={link}>
                    <Phone className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                    {c.phone}
                  </a>
                </li>
              ) : null}
              {c.email ? (
                <li>
                  <a href={`mailto:${c.email}`} className={link}>
                    <Mail className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                    {c.email}
                  </a>
                </li>
              ) : null}
              {c.url ? (
                <li>
                  <a href={c.url} className={link} rel="noopener noreferrer">
                    <Globe className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                    {shownUrl(c.url)}
                  </a>
                </li>
              ) : null}
            </ul>
            {hours ? (
              <p lang={hours.lang !== locale ? hours.lang : undefined} className="mt-1 text-[var(--muted-foreground)]">
                {hours.text}
              </p>
            ) : null}
            {note ? (
              <p lang={note.lang !== locale ? note.lang : undefined} className="mt-1 text-[var(--muted-foreground)]">
                {note.text}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** A web address as read aloud and shown: without "https://" and a lone trailing slash. */
function shownUrl(url: string): string {
  return url.replace(/^https:\/\//, "").replace(/\/$/, "");
}
