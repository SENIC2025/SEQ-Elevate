"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useDemoState } from "@/store/demo-state";
import { COURSE_META, STAGES } from "@/data/course";
import {
  Users,
  CheckCircle2,
  AlertCircle,
  EyeOff,
  MessageSquare,
  ArrowLeft,
  FileSpreadsheet,
} from "lucide-react";

const COHORT = [
  { id: "you", name: "You (demo learner)", isYou: true, progress: 100, status: "active" as const },
  { id: "yusuf", name: "Yusuf K.", progress: 86, status: "active" as const },
  { id: "lena", name: "Lena S.", progress: 71, status: "needsAttention" as const },
  { id: "maria", name: "Maria P.", progress: 57, status: "active" as const },
  { id: "tobi", name: "Tobi M.", progress: 14, status: "needsAttention" as const },
  { id: "akin", name: "Akin Y.", progress: 100, status: "active" as const },
];

export function FacilitatorWorkspace() {
  const t = useTranslations("facilitator");
  const tCommon = useTranslations("common");
  const tCourse = useTranslations("course.workplaceConflict");
  const tCard = useTranslations("compCard");
  const tScenario = useTranslations("course.workplaceConflict.scenario");
  const locale = useLocale();
  const { state } = useDemoState();

  const [selected, setSelected] = useState<string | null>(null);
  const [observation, setObservation] = useState("");
  const [validated, setValidated] = useState(false);

  const stagesDone = state.course.stagesCompleted.length;
  const youProgress = Math.round((stagesDone / STAGES.length) * 100);

  const activeLearners = COHORT.filter((l) => l.status === "active").length;
  const compCardCount = state.compCard.updatedAt ? 4 : 3;
  const needsAttention = COHORT.filter(
    (l) => l.status === "needsAttention"
  ).length;

  if (selected === "you") {
    const c = state.compCard;
    const privacy = c.privacy;
    const canSeeBehaviour = privacy !== "self";
    const canSeeMentor = privacy === "facilitatorAndMentor";

    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <button
          type="button"
          onClick={() => {
            setSelected(null);
            setValidated(false);
            setObservation("");
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
                <h2 className="text-2xl font-bold">You (demo learner)</h2>
                <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
                  {tCourse("title")}
                </p>
              </div>
              <Badge variant="primary">{youProgress}%</Badge>
            </div>

            <Progress value={youProgress} className="mb-6" />

            <h3 className="text-sm font-semibold mb-3">
              {tCard("title")}
            </h3>

            <div className="space-y-3">
              <CompCardRow label={tCard("fieldScenario")}>
                {state.course.scenario.root ? (
                  `${tScenario(`choices.${state.course.scenario.root}`)} → ${
                    state.course.scenario.followup
                      ? tScenario(`followup.${state.course.scenario.followup}`)
                      : "—"
                  }`
                ) : (
                  "—"
                )}
              </CompCardRow>

              <CompCardRow label={tCard("fieldWentWell")}>
                {c.wentWell || "—"}
              </CompCardRow>

              <CompCardRow label={tCard("fieldDifficult")} redacted={!canSeeBehaviour}>
                {c.difficult || "—"}
              </CompCardRow>

              <CompCardRow label={tCard("fieldImprove")}>
                {c.improve || "—"}
              </CompCardRow>

              <CompCardRow label={tCard("fieldBehaviour")} redacted={!canSeeMentor}>
                {c.behaviour || "—"}
              </CompCardRow>

              <CompCardRow label={tCard("fieldConfidence")}>
                {c.confidence}/5 — {tCard(`confidenceLabels.${c.confidence}`)}
              </CompCardRow>
            </div>

            {/* Observation note */}
            <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <p className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4" />
                {t("observationTitle")}
              </p>
              <Textarea
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
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
                  onChange={(e) => setValidated(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-[var(--primary)]"
                />
                <div>
                  <p className="text-sm font-medium">{t("validateLabel")}</p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    {t("validateHint")}
                  </p>
                </div>
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button size="md" disabled={!observation && !validated}>
                {tCommon("save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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

      {/* Stats */}
      <div className="mt-6 grid sm:grid-cols-3 gap-4">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label={t("activeNow")}
          value={`${activeLearners}/${COHORT.length}`}
          tone="primary"
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label={t("compCardSubmissions")}
          value={`${compCardCount}/${COHORT.length}`}
          tone="success"
        />
        <StatCard
          icon={<AlertCircle className="h-5 w-5" />}
          label={t("needsAttention")}
          value={String(needsAttention)}
          tone="accent"
        />
      </div>

      {/* Cohort list */}
      <h2 className="mt-8 mb-3 text-lg font-semibold">{t("learnersLabel")}</h2>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-[var(--border)]">
            {COHORT.map((learner) => {
              const progress = learner.isYou ? youProgress : learner.progress;
              return (
                <li
                  key={learner.id}
                  className="flex items-center gap-4 p-4 hover:bg-[var(--surface-muted)] transition-colors"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-semibold text-sm">
                    {learner.name.split(" ").map((s) => s[0]).join("").slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">
                      {learner.name}
                      {learner.isYou ? (
                        <Badge variant="primary" className="ml-2 text-[10px]">
                          {tCommon("appName")}
                        </Badge>
                      ) : null}
                    </p>
                    <div className="mt-1 flex items-center gap-3">
                      <Progress value={progress} className="max-w-xs" />
                      <span className="text-xs text-[var(--muted-foreground)] whitespace-nowrap">
                        {progress}%
                      </span>
                    </div>
                  </div>
                  {learner.status === "needsAttention" ? (
                    <Badge variant="accent" className="text-[10px]">
                      <AlertCircle className="h-3 w-3" />
                      {t("needsAttention")}
                    </Badge>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!learner.isYou}
                    onClick={() => setSelected(learner.id)}
                  >
                    {learner.isYou ? t("viewLearner") : "—"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="mt-6 text-xs text-[var(--muted-foreground)] flex items-center gap-2">
        <FileSpreadsheet className="h-4 w-4" />
        {t("scriptsLibrary")} · Facilitator scripts, scenario variations, behaviour
        checklists live here in production.
      </div>
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
    primary:
      "bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/20",
    success:
      "bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20",
    accent:
      "bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/20",
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

function CompCardRow({
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
