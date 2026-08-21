"use client";

/**
 * The production front door. Shown at `/` when the launch switch
 * (DEMO_LOGIN_DISABLED=true) is on — see [locale]/page.tsx. Unlike the demo
 * LandingPage (role-picker into client-side demo state), this is a real
 * welcome whose single call-to-action is magic-link sign-in.
 *
 * Uses only existing, already-trilingual strings (landing.*, auth.*, common.*),
 * so it needs no new translations. The SENIC credit + legal links come from the
 * global SiteFooter in the locale layout.
 */

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AccessibilityToolbar } from "@/components/a11y/AccessibilityToolbar";
import { Sparkles, LogIn, ArrowRight } from "lucide-react";

export function ProductionLanding() {
  const t = useTranslations("landing");
  const tCommon = useTranslations("common");
  const tAuth = useTranslations("auth");

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--primary)] text-[var(--primary-foreground)]">
              <Sparkles className="h-4 w-4" />
            </span>
            <span>{tCommon("appName")}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/signin"
              className="flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              <LogIn className="h-4 w-4" />
              <span>{tAuth("signIn")}</span>
            </Link>
            <LanguageSwitcher />
            <AccessibilityToolbar />
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <div className="max-w-2xl">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
              {t("title")}
            </h1>
            <p className="mt-5 text-lg text-[var(--muted-foreground)] leading-relaxed">
              {t("subtitle")}
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/signin"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-base font-semibold text-white hover:bg-[var(--accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                {tAuth("signIn")} <ArrowRight className="h-5 w-5" />
              </Link>
              <p className="text-sm text-[var(--muted-foreground)]">
                {tAuth("signInSubtitle")}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
