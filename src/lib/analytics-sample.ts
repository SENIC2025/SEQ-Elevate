/**
 * Representative sample analytics for the Statistics showcase. Deterministic
 * (seeded) so the dashboard is stable across loads. This is DEMO data shaped
 * exactly like what the platform captures in production — stage timings,
 * course opens, quiz responses, progress — so clients can see what the
 * statistics look like before a real cohort exists. The same dashboard reads
 * real AuditLog events + enrollments in production.
 */

export const STAGE_LABELS = [
  "Context",
  "Concept",
  "Behaviour",
  "Simulation",
  "Scenario",
  "Reflection",
  "Assessment",
] as const;

export interface LearnerRow {
  id: string;
  name: string;
  cohort: string;
  currentStageIndex: number; // 0..6, or 7 = completed
  completed: boolean;
  progressPct: number;
  secondsByStage: number[]; // length 7 (0 if not reached)
  secondsTotal: number;
  lastActiveHoursAgo: number;
  assessmentCorrect: number;
  assessmentTotal: number;
  status: "done" | "stuck" | "active";
}

export interface AnalyticsData {
  cohortSize: number;
  kpis: {
    learners: number;
    activeThisWeek: number;
    completed: number;
    avgCompletionPct: number;
    avgMinutes: number;
    badges: number;
  };
  funnel: { label: string; reached: number; pct: number }[]; // 7 stages + Completed
  timePerStage: { label: string; avgSeconds: number }[]; // 7 stages
  stuckStageIndex: number; // biggest funnel drop-off
  slowestStageIndex: number; // longest average time
  activityByDay: { label: string; opens: number }[]; // last 14 days
  heatmap: number[][]; // [dayOfWeek 0..6 (Mon..Sun)][bucket 0..5 (4h blocks)]
  peakLabel: string; // human description of the busiest window
  learners: LearnerRow[];
  stuckLearners: LearnerRow[];
}

// mulberry32 — tiny deterministic PRNG.
function makeRng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = [
  "Lena M.", "Niko P.", "Sofia R.", "Jonas K.", "Amara D.", "Tariq H.",
  "Elif Y.", "Marco B.", "Yusuf A.", "Greta S.", "Ivan T.", "Nadia L.",
  "Petros V.", "Hana Z.", "Leon W.", "Maja N.", "Omar F.", "Clara E.",
  "Dimitris G.", "Ana C.", "Kemal O.", "Lukas R.", "Fatima B.", "Theo M.",
];
const COHORTS = ["Berlin Pilot", "Athens Pilot", "Online Group"];
const HOUR_BUCKETS = ["00–04", "04–08", "08–12", "12–16", "16–20", "20–24"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function buildSampleAnalytics(seed = 20260615): AnalyticsData {
  const rng = makeRng(seed);
  const N = NAMES.length;
  const learners: LearnerRow[] = [];
  const heatmap: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 6 }, () => 0)
  );
  const dayOpens = new Array(14).fill(0);

  for (let i = 0; i < N; i++) {
    // Progress: weighted so a realistic funnel forms (most reach the middle,
    // fewer finish). 7 = completed.
    const r = rng();
    const currentStageIndex =
      r < 0.12 ? 7 : r < 0.25 ? 6 : r < 0.45 ? 5 : r < 0.6 ? 4 : r < 0.78 ? 3 : r < 0.9 ? 2 : r < 0.97 ? 1 : 0;
    const completed = currentStageIndex === 7;
    const reached = completed ? 7 : currentStageIndex; // stages fully done

    const secondsByStage = new Array(7).fill(0);
    for (let s = 0; s < Math.min(reached + (completed ? 0 : 1), 7); s++) {
      // Base 1.5–7 min; the Scenario stage (index 4) runs longer — a sticking point.
      const base = 90 + Math.floor(rng() * 270);
      const stick = s === 4 ? 180 + Math.floor(rng() * 240) : 0;
      secondsByStage[s] = base + stick;
    }
    const secondsTotal = secondsByStage.reduce((a, b) => a + b, 0);

    // Recency: completers + some active recently; a chunk inactive (stuck).
    const lastActiveHoursAgo = completed
      ? 6 + Math.floor(rng() * 60)
      : rng() < 0.55
        ? Math.floor(rng() * 48)
        : 72 + Math.floor(rng() * 200);

    const assessmentTotal = currentStageIndex >= 6 || completed ? 3 : 0;
    const assessmentCorrect = assessmentTotal
      ? 1 + Math.floor(rng() * 3)
      : 0;

    const status: LearnerRow["status"] = completed
      ? "done"
      : lastActiveHoursAgo > 72
        ? "stuck"
        : "active";

    // Course-open events → activity charts + heatmap. More opens for further-along
    // learners; times skew to weekday afternoons/evenings.
    const opens = 2 + Math.floor(rng() * (reached + 3));
    for (let o = 0; o < opens; o++) {
      const dayBack = Math.floor(rng() * 14);
      dayOpens[13 - dayBack] += 1;
      const dow = (13 - dayBack) % 7; // arbitrary but stable mapping
      // Hour skew: mostly buckets 3 (12-16), 4 (16-20), 5 (20-24).
      const hr = rng();
      const bucket = hr < 0.12 ? 2 : hr < 0.4 ? 3 : hr < 0.78 ? 4 : hr < 0.95 ? 5 : 1;
      const weekday = dow < 5;
      heatmap[dow][bucket] += weekday ? 1 : rng() < 0.5 ? 1 : 0;
    }

    learners.push({
      id: `L${String(i + 1).padStart(2, "0")}`,
      name: NAMES[i],
      cohort: COHORTS[i % COHORTS.length],
      currentStageIndex,
      completed,
      progressPct: Math.round((Math.min(reached, 7) / 7) * 100),
      secondsByStage,
      secondsTotal,
      lastActiveHoursAgo,
      assessmentCorrect,
      assessmentTotal,
      status,
    });
  }

  // Funnel: how many reached each stage (everyone reaches Context).
  const funnel: { label: string; reached: number; pct: number }[] =
    STAGE_LABELS.map((label, idx) => {
    const reached = learners.filter(
      (l) => l.completed || l.currentStageIndex >= idx
    ).length;
    return { label, reached, pct: Math.round((reached / N) * 100) };
  });
  funnel.push({
    label: "Completed",
    reached: learners.filter((l) => l.completed).length,
    pct: Math.round((learners.filter((l) => l.completed).length / N) * 100),
  });

  // Biggest drop-off between consecutive funnel steps = where they get stuck.
  let stuckStageIndex = 0;
  let maxDrop = -1;
  for (let i = 1; i < funnel.length; i++) {
    const drop = funnel[i - 1].reached - funnel[i].reached;
    if (drop > maxDrop) {
      maxDrop = drop;
      stuckStageIndex = i; // the step they fail to reach
    }
  }

  // Average time per stage (over learners who recorded time there).
  const timePerStage = STAGE_LABELS.map((label, idx) => {
    const vals = learners
      .map((l) => l.secondsByStage[idx])
      .filter((v) => v > 0);
    const avg = vals.length
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      : 0;
    return { label, avgSeconds: avg };
  });
  const slowestStageIndex = timePerStage.reduce(
    (best, cur, idx, arr) => (cur.avgSeconds > arr[best].avgSeconds ? idx : best),
    0
  );

  // Activity over the last 14 days.
  const activityByDay = dayOpens.map((opens, i) => ({
    label: `${i - 13 === 0 ? "today" : `${13 - i}d`}`,
    opens,
  }));

  // Peak window from the heatmap.
  let peakDay = 0;
  let peakBucket = 0;
  let peakVal = -1;
  for (let d = 0; d < 7; d++)
    for (let b = 0; b < 6; b++)
      if (heatmap[d][b] > peakVal) {
        peakVal = heatmap[d][b];
        peakDay = d;
        peakBucket = b;
      }
  const peakLabel = `${DAYS[peakDay]} ${HOUR_BUCKETS[peakBucket]}h`;

  const activeThisWeek = learners.filter((l) => l.lastActiveHoursAgo <= 168).length;
  const completedCount = learners.filter((l) => l.completed).length;
  const avgCompletionPct = Math.round(
    learners.reduce((a, l) => a + l.progressPct, 0) / N
  );
  const avgMinutes = Math.round(
    learners.reduce((a, l) => a + l.secondsTotal, 0) / N / 60
  );

  return {
    cohortSize: N,
    kpis: {
      learners: N,
      activeThisWeek,
      completed: completedCount,
      avgCompletionPct,
      avgMinutes,
      badges: completedCount + Math.floor(N * 0.2),
    },
    funnel,
    timePerStage,
    stuckStageIndex,
    slowestStageIndex,
    activityByDay,
    heatmap,
    peakLabel,
    learners,
    stuckLearners: learners
      .filter((l) => l.status === "stuck")
      .sort((a, b) => b.lastActiveHoursAgo - a.lastActiveHoursAgo),
  };
}

export const HEATMAP_DAYS = DAYS;
export const HEATMAP_BUCKETS = HOUR_BUCKETS;
