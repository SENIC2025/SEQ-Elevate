"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import type { FacilitatorLearner } from "@/lib/server-queries";
import { saveObservation, recordValidation } from "@/app/actions/facilitator";
import { STAGES } from "@/data/course";
import {
  Users,
  CheckCircle2,
  AlertCircle,
  EyeOff,
  MessageSquare,
  ArrowLeft,
  MapPin,
  Clock,
  Activity,
} from "lucide-react";

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0m";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function relativeTime(iso: string, locale: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(-diffHr, "hour");
  return rtf.format(-Math.round(diffHr / 24), "day");
}

/** Facilitator workspace backed by real DB learners (staff view). */
export function RealFacilitatorView({
  learners,
}: {
  learners: FacilitatorLearner[];
}) {
  const t = useTranslations("facilitator");
  const tCommon = useTranslations("common");
  const tCard = useTranslations("compCard");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [observation, setObservation] = useState("");
  const [validated, setValidated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const active = learners.filter((l) => l.progressPct > 0).length;
  const cards = learners.filter((l) => l.compCard).length;
  const attention = learners.filter((l) => l.needsAttention).length;
  const selected = learners.find((l) => l.id === selectedId) ?? null;

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    if (observation.trim()) await saveObservation(selected.id, observation);
    if (validated)
      await recordValidation(selected.id, "communicationEi", observation);
    setSaving(false);
    setSaved(true);
  }

  // ---- Detail view ----
  if (selected) {
    const c = selected.compCard;
    const canSeeDifficult = c && c.privacy !== "self";
    const canSeeBehaviour = c && c.privacy === "facilitatorAndMentor";
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <button
          type="button"
          onClick={() => {
            setSelectedId(null);
            setObservation("");
            setValidated(false);
            setSaved(false);
          }}
          className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          {tCommon("back")}
        </button>

        <Card>
          <CardContent className="p-6 sm:p-8">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
                  {t("viewLearner")}
                </p>
                <h2 className="text-2xl font-bold">{selected.name}</h2>
                <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
                  {selected.email}
                </p>
              </div>
              <Badge variant="primary">{selected.progressPct}%</Badge>
            </div>

            <Progress value={selected.progressPct} className="mb-4" />

            <ActivityPanel learner={selected} />

            <h3 className="text-sm font-semibold mb-3">{tCard("title")}</h3>

            {c ? (
              <div className="space-y-3">
                <Row label={tCard("fieldScenario")}>{selected.scenario ?? "—"}</Row>
                <Row label={tCard("fieldWentWell")}>{c.wentWell || "—"}</Row>
                <Row label={tCard("fieldDifficult")} redacted={!canSeeDifficult}>
                  {c.difficult || "—"}
                </Row>
                <Row label={tCard("fieldImprove")}>{c.improve || "—"}</Row>
                <Row label={tCard("fieldBehaviour")} redacted={!canSeeBehaviour}>
                  {c.behaviour || "—"}
                </Row>
                <Row label={tCard("fieldConfidence")}>
                  {c.confidence}/5 — {tCard(`confidenceLabels.${c.confidence}`)}
                </Row>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">—</p>
            )}

            {/* Observation */}
            <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <p className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4" />
                {t("observationTitle")}
              </p>
              <Textarea
                value={observation}
                onChange={(e) => {
                  setObservation(e.target.value);
                  setSaved(false);
                }}
                placeholder={t("observationPlaceholder")}
                rows={2}
              />
            </div>

            {/* Validate */}
            <div className="mt-4 rounded-lg border border-[var(--border)] p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={validated}
                  onChange={(e) => {
                    setValidated(e.target.checked);
                    setSaved(false);
                  }}
                  className="mt-1 h-4 w-4 accent-[var(--accent)]"
                />
                <div>
                  <p className="text-sm font-medium">{t("validateLabel")}</p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    {t("validateHint")}
                  </p>
                </div>
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              {saved ? (
                <span className="text-sm text-[var(--success)] inline-flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" />
                  {tCard("saved")}
                </span>
              ) : null}
              <Button
                size="md"
                disabled={(!observation.trim() && !validated) || saving}
                onClick={handleSave}
              >
                {tCommon("save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- List view ----
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t("cohortLabel")}: {t("cohortName")}
        </p>
      </div>

      <div className="mt-6 grid sm:grid-cols-3 gap-4">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label={t("activeNow")}
          value={`${active}/${learners.length}`}
          tone="primary"
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label={t("compCardSubmissions")}
          value={`${cards}/${learners.length}`}
          tone="success"
        />
        <StatCard
          icon={<AlertCircle className="h-5 w-5" />}
          label={t("needsAttention")}
          value={String(attention)}
          tone="accent"
        />
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">{t("learnersLabel")}</h2>
      <Card>
        <CardContent className="p-0">
          {learners.length === 0 ? (
            <p className="p-6 text-sm text-[var(--muted-foreground)]">
              No learners have joined yet. Learners appear here once they sign
              in and start a course.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {learners.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center gap-4 p-4 hover:bg-[var(--surface-muted)] transition-colors"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-semibold text-sm">
                    {l.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{l.name}</p>
                    <div className="mt-1 flex items-center gap-3">
                      <Progress value={l.progressPct} className="max-w-xs" />
                      <span className="text-xs text-[var(--muted-foreground)] whitespace-nowrap">
                        {l.progressPct}%
                      </span>
                    </div>
                  </div>
                  {l.needsAttention ? (
                    <Badge variant="accent" className="text-[10px]">
                      <AlertCircle className="h-3 w-3" />
                      {t("needsAttention")}
                    </Badge>
                  ) : l.completed ? (
                    <Badge variant="success" className="text-[10px]">
                      <CheckCircle2 className="h-3 w-3" />
                      {tCommon("appName")}
                    </Badge>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedId(l.id)}
                  >
                    {t("viewLearner")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "primary" | "success" | "accent";
}) {
  const toneStyles = {
    primary: "bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/20",
    success: "bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20",
    accent: "bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/20",
  }[tone];
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-lg border ${toneStyles}`}
        >
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

function Row({
  label,
  redacted = false,
  children,
}: {
  label: string;
  redacted?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("facilitator");
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-semibold mb-1">
        {label}
      </p>
      {redacted ? (
        <div className="rounded bg-[var(--surface-muted)] border border-dashed border-[var(--border)] px-2.5 py-1.5 text-sm text-[var(--muted-foreground)] flex items-center gap-1.5 italic">
          <EyeOff className="h-3.5 w-3.5" />
          {t("redacted")} — {t("redactedHint")}
        </div>
      ) : (
        <p className="text-sm whitespace-pre-wrap">{children}</p>
      )}
    </div>
  );
}

/** Where the learner is, how long they've spent, and how their quizzes went. */
function ActivityPanel({ learner }: { learner: FacilitatorLearner }) {
  const t = useTranslations("facilitator");
  const tStage = useTranslations("course.stageLabel");
  const locale = useLocale();

  const positionLabel =
    learner.currentStage === "complete"
      ? t("completedAll")
      : learner.currentStage
        ? tStage(learner.currentStage)
        : "—";

  const stageRows = STAGES.filter((s) => (learner.secondsByStage[s] ?? 0) > 0);
  const maxStage = Math.max(1, ...stageRows.map((s) => learner.secondsByStage[s]));

  return (
    <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-semibold mb-3">
        {t("activityTitle")}
      </p>

      <div className="grid grid-cols-3 gap-3">
        <MiniStat icon={MapPin} label={t("currentlyOn")} value={positionLabel} />
        <MiniStat
          icon={Clock}
          label={t("timeOnTask")}
          value={formatDuration(learner.secondsTotal)}
        />
        <MiniStat
          icon={Activity}
          label={t("lastActive")}
          value={
            learner.lastActiveAt
              ? relativeTime(learner.lastActiveAt, locale)
              : "—"
          }
        />
      </div>

      {learner.currentCourse ? (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          {t("inCourse", { course: learner.currentCourse })}
        </p>
      ) : null}

      {stageRows.length ? (
        <div className="mt-3 space-y-1.5">
          {stageRows.map((s) => (
            <div key={s} className="flex items-center gap-2 text-xs">
              <span className="w-24 flex-shrink-0 text-[var(--muted-foreground)] truncate">
                {tStage(s)}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-[var(--surface)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--accent)]/60"
                  style={{
                    width: `${(learner.secondsByStage[s] / maxStage) * 100}%`,
                  }}
                />
              </div>
              <span className="tabular-nums text-[var(--muted-foreground)] w-12 text-right">
                {formatDuration(learner.secondsByStage[s])}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <QuizPill
          label={t("quizAssessment")}
          correct={learner.assessmentCorrect}
          total={learner.assessmentTotal}
        />
        <QuizPill
          label={t("quizPractice")}
          correct={learner.simulationCorrect}
          total={learner.simulationTotal}
        />
        <QuizPill
          label={t("quizVideo")}
          correct={learner.videoCorrect}
          total={learner.videoAnswered}
        />
      </div>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
      <Icon className="h-3.5 w-3.5 text-[var(--accent)]" />
      <p className="mt-1 text-sm font-semibold leading-tight">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </p>
    </div>
  );
}

function QuizPill({
  label,
  correct,
  total,
}: {
  label: string;
  correct: number;
  total: number;
}) {
  const tone =
    total === 0
      ? "muted"
      : correct === total
        ? "success"
        : correct >= total / 2
          ? "accent"
          : "warn";
  const cls =
    tone === "success"
      ? "border-[var(--success)]/30 bg-[var(--success)]/10 text-[var(--success)]"
      : tone === "warn"
        ? "border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]"
        : tone === "accent"
          ? "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]"
          : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-foreground)]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}
    >
      {label}: {total === 0 ? "—" : `${correct}/${total}`}
    </span>
  );
}
