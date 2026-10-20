import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSampleAnalytics, type AnalyticsData, type LearnerRow } from "@/lib/analytics-sample";

vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: ({ href, ...rest }: { href: string }) => h("a", { href: `/en${href}`, ...rest }),
  };
});

const { AnalyticsDashboard } = await import("./AnalyticsDashboard");

const render = (data: AnalyticsData) =>
  renderToStaticMarkup(createElement(AnalyticsDashboard, { data, isSample: false }));

/** The funnel's bars, in order: [label, "reached · pct%"]. */
function funnel(html: string): [string, string][] {
  const section = html.slice(html.indexOf("Course progress funnel"), html.indexOf("Where they get stuck"));
  return [
    ...section.matchAll(
      /<span class="font-medium flex items-center gap-1\.5">([^<]*)(?:<span.*?<\/span>)?<\/span><span class="text-\[var\(--muted-foreground\)\] tabular-nums">([^<]*)<\/span>/g
    ),
  ].map((m) => [m[1], m[2].replace(/<!-- -->/g, "")]);
}

/** The "Time per lesson" columns: [label, average]. */
function timeColumns(html: string): [string, string][] {
  const section = html.slice(html.indexOf("Time per lesson"), html.indexOf("Activity (last 14 days)"));
  return [
    ...section.matchAll(
      /<span class="text-\[10px\] text-\[var\(--muted-foreground\)\] tabular-nums">([^<]*)<\/span>.*?<span class="text-\[10px\] text-\[var\(--muted-foreground\)\] text-center leading-tight">([^<]*)<\/span>/g
    ),
  ].map((m) => [m[2], m[1]]);
}

/** A learner's "Currently on" cell in the per-learner table. */
function currentlyOn(html: string, name: string): string | undefined {
  const row = html.slice(html.indexOf(`<div class="font-medium">${name}</div>`));
  return row.match(/<\/td><td class="px-3 py-2\.5">([^<]*)<\/td>/)?.[1];
}

/**
 * Live data with learners on lessons of their course's own (Release 2):
 * on none of the seven steps (currentStageIndex -1), and with time there
 * (secondsOther), as buildRealAnalytics computes them.
 */
function withOwnLessons(): AnalyticsData {
  const data = buildSampleAnalytics();
  const own = (l: LearnerRow, secondsOther: number): LearnerRow => ({
    ...l,
    currentStageIndex: -1,
    completed: false,
    status: "active",
    secondsOther,
    secondsTotal: l.secondsByStage.reduce((a, b) => a + b, 0) + secondsOther,
  });
  const learners = data.learners.map((l, i) => (i === 0 ? own(l, 240) : i === 1 ? own(l, 360) : l));
  return { ...data, learners, funnelOther: { reached: 2, pct: 8 } };
}

describe("AnalyticsDashboard: learners on lessons of their course's own (spec 6)", () => {
  it("shows them as one bar after the funnel's steps, with what it means", () => {
    const html = render(withOwnLessons());
    const bars = funnel(html);
    expect(bars.map(([label]) => label)).toEqual([
      "Context",
      "Concept",
      "Behaviour",
      "Simulation",
      "Scenario",
      "Reflection",
      "Assessment",
      "Completed",
      "Other lessons",
    ]);
    expect(bars.at(-1)).toEqual(["Other lessons", "2 · 8%"]);
    expect(html).toContain("width:8%");
    expect(html).toContain("Courses with their own lessons; statistics per lesson follow after launch.");
  });

  it("says where each of them is in the table, not an empty cell", () => {
    const data = withOwnLessons();
    const html = render(data);
    expect(currentlyOn(html, data.learners[0].name)).toBe("Other lesson");
    expect(currentlyOn(html, data.learners[1].name)).toBe("Other lesson");
  });

  it("shows the time in those lessons beside the seven steps' (the average over learners with any)", () => {
    const columns = timeColumns(render(withOwnLessons()));
    expect(columns).toHaveLength(8);
    expect(columns.at(-1)).toEqual(["Other lessons", "5m"]);
  });

  it("adds nothing while no learner is on or has spent time in one (and sample data never has)", () => {
    for (const data of [buildSampleAnalytics(), { ...buildSampleAnalytics(), funnelOther: { reached: 0, pct: 0 } }]) {
      const html = render(data);
      expect(funnel(html)).toHaveLength(8);
      expect(timeColumns(html)).toHaveLength(7);
      expect(html).not.toContain("Other lesson");
      expect(html).not.toContain("statistics per lesson follow after launch");
    }
  });
});
