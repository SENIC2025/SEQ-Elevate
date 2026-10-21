import { useId } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { CountryContacts } from "@/lib/safeguarding";
import { ContactList } from "./ContactList";
import { LifeBuoy } from "lucide-react";

/**
 * What the safeguarding box shows (SafeguardingBox reads it): 112, always;
 * then the contacts of the learner's own country (every country's for a
 * guest or a profile without a country), the organisation's contact before
 * help lines; or, with none saved for them, the fallback line; and a link
 * to every country's contacts on /help. Never empty.
 */
export function SafeguardingBoxView({ groups }: { groups: readonly CountryContacts[] }) {
  const t = useTranslations("safeguarding");
  const headingId = useId();
  return (
    <aside aria-labelledby={headingId} className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm">
        <h2 id={headingId} className="flex items-center gap-2 font-semibold">
          <LifeBuoy className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
          {t("title")}
        </h2>
        <p className="mt-2 font-medium">{t("emergency")}</p>
        {groups.length ? (
          groups.map((g) => (
            <section key={g.country} className="mt-3">
              <h3 className="text-sm font-medium">{t("contactFor", { country: g.country })}</h3>
              <ContactList contacts={g.contacts} />
            </section>
          ))
        ) : (
          <p className="mt-1 text-[var(--muted-foreground)]">{t("fallback")}</p>
        )}
        <p className="mt-3">
          <Link href="/help" className="inline-flex min-h-6 items-center underline underline-offset-2">
            {t("allContacts")}
          </Link>
        </p>
      </div>
    </aside>
  );
}
