import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { requireAdminProject } from "@/lib/scope";
import { readSafeguarding } from "@/lib/safeguarding.server";
import { SafeguardingEditor } from "@/components/safeguarding/SafeguardingEditor";
import { AccessNotice } from "@/components/AccessNotice";
import { Link } from "@/i18n/navigation";
import { ChevronLeft } from "lucide-react";

// Reads the contacts for an ADMIN — never prerender.
export const dynamic = "force-dynamic";

// The page's own name in the tab and to assistive technology; English, like the page.
export const metadata: Metadata = { title: "Safeguarding contacts" };

/**
 * Release 3 (D93, spec 11.2): the safeguarding contacts learners see beside
 * their pages and on /help, per country. An ADMIN with project scope only
 * (DIESIS or SENIC); English, like the other staff screens, and marked as
 * English under /de and /el. New contacts need no deploy: an admin enters
 * them here.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await requireAdminProject();
  // English on every locale's address, and marked so (WCAG 3.1.2).
  if (!admin) {
    return (
      <div lang="en">
        <AccessNotice title="Admins only">
          Sign in with an admin account to edit the safeguarding contacts.
        </AccessNotice>
      </div>
    );
  }
  const setting = await readSafeguarding();
  return (
    <div lang="en" className="mx-auto max-w-4xl px-4 py-8">
      <Link
        href="/admin"
        className="inline-flex min-h-6 items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-3"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Admin
      </Link>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Safeguarding contacts</h1>
      <div className="mt-1 mb-6 space-y-2 text-sm text-[var(--muted-foreground)]">
        <p>
          Who learners in each country can contact for help: the partner organisation&apos;s contact and help lines, up
          to three per country. Learners see their own country&apos;s beside their pages, and every country&apos;s on the{" "}
          <Link href="/help" className="underline underline-offset-2">
            help page
          </Link>
          . 112 always shows, whatever is entered here.
        </p>
        <p>
          Use a team or role mailbox and a service number, not a person&apos;s own details, where you can. Each save is
          logged with the countries it changed, never the contacts.
        </p>
      </div>
      {setting ? (
        <SafeguardingEditor initial={setting} />
      ) : (
        <p role="alert" className="rounded-lg border border-[var(--danger)] px-4 py-3 text-sm">
          The contacts couldn&apos;t be read just now, so they can&apos;t be edited. Reload the page.
        </p>
      )}
    </div>
  );
}
