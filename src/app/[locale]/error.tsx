"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("system");

  useEffect(() => {
    // In production this is where Sentry.captureException(error) goes
    // (wired via SENTRY_DSN). Logged for now.
    console.error(error);
  }, [error]);

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--warning)]/10 text-[var(--warning)]">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">
        {t("errorTitle")}
      </h1>
      <p className="mt-2 max-w-sm text-[var(--muted-foreground)]">
        {t("errorBody")}
      </p>
      <Button className="mt-6" onClick={reset}>
        <RotateCcw className="h-4 w-4" />
        {t("tryAgain")}
      </Button>
    </main>
  );
}
