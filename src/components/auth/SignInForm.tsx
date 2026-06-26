"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { signInWithEmail } from "@/app/actions/auth";
import { Sparkles, Mail, ArrowRight, Loader2 } from "lucide-react";

export function SignInForm({ callbackUrl }: { callbackUrl: string }) {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const [pending, setPending] = useState(false);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--background)] px-4">
      <Link
        href="/"
        className="flex items-center gap-2 font-semibold tracking-tight mb-8"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--primary)] text-[var(--primary-foreground)]">
          <Sparkles className="h-4 w-4" />
        </span>
        <span>{tCommon("appName")}</span>
      </Link>

      <Card className="w-full max-w-sm">
        <CardContent className="p-6 sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight">{t("signInTitle")}</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {t("signInSubtitle")}
          </p>

          <form
            action={async (formData) => {
              setPending(true);
              await signInWithEmail(formData);
            }}
            className="mt-6 space-y-3"
          >
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1.5">
                {t("emailLabel")}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder={t("emailPlaceholder")}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                />
              </div>
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("sending")}
                </>
              ) : (
                <>
                  {t("sendLink")}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <p className="mt-5 text-xs text-[var(--muted-foreground)] leading-relaxed">
            {t("magicLinkNote")}
          </p>
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-col items-center gap-2">
        <Link
          href="/demo"
          className="text-sm font-medium text-[var(--accent)] hover:underline"
        >
          Demo / client access →
        </Link>
        <Link
          href="/"
          className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          {t("backToHome")}
        </Link>
      </div>
    </div>
  );
}
