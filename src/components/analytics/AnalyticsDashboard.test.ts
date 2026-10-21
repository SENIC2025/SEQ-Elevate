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

/** The live screen's markup, apostrophes unescaped so text reads as written. */
const render = (data: AnalyticsData) =>
  renderToStaticMarkup(createElement(AnalyticsDashboard, { data, isSample: false })).replace(/&#x27;/g, "'");

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

/** The "Time per lesson" columns' bar colours, by label. */
function timeColours(html: string): Map<string, string> {
  const section = html.slice(html.indexOf("Time per lesson"), html.indexOf("Activity (last 14 days)"));
  return new Map(
    [
      ...section.matchAll(
        /background:([^;"]*);[^"]*"><\/div><span class="text-\[10px\] text-\[var\(--muted-foreground\)\] text-center leading-tight[^"]*">([^<]*)<\/span>/g
      ),
    ].map((m) => [m[2], m[1]])
  );
}

/** "Where they get stuck": each insight's [title, body]. */
function insights(html: string): [string, string][] {
  const section = html.slice(html.indexOf("Where they get stuck"), html.indexOf("Time per lesson"));
  return [
    ...section.matchAll(/<p class="text-sm font-semibold[^"]*">(?:<svg.*?<\/svg>)?([^<]*)<\/p><p[^>]*>([^<]*)<\/p>/g),
  ].map((m) => [
    m[1].replace(/<!-- -->/g, ""),
    m[2].replace(/<!-- -->/g, ""),
  ]);
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

/** The note under the "Other lessons" bar. */
const NOTE =
  "Learners now on one of their course's own lessons, outside the seven steps. Figures for each of those lessons come later.";

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
    expect(html).toContain(NOTE);
  });

  it("says under that bar what it counts, in words that still hold after launch", () => {
    // Review finding 9: the spec's "statistics per lesson follow after
    // launch" is read on live data, i.e. after launch, and didn't say who
    // the bar counts.
    const html = render(withOwnLessons());
    expect(html).toContain(NOTE);
    expect(html).not.toContain("follow after launch");
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

  it("names “Other lessons” as taking the longest, and colours its column, when learners spend the most time there", () => {
    // Review finding: one minute on Context, fifteen in a lesson of the
    // course's own; the chart's tallest column is "Other lessons".
    const data = buildSampleAnalytics();
    const timePerStage = data.timePerStage.map((t, i) => ({ ...t, avgSeconds: i === 0 ? 60 : 0 }));
    const learners = data.learners.map((l, i) => ({ ...l, secondsOther: i === 0 ? 900 : 0 }));
    const html = render({ ...data, timePerStage, slowestStageIndex: 0, learners });
    expect(insights(html)).toContainEqual([
      "“Other lessons” take the longest",
      expect.stringContaining("(avg 15m)"),
    ]);
    expect(insights(html).map(([title]) => title)).not.toContain("“Context” takes the longest");
    const colours = timeColours(html);
    expect(colours.get("Other lessons")).toBe("var(--warning)");
    expect(colours.get("Context")).toBe("var(--accent)");
  });

  it("keeps the slowest of the seven steps when it takes longer than the course's own lessons", () => {
    const html = render(withOwnLessons());
    const data = withOwnLessons();
    const slow = data.timePerStage[data.slowestStageIndex];
    expect(insights(html).map(([title]) => title)).toContain(`“${slow.label}” takes the longest`);
    expect(timeColours(html).get(slow.label)).toBe("var(--warning)");
    expect(timeColours(html).get("Other lessons")).toBe("var(--accent)");
  });

  it("adds nothing while no learner is on or has spent time in one (and sample data never has)", () => {
    for (const data of [buildSampleAnalytics(), { ...buildSampleAnalytics(), funnelOther: { reached: 0, pct: 0 } }]) {
      const html = render(data);
      expect(funnel(html)).toHaveLength(8);
      expect(timeColumns(html)).toHaveLength(7);
      expect(html).not.toContain("Other lesson");
      expect(html).not.toContain(NOTE);
    }
  });
});

describe("AnalyticsDashboard: language", () => {
  // Review finding 7b: the staff statistics are English only (like
  // STAGE_LABELS), but /de/analytics and /el/analytics serve the page as
  // German or Greek; the screen says it is English, so it is read as such.
  it("marks the whole screen as English, whatever the page's language", () => {
    for (const data of [buildSampleAnalytics(), withOwnLessons()]) {
      expect(render(data)).toMatch(/^<div lang="en"/);
    }
  });
});

/*
 * Spec 7.5 (D83): one line under the title says what the live figures
 * count — from when, without whom, and for partner staff, of which
 * organisation. The sample counts nothing, so it says nothing of the kind.
 */
describe("AnalyticsDashboard: what the figures count (spec 7.5)", () => {
  const LINE = "Counting from 1 December 2026. Staff, former staff and test accounts are left out.";
  const live = (counting: { from: string | null; organisation: string | null }) =>
    renderToStaticMarkup(
      createElement(AnalyticsDashboard, { data: buildSampleAnalytics(), isSample: false, counting })
    ).replace(/&#x27;/g, "'");

  it("says the date the figures count from and who is left out, under the title", () => {
    const html = live({ from: "1 December 2026", organisation: null });
    expect(html).toContain(`>${LINE}</p>`);
    expect(html.indexOf(LINE)).toBeGreaterThan(html.indexOf("Learner statistics"));
    expect(html.indexOf(LINE)).toBeLessThan(html.indexOf("Live data computed"));
  });

  it("names the organisation for partner staff", () => {
    expect(live({ from: "1 December 2026", organisation: "Pro Arbeit" })).toContain(`>${LINE} Pro Arbeit only.</p>`);
  });

  it("says who is left out, and no date, when there is none", () => {
    const html = live({ from: null, organisation: null });
    expect(html).toContain(">Staff, former staff and test accounts are left out.</p>");
    expect(html).not.toContain("Counting from");
  });

  it("says nothing of the kind over sample data", () => {
    const html = renderToStaticMarkup(
      createElement(AnalyticsDashboard, {
        data: buildSampleAnalytics(),
        isSample: true,
        counting: { from: "1 December 2026", organisation: "Pro Arbeit" },
      })
    );
    expect(html).not.toContain("Counting from");
    expect(html).not.toContain("left out");
  });
});
