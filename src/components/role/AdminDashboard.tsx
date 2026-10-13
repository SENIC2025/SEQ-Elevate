"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import {
  Users,
  Building2,
  GraduationCap,
  BookOpen,
  ShieldCheck,
  Download,
  Trash2,
  ChevronRight,
} from "lucide-react";

export interface AdminCounts {
  users: number;
  cohorts: number;
  organisations: number;
  courses: number;
}

/** The admin overview. The page renders it for admins only. */
export function AdminDashboard({ counts }: { counts?: AdminCounts }) {
  const t = useTranslations("admin");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-2 text-2xl sm:text-3xl font-bold tracking-tight">
        {t("title")}
      </h1>

      <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* counts.users counts learners only, not staff who still hold an
            old LEARNER role (getAdminCounts) */}
        <Stat
          icon={<Users className="h-5 w-5" />}
          label={t("learners")}
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
          icon={<BookOpen className="h-5 w-5" />}
          label={t("courses")}
          value={String(counts?.courses ?? 0)}
        />
      </div>

      {/* Management entry points */}
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

      {/* GDPR self-service — the account page handles both requests */}
      <Card className="mt-8">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[var(--accent)]" />
            {t("gdpr")}
          </h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-1 mb-4">
            Everyone handles these requests themselves from their account page
            — no admin step is needed.
          </p>
          <ul className="grid sm:grid-cols-2 gap-2 text-sm">
            <li className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
              <Download className="h-4 w-4 text-[var(--muted-foreground)]" />
              <span>Download a copy of their data</span>
            </li>
            <li className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
              <Trash2 className="h-4 w-4 text-[var(--muted-foreground)]" />
              <span>Delete their account and personal data</span>
            </li>
          </ul>
          <Link
            href="/account"
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)] hover:underline"
          >
            Open your account page
            <ChevronRight className="h-4 w-4" />
          </Link>
        </CardContent>
      </Card>

      <p className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted-foreground)]">
        Counts above are live. Organisations, cohorts, people and roles are
        editable from the two panels above — every change is written to the
        database and recorded in the audit log.
      </p>
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
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
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
        </div>
      </CardContent>
    </Card>
  );
}
