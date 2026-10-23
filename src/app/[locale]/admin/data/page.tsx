import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { brusselsDay, getDataTools } from "@/lib/account-data";
import { statsFrom } from "@/lib/stats-from";
import { DataTools } from "@/components/role/DataTools";
import { AccessNotice } from "@/components/AccessNotice";
import { Link } from "@/i18n/navigation";
import { ChevronLeft } from "lucide-react";

// Reads people and the log for the viewer — never prerender.
export const dynamic = "force-dynamic";

// The page's own name in the tab and to assistive technology ("Data · SEQ
// Elevate"); English, like the page.
export const metadata: Metadata = { title: "Data" };

/**
 * Release 3 (spec 8, 13.4, 14; D88): data requests, test accounts and the
 * go-live clean-up. ADMIN with project scope only (getDataTools reads
 * nothing for anyone else); English, like the other staff screens, and
 * marked as English under /de and /el (WCAG 3.1.2).
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tools = await getDataTools();
  if (!tools) {
    return (
      <AccessNotice lang="en" title="Admins only">
        Sign in with an admin account to handle data requests and test accounts.
      </AccessNotice>
    );
  }
  const from = statsFrom();
  return (
    <div lang="en" className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-3"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Admin
      </Link>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Data</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--muted-foreground)]">
        Data requests, test accounts and the clean-up. Every export, reset, erasure and run is recorded in
        the log below. Use a request reference from the register (REQ-YYYY-NNN); never write a name or an
        address in it.
      </p>
      <DataTools
        review={tools.review}
        log={tools.log}
        statsFrom={from ? brusselsDay(from) : null}
      />
    </div>
  );
}
