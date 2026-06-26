import { describe, it, expect } from "vitest";
import { buildSampleAnalytics } from "./analytics-sample";

describe("buildSampleAnalytics", () => {
  it("is deterministic for a given seed", () => {
    const a = JSON.stringify(buildSampleAnalytics(42));
    const b = JSON.stringify(buildSampleAnalytics(42));
    expect(a).toBe(b);
  });

  it("produces a structurally sound funnel (monotonic non-increasing)", () => {
    const d = buildSampleAnalytics();
    // Everyone reaches the first stage.
    expect(d.funnel[0].reached).toBe(d.cohortSize);
    expect(d.funnel[0].pct).toBe(100);
    // Each step is reached by no more learners than the previous.
    for (let i = 1; i < d.funnel.length; i++) {
      expect(d.funnel[i].reached).toBeLessThanOrEqual(d.funnel[i - 1].reached);
    }
    // The "Completed" terminal is the last entry.
    expect(d.funnel.at(-1)?.label).toBe("Completed");
  });

  it("returns sane shapes and KPI ranges", () => {
    const d = buildSampleAnalytics();
    expect(d.learners).toHaveLength(d.cohortSize);
    expect(d.timePerStage).toHaveLength(7);
    expect(d.heatmap).toHaveLength(7);
    expect(d.heatmap.every((row) => row.length === 6)).toBe(true);
    expect(d.activityByDay).toHaveLength(14);

    expect(d.kpis.avgCompletionPct).toBeGreaterThanOrEqual(0);
    expect(d.kpis.avgCompletionPct).toBeLessThanOrEqual(100);
    expect(d.kpis.completed).toBeLessThanOrEqual(d.cohortSize);
    expect(d.kpis.activeThisWeek).toBeLessThanOrEqual(d.cohortSize);

    // Indices in range.
    expect(d.stuckStageIndex).toBeGreaterThanOrEqual(0);
    expect(d.slowestStageIndex).toBeGreaterThanOrEqual(0);
    expect(d.slowestStageIndex).toBeLessThan(7);

    // Stuck learners are a subset flagged as stuck.
    expect(d.stuckLearners.every((l) => l.status === "stuck")).toBe(true);
  });

  it("each learner row is internally consistent", () => {
    const d = buildSampleAnalytics();
    for (const l of d.learners) {
      expect(l.secondsByStage).toHaveLength(7);
      expect(l.secondsTotal).toBe(
        l.secondsByStage.reduce((a, b) => a + b, 0)
      );
      expect(l.progressPct).toBeGreaterThanOrEqual(0);
      expect(l.progressPct).toBeLessThanOrEqual(100);
      expect(l.assessmentCorrect).toBeLessThanOrEqual(l.assessmentTotal);
    }
  });
});
