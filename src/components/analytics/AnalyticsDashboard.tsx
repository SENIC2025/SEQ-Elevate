import {
  type AnalyticsData,
  STAGE_LABELS,
  HEATMAP_DAYS,
  HEATMAP_BUCKETS,
} from "@/lib/analytics-sample";
import { Link } from "@/i18n/navigation";
import { countingLine, type Counting } from "./counting";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Activity,
  CheckCircle2,
  Clock,
  TrendingDown,
  Hourglass,
  CalendarClock,
  Trophy,
  Gauge,
  AlertTriangle,
  Info,
} from "lucide-react";

/** Lessons of a course's own, on none of the seven steps (staff screens stay English). */
const OTHER_LESSONS = "Other lessons";

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "0m";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtAgo(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function AnalyticsDashboard({
  data,
  isSample = true,
  realCount = 0,
  sampleAvailable = false,
  counting,
}: {
  data: AnalyticsData;
  isSample?: boolean;
  realCount?: number;
  /** Test copies can switch to sample data; the live site never shows it. */
  sampleAvailable?: boolean;
  /** What live figures count (spec 7.5); said under the title, never over the sample. */
  counting?: Counting;
}) {
  // Release 2: learners on a lesson of their course's own are on none of
  // the seven steps (currentStageIndex -1), and their time there is in
  // secondsOther. Each is one figure beside the steps' — statistics per
  // lesson come after launch (spec 6, D70). Neither shows while there's
  // nothing to show, nor ever for the sample, which has no such learners.
  const onOther =
    data.funnelOther && data.funnelOther.reached > 0 ? data.funnelOther : null;
  const otherTimes = data.learners
    .map((l) => l.secondsOther ?? 0)
    .filter((v) => v > 0);
  const timeColumns = otherTimes.length
    ? [
        ...data.timePerStage,
        {
          label: OTHER_LESSONS,
          avgSeconds: Math.round(
            otherTimes.reduce((a, b) => a + b, 0) / otherTimes.length
          ),
        },
      ]
    : data.timePerStage;
  const maxTime = Math.max(1, ...timeColumns.map((t) => t.avgSeconds));
  const maxDay = Math.max(1, ...data.activityByDay.map((d) => d.opens));
  const maxHeat = Math.max(
    1,
    ...data.heatmap.flatMap((row) => row)
  );

  const stuckStage =
    data.funnel[data.stuckStageIndex]?.label ?? STAGE_LABELS[0];
  // The slowest column of the chart, "Other lessons" included: the seven
  // steps' slowest, unless learners spend longer in their courses' own
  // lessons.
  const slowestIndex =
    timeColumns.length > data.timePerStage.length &&
    timeColumns[timeColumns.length - 1].avgSeconds >
      (data.timePerStage[data.slowestStageIndex]?.avgSeconds ?? 0)
      ? timeColumns.length - 1
      : data.slowestStageIndex;
  const slowOther = slowestIndex >= data.timePerStage.length;
  const slowStage = slowOther
    ? OTHER_LESSONS
    : STAGE_LABELS[data.slowestStageIndex];
  const slowAvg = fmtDuration(timeColumns[slowestIndex]?.avgSeconds ?? 0);

  return (
    // The staff statistics are English only, whatever the page's language
    // (like STAGE_LABELS): say so, so the screen is read as English.
    <div lang="en" className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Learner statistics
        </h1>
        <Badge
          variant={isSample ? "muted" : "success"}
          className="text-[10px]"
        >
          {data.cohortSize} learners ·{" "}
          {isSample ? "sample data" : "live data"}
        </Badge>
      </div>
      {!isSample && counting ? (
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{countingLine(counting)}</p>
      ) : null}
      <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted-foreground)] flex flex-wrap items-center gap-2.5">
        <Info className="h-4 w-4 text-[var(--accent)] flex-shrink-0" />
        {isSample ? (
          <p className="flex-1 min-w-[200px]">
            Sample data for trying out this test copy, shaped exactly like what
            the platform captures — stage timings, course opens, quiz responses
            and progress. The live platform only ever shows real activity.
            {realCount > 0 ? (
              <>
                {" "}
                <Link
                  href="/analytics?live=1"
                  className="font-medium text-[var(--accent)] hover:underline whitespace-nowrap"
                >
                  View live data ({realCount} started) →
                </Link>
              </>
            ) : null}
          </p>
        ) : (
          <p className="flex-1 min-w-[200px]">
            Live data computed from this cohort&apos;s real activity — stage
            timings, course opens, quiz responses and progress.
            {sampleAvailable ? (
              <>
                {" "}
                <Link
                  href="/analytics?live=0"
                  className="font-medium text-[var(--accent)] hover:underline whitespace-nowrap"
                >
                  View sample data →
                </Link>
              </>
            ) : null}
          </p>
        )}
      </div>

      {/* KPI row */}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={Users} label="Learners" value={data.kpis.learners} />
        <Kpi icon={Activity} label="Active this week" value={data.kpis.activeThisWeek} />
        <Kpi icon={CheckCircle2} label="Completed" value={data.kpis.completed} />
        <Kpi icon={Gauge} label="Avg progress" value={`${data.kpis.avgCompletionPct}%`} />
        <Kpi icon={Clock} label="Avg time" value={`${data.kpis.avgMinutes}m`} />
        <Kpi icon={Trophy} label="Badges" value={data.kpis.badges} />
      </div>

      <div className="mt-6 grid lg:grid-cols-[1.4fr_1fr] gap-6">
        {/* Completion funnel */}
        <section>
          <h2 className="text-lg font-semibold mb-1">Course progress funnel</h2>
          <p className="text-sm text-[var(--muted-foreground)] mb-3">
            How far learners get — and where they drop off.
          </p>
          <Card>
            <CardContent className="p-5 space-y-2.5">
              {data.funnel.map((f, i) => {
                const drop = i === data.stuckStageIndex;
                return (
                  <div key={f.label}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium flex items-center gap-1.5">
                        {f.label}
                        {drop ? (
                          <span className="inline-flex items-center gap-0.5 text-[var(--warning)]">
                            <TrendingDown className="h-3 w-3" />
                            biggest drop-off
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[var(--muted-foreground)] tabular-nums">
                        {f.reached} · {f.pct}%
                      </span>
                    </div>
                    <div className="h-3 rounded-full bg-[var(--surface-muted)] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${f.pct}%`,
                          background: drop
                            ? "var(--warning)"
                            : i === data.funnel.length - 1
                              ? "var(--success)"
                              : "var(--accent)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              {onOther ? (
                <div className="border-t border-[var(--border)] pt-2.5">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium flex items-center gap-1.5">
                      {OTHER_LESSONS}
                    </span>
                    <span className="text-[var(--muted-foreground)] tabular-nums">
                      {onOther.reached} · {onOther.pct}%
                    </span>
                  </div>
                  <div className="h-3 rounded-full bg-[var(--surface-muted)] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${onOther.pct}%`, background: "var(--primary)" }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                    Learners now on one of their course&apos;s own lessons,
                    outside the seven steps. Figures for each of those
                    lessons come later.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>

        {/* Where they get stuck */}
        <section>
          <h2 className="text-lg font-semibold mb-1">Where they get stuck</h2>
          <p className="text-sm text-[var(--muted-foreground)] mb-3">
            The friction points to act on.
          </p>
          <div className="space-y-3">
            <Insight
              icon={TrendingDown}
              tone="warning"
              title={`Drop-off at “${stuckStage}”`}
              body="The largest share of learners stop progressing here — worth a nudge, a clearer prompt, or a check-in."
            />
            <Insight
              icon={Hourglass}
              tone="accent"
              title={
                slowOther
                  ? `“${slowStage}” take the longest`
                  : `“${slowStage}” takes the longest`
              }
              body={
                slowOther
                  ? `Learners spend the most time in their course's own lessons, outside the seven steps (avg ${slowAvg}). Figures for each of those lessons come later.`
                  : `Learners spend the most time on this lesson (avg ${slowAvg}) — a sign it's challenging.`
              }
            />
            <Insight
              icon={AlertTriangle}
              tone="danger"
              title={`${data.stuckLearners.length} learners inactive 3+ days`}
              body="Mid-course and not back recently — the cohort list below flags each one."
            />
          </div>
        </section>
      </div>

      {/* Time per lesson */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-1">Time per lesson</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-3">
          Average active time on each stage (tab-hidden time excluded).
        </p>
        <Card>
          <CardContent className="p-5">
            {/* Each column keeps room for its label: on a narrow screen the
                chart scrolls sideways in its card, as the table below does,
                rather than printing its labels over each other. */}
            <div
              className="overflow-x-auto"
              role="region"
              aria-label="Time per lesson"
              tabIndex={0}
            >
              <div
                className={`grid ${timeColumns.length > 7 ? "grid-cols-8" : "grid-cols-7"} gap-2 items-end h-40 min-w-[32rem]`}
              >
                {timeColumns.map((t, i) => (
                  <div key={t.label} className="flex flex-col items-center gap-1 h-full justify-end">
                    <span className="text-[10px] text-[var(--muted-foreground)] tabular-nums">
                      {fmtDuration(t.avgSeconds)}
                    </span>
                    <div
                      className="w-full rounded-t"
                      style={{
                        height: `${(t.avgSeconds / maxTime) * 100}%`,
                        background:
                          i === slowestIndex
                            ? "var(--warning)"
                            : "var(--accent)",
                        minHeight: "4px",
                      }}
                    />
                    <span className="text-[10px] text-[var(--muted-foreground)] text-center leading-tight">
                      {t.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Activity + heatmap */}
      <div className="mt-8 grid lg:grid-cols-2 gap-6">
        <section>
          <h2 className="text-lg font-semibold mb-1">Activity (last 14 days)</h2>
          <p className="text-sm text-[var(--muted-foreground)] mb-3">
            Course opens per day.
          </p>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-end gap-1 h-32">
                {data.activityByDay.map((d, i) => (
                  <div
                    key={i}
                    title={`${d.label}: ${d.opens} opens`}
                    className="flex-1 rounded-t bg-[var(--primary)]"
                    style={{
                      height: `${(d.opens / maxDay) * 100}%`,
                      minHeight: "3px",
                    }}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-[var(--muted-foreground)]">
                <span>14 days ago</span>
                <span>today</span>
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-1.5">
            <CalendarClock className="h-5 w-5 text-[var(--accent)]" />
            When they open
          </h2>
          <p className="text-sm text-[var(--muted-foreground)] mb-3">
            Busiest window: <strong>{data.peakLabel}</strong>.
          </p>
          <Card>
            <CardContent className="p-5">
              <div className="grid grid-cols-[auto_repeat(6,1fr)] gap-1 text-[10px]">
                <span />
                {HEATMAP_BUCKETS.map((b) => (
                  <span key={b} className="text-center text-[var(--muted-foreground)]">
                    {b}
                  </span>
                ))}
                {data.heatmap.map((row, d) => (
                  <Row key={d} day={HEATMAP_DAYS[d]} cells={row} max={maxHeat} />
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>

      {/* Per-learner table */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-1">Each learner</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-3">
          Position, time on task, last seen and quiz results — one row per
          learner.
        </p>
        <Card>
          {/* relative: the table's visually hidden headings are positioned,
              and would otherwise escape this scroll box and widen the page. */}
          <CardContent className="relative p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
                  <th className="px-4 py-2.5 font-medium">Learner</th>
                  <th className="px-3 py-2.5 font-medium">Currently on</th>
                  <th className="px-3 py-2.5 font-medium">Progress</th>
                  <th className="px-3 py-2.5 font-medium">Time</th>
                  <th className="px-3 py-2.5 font-medium">Quiz</th>
                  <th className="px-3 py-2.5 font-medium">Last seen</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.learners.map((l) => (
                  <tr
                    key={l.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{l.name}</div>
                      <div className="text-[11px] text-[var(--muted-foreground)]">
                        {l.cohort}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {l.completed
                        ? "Completed"
                        : l.currentStageIndex < 0
                          ? "Other lesson"
                          : STAGE_LABELS[l.currentStageIndex]}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-[var(--surface-muted)] overflow-hidden">
                          <div
                            className="h-full bg-[var(--accent)]"
                            style={{ width: `${l.progressPct}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
                          {l.progressPct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {fmtDuration(l.secondsTotal)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {l.assessmentTotal
                        ? `${l.assessmentCorrect}/${l.assessmentTotal}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--muted-foreground)]">
                      {fmtAgo(l.lastActiveHoursAgo)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={l.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="p-0">
      <CardContent className="p-3.5">
        <Icon className="h-4 w-4 text-[var(--accent)]" />
        <p className="mt-1.5 text-2xl font-bold leading-none tabular-nums">
          {value}
        </p>
        <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{label}</p>
      </CardContent>
    </Card>
  );
}

function Insight({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: typeof Users;
  tone: "warning" | "accent" | "danger";
  title: string;
  body: string;
}) {
  const color =
    tone === "warning"
      ? "var(--warning)"
      : tone === "danger"
        ? "var(--danger)"
        : "var(--accent)";
  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
        background: `color-mix(in srgb, ${color} 6%, transparent)`,
      }}
    >
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <Icon className="h-4 w-4" style={{ color }} />
        {title}
      </p>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">{body}</p>
    </div>
  );
}

function Row({
  day,
  cells,
  max,
}: {
  day: string;
  cells: number[];
  max: number;
}) {
  return (
    <>
      <span className="text-[var(--muted-foreground)] pr-1 self-center">
        {day}
      </span>
      {cells.map((v, b) => (
        <div
          key={b}
          title={`${day} ${HEATMAP_BUCKETS[b]}h: ${v} opens`}
          className="aspect-[2/1] rounded"
          style={{
            background:
              v === 0
                ? "var(--surface-muted)"
                : `color-mix(in srgb, var(--accent) ${Math.round(
                    (v / max) * 90 + 10
                  )}%, transparent)`,
          }}
        />
      ))}
    </>
  );
}

function StatusBadge({ status }: { status: "done" | "stuck" | "active" }) {
  if (status === "done")
    return (
      <Badge variant="success" className="text-[10px]">
        Completed
      </Badge>
    );
  if (status === "stuck")
    return (
      <Badge variant="muted" className="text-[10px] !text-[var(--danger)]">
        Stuck
      </Badge>
    );
  return (
    <Badge variant="accent" className="text-[10px]">
      Active
    </Badge>
  );
}
