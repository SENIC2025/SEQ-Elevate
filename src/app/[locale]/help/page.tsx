import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader } from "@/components/AppHeader";
import { ContactList } from "@/components/safeguarding/ContactList";
import { getViewer } from "@/lib/scope";
import { loadSafeguarding } from "@/lib/safeguarding.server";
import { helpGroups } from "@/lib/safeguarding";
import { isCountry } from "@/lib/countries";
import { EmergencyLine } from "@/components/safeguarding/EmergencyLine";
import { LifeBuoy, PhoneCall } from "lucide-react";

// Reads the contacts an admin saved, and who is asking: never prerendered.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "safeguarding" });
  return { title: t("helpTitle") };
}

/**
 * /help (D93, spec 11.3): every country's safeguarding contacts, and 112,
 * for anyone: not signed in, not past the profile step, any role. The
 * footer links it from every page. The viewer's own country comes first;
 * a country with no contacts saved yet says whom to talk to instead.
 */
export default async function HelpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("safeguarding");
  const [viewer, setting] = await Promise.all([getViewer(), loadSafeguarding()]);
  const own = isCountry(viewer.profile?.country) ? viewer.profile.country : null;
  const groups = helpGroups(setting, own);

  return (
    <div className="flex-1 flex flex-col">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="flex items-center gap-2 text-2xl sm:text-3xl font-bold tracking-tight">
            <LifeBuoy className="h-7 w-7 flex-shrink-0 text-[var(--accent)]" aria-hidden="true" />
            {t("helpTitle")}
          </h1>
          <p className="mt-6 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-base font-semibold">
            <PhoneCall className="h-5 w-5 flex-shrink-0 text-[var(--accent)]" aria-hidden="true" />
            <span>
              <EmergencyLine />
            </span>
          </p>
          <div className="mt-8 space-y-8 text-sm">
            {groups.map((g) => (
              <section key={g.country} aria-labelledby={`help-${g.country}`}>
                <h2 id={`help-${g.country}`} className="text-lg font-semibold">
                  {t("contactFor", { country: g.country })}
                </h2>
                {g.contacts.length ? (
                  <ContactList contacts={g.contacts} />
                ) : (
                  <p className="mt-2 text-[var(--muted-foreground)]">{t("fallback")}</p>
                )}
              </section>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
