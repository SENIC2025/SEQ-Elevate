"use client";

import * as React from "react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteMyAccount } from "@/app/actions/gdpr";
import {
  UserRound,
  Download,
  ShieldAlert,
  Accessibility,
  BookOpen,
  Award,
  FileText,
  Loader2,
} from "lucide-react";
import type { Role } from "@prisma/client";

const ROLE_KEY: Record<Role, string> = {
  LEARNER: "learner",
  FACILITATOR: "facilitator",
  ADMIN: "admin",
  CONTENT_EDITOR: "content",
};

export function AccountView({
  email,
  name,
  memberSince,
  roles,
  projectName,
  stats,
}: {
  email: string;
  name: string | null;
  memberSince: string;
  roles: Role[];
  projectName: string;
  stats: { courses: number; badges: number; compCardStarted: boolean };
}) {
  const t = useTranslations("account");
  const tRoles = useTranslations("roles");
  const locale = useLocale();

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canDelete = confirmText.trim().toLowerCase() === email.toLowerCase();

  const memberSinceLabel = new Date(memberSince).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  async function handleDelete() {
    if (!canDelete || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await deleteMyAccount(confirmText);
      if (!res.ok) {
        setError(t("deleteError"));
        setDeleting(false);
        return;
      }
      // Account + session cookie are gone (cleared by the action). Full-reload
      // to the localised home page, now as a guest.
      window.location.href = `/${locale}`;
    } catch {
      setError(t("deleteError"));
      setDeleting(false);
    }
  }

  const uniqueRoles = Array.from(new Set(roles));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {t("subtitle")}
        </p>
      </div>

      {/* Profile */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">
              <UserRound className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              {name ? <p className="font-semibold">{name}</p> : null}
              <p className="text-sm text-[var(--foreground)] break-all">
                {email}
              </p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                {projectName} · {t("memberSince", { date: memberSinceLabel })}
              </p>
              {uniqueRoles.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {uniqueRoles.map((r) => (
                    <Badge key={r} variant="muted" className="text-[11px]">
                      {tRoles(ROLE_KEY[r])}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3 text-center">
            <Stat icon={BookOpen} value={stats.courses} label={t("statCourses")} />
            <Stat icon={Award} value={stats.badges} label={t("statBadges")} />
            <Stat
              icon={FileText}
              value={stats.compCardStarted ? "✓" : "—"}
              label={t("statCompCard")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Reading help note */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <Accessibility className="h-4 w-4 text-[var(--accent)]" />
            <h2 className="text-sm font-semibold">{t("a11yTitle")}</h2>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t("a11yBody")}
          </p>
        </CardContent>
      </Card>

      {/* Your data (GDPR export) */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <Download className="h-4 w-4 text-[var(--accent)]" />
            <h2 className="text-sm font-semibold">{t("dataTitle")}</h2>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t("dataBody")}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              // A real navigation to the download endpoint — the
              // Content-Disposition header turns it into a file download
              // without leaving the page.
              window.location.href = "/api/me/export";
            }}
          >
            <Download className="h-4 w-4" />
            {t("download")}
          </Button>
        </CardContent>
      </Card>

      {/* Danger zone (GDPR erasure) */}
      <Card className="border-[var(--danger)]/40">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert className="h-4 w-4 text-[var(--danger)]" />
            <h2 className="text-sm font-semibold">{t("dangerTitle")}</h2>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t("dangerBody")}
          </p>

          {!confirmOpen ? (
            <Button
              variant="danger"
              size="sm"
              className="mt-3"
              onClick={() => setConfirmOpen(true)}
            >
              {t("deleteButton")}
            </Button>
          ) : (
            <div className="mt-4 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-4">
              <p className="text-sm font-medium">{t("confirmTitle")}</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {t("confirmBody")}
              </p>
              <label className="mt-3 block text-xs font-medium text-[var(--muted-foreground)]">
                {t("confirmLabel")}
              </label>
              <input
                type="email"
                autoComplete="off"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={email}
                aria-label={t("confirmLabel")}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
              {error ? (
                <p className="mt-2 text-sm text-[var(--danger)]" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!canDelete || deleting}
                  onClick={handleDelete}
                >
                  {deleting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("deleting")}
                    </>
                  ) : (
                    t("confirmCta")
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleting}
                  onClick={() => {
                    setConfirmOpen(false);
                    setConfirmText("");
                    setError(null);
                  }}
                >
                  {t("cancel")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof BookOpen;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
      <Icon className="mx-auto h-4 w-4 text-[var(--muted-foreground)]" />
      <p className="mt-1 text-lg font-bold leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{label}</p>
    </div>
  );
}
