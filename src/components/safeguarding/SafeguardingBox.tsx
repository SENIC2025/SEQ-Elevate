import { useId } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LifeBuoy } from "lucide-react";

/**
 * Who to talk to when something is wrong (D93, spec 11.3): placed after
 * `</main>` on the learner and account pages and on /welcome, so a page's
 * main content (and Release 2's recorded walk, which reads <main>) is
 * unchanged. Never empty: 112 lives here in code, never in a setting.
 *
 * The Foundation's stub: 112, the fallback line and a link to every
 * country's contacts on /help. Stream F adds the contacts an ADMIN saves
 * (Project.safeguarding), the learner's own country first. Until /help is
 * in this tree the link isn't prefetched: the not-found answer to a
 * prefetch never completes, and the page never settles.
 */
export function SafeguardingBox() {
  const t = useTranslations("safeguarding");
  const headingId = useId();
  return (
    <aside
      aria-labelledby={headingId}
      className="mx-auto w-full max-w-6xl px-4 py-6"
    >
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm">
        <h2 id={headingId} className="flex items-center gap-2 font-semibold">
          <LifeBuoy className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
          {t("title")}
        </h2>
        <p className="mt-2">{t("emergency")}</p>
        <p className="mt-1 text-[var(--muted-foreground)]">{t("fallback")}</p>
        <p className="mt-2">
          <Link href="/help" prefetch={false} className="inline-flex min-h-6 items-center underline">
            {t("allContacts")}
          </Link>
        </p>
      </div>
    </aside>
  );
}
