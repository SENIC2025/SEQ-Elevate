"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import {
  Users,
  Building2,
  GraduationCap,
  ShieldCheck,
  ScrollText,
  Download,
  Trash2,
  ToggleLeft,
  ChevronRight,
} from "lucide-react";

export interface AdminCounts {
  users: number;
  cohorts: number;
  organisations: number;
  courses: number;
}

export function AdminDashboard({
  counts,
  canManage = false,
}: {
  counts?: AdminCounts;
  /** Only true admins get the management entry points. */
  canManage?: boolean;
}) {
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t("anonymisedNote")}
        </p>
      </div>

      <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          icon={<Users className="h-5 w-5" />}
          label={t("users")}
          value={String(counts?.users ?? 0)}
        />
        <Stat
          icon={<GraduationCap className="h-5 w-5" />}
          label={t("cohorts")}
          value={String(counts?.cohorts ?? 0)}
        />
        <Stat
          icon={<Building2 className="h-5 w-5" />}
          label={t("organisations")}
          value={String(counts?.organisations ?? 0)}
        />
        <Stat
          icon={<ShieldCheck className="h-5 w-5" />}
          label="GDPR"
          value="OK"
          subtle="EU residency · DPIA on file"
        />
      </div>

      {/* Management entry points — admins only */}
      {canManage ? (
        <div className="mt-6 grid sm:grid-cols-2 gap-4">
          <ManageLink
            href="/admin/cohorts"
            icon={<Building2 className="h-5 w-5" />}
            title="Organisations & cohorts"
            desc="Add partner organisations and the cohorts learners belong to."
          />
          <ManageLink
            href="/admin/people"
            icon={<Users className="h-5 w-5" />}
            title="People & roles"
            desc="Invite people, set what they can do, assign them to a cohort."
          />
        </div>
      ) : null}

      <div className="mt-8 grid lg:grid-cols-2 gap-6">
        {/* GDPR self-service */}
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[var(--accent)]" />
              {t("gdpr")}
            </h2>
            <p className="text-sm text-[var(--muted-foreground)] mt-1 mb-4">
              Learners and admins can self-serve common GDPR requests.
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
                <Download className="h-4 w-4 text-[var(--muted-foreground)]" />
                <span>Export learner data (JSON + CSV)</span>
                <Badge variant="muted" className="ml-auto">
                  Available
                </Badge>
              </li>
              <li className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
                <Trash2 className="h-4 w-4 text-[var(--muted-foreground)]" />
                <span>Delete account & wipe Comp Cards</span>
                <Badge variant="muted" className="ml-auto">
                  Available
                </Badge>
              </li>
              <li className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
                <ToggleLeft className="h-4 w-4 text-[var(--muted-foreground)]" />
                <span>Withdraw consent</span>
                <Badge variant="muted" className="ml-auto">
                  Available
                </Badge>
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Audit log */}
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-[var(--accent)]" />
              {t("auditLog")}
            </h2>
            <p className="text-sm text-[var(--muted-foreground)] mt-1 mb-4">
              Last 24 hours · anonymised
            </p>
            <ul className="space-y-2 text-xs">
              {[
                ["12:14", "Facilitator validated competence", "Berlin Pilot"],
                ["11:38", "New learner joined cohort", "Athens Pilot"],
                ["10:22", "Comp Card exported as PDF", "—"],
                ["09:51", "Admin updated cohort name", "Munich Pilot"],
                ["09:04", "Learner withdrew consent (GDPR)", "—"],
              ].map(([time, event, ctx], i) => (
                <li
                  key={i}
                  className="grid grid-cols-[60px_1fr_auto] gap-3 items-center border-b border-[var(--border)] pb-1.5 last:border-0"
                >
                  <span className="font-mono text-[var(--muted-foreground)]">
                    {time}
                  </span>
                  <span>{event}</span>
                  <span className="text-[var(--muted-foreground)]">{ctx}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted-foreground)]">
        <p className="font-medium text-[var(--foreground)]">
          {tCommon("demoBannerLine1")}
        </p>
        <p className="mt-1">
          {canManage
            ? "Counts above are live. Organisations, cohorts, people and roles are editable from the two panels above — every change is written to the database and recorded in the audit log."
            : "Counts above are live. Managing organisations, cohorts and people requires an admin account."}
        </p>
      </div>
    </div>
  );
}

function ManageLink({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 flex items-center gap-4 hover:border-[var(--accent)] transition-colors"
    >
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{desc}</p>
      </div>
      <ChevronRight className="ml-auto h-5 w-5 flex-shrink-0 text-[var(--muted-foreground)] group-hover:text-[var(--accent)]" />
    </Link>
  );
}

function Stat({
  icon,
  label,
  value,
  subtle,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtle?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
          {icon}
        </div>
        <div>
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider font-semibold">
            {label}
          </p>
          <p className="text-2xl font-bold">{value}</p>
          {subtle ? (
            <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
              {subtle}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
