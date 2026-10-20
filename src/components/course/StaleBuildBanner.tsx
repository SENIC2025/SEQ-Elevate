"use client";

import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStaleBuild } from "@/store/demo-state";

/**
 * A save was answered "unknown action": this page comes from a build the
 * server no longer has (a deploy happened while it was open, D68). What the
 * learner did since the server last confirmed is kept in this tab's outbox
 * (src/store/outbox.ts) and saved after a reload, so the banner asks for
 * one — an alert, since every answer from now on waits for it.
 */
export function StaleBuildBanner() {
  const t = useTranslations("coursePlayer");
  const stale = useStaleBuild();
  if (!stale) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-[var(--warning)] bg-[var(--warning)]/10 px-3 py-2 text-sm text-[var(--foreground)]"
    >
      <p className="min-w-0 flex-1 basis-60">{t("staleBuild")}</p>
      <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
        <RefreshCw aria-hidden className="h-4 w-4" />
        {t("reload")}
      </Button>
    </div>
  );
}
