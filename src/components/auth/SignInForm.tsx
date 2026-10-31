"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { signInWithEmail, type SignInFormError } from "@/app/actions/auth";
import { BrandLogo } from "@/components/BrandLogo";
import { Mail, ArrowRight, Loader2, AlertTriangle } from "lucide-react";

/** What the form says when no link was sent (D116). */
const ERROR_KEY: Record<SignInFormError, "invalidEmail" | "tooManyRequests"> = {
  "invalid-email": "invalidEmail",
  "rate-limited": "tooManyRequests",
};

export function SignInForm({
  callbackUrl,
  demoEnabled = false,
  initialError = null,
}: {
  callbackUrl: string;
  /** Set when Auth.js sent the visitor here over a sign-in email limit (D116). */
  initialError?: SignInFormError | null;
  /** Server-derived: show the demo/client-access link only where demo
   * sign-in is allowed (demoLoginAllowed, D98). Elsewhere, production
   * always, it would be a dead end. */
  demoEnabled?: boolean;
}) {
  const t = useTranslations("auth");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SignInFormError | null>(initialError);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--background)] px-4">
      <Link href="/" className="mb-8">
        <BrandLogo variant="lockup" width={200} />
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
              setError(null);
              const result = await signInWithEmail(formData);
              // A link was asked for: the page moves on. Otherwise, say why not.
              if (result?.error) {
                setError(result.error);
                setPending(false);
              }
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
                  aria-invalid={error === "invalid-email" ? true : undefined}
                  aria-describedby={error ? "signin-error" : undefined}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                />
              </div>
            </div>
            {error ? (
              <p
                id="signin-error"
                role="alert"
                className="text-sm text-[var(--danger)] flex items-start gap-1.5"
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                {t(ERROR_KEY[error])}
              </p>
            ) : null}
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
        {demoEnabled ? (
          <Link
            href="/demo"
            className="text-sm font-medium text-[var(--accent)] hover:underline"
          >
            Test sign-in →
          </Link>
        ) : null}
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
