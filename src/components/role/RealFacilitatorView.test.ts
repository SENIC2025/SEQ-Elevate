import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import type { FacilitatorLearner } from "@/lib/server-queries";

// Real English messages behind next-intl's API, so a renamed key shows up
// here as a raw key path rather than at runtime.
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useTranslations: (namespace: string) =>
    createTranslator({ locale: "en", messages: en, namespace: namespace as never }),
  useLocale: () => "en",
}));
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: ({ href, ...rest }: { href: string }) => h("a", { href: `/en${href}`, ...rest }),
  };
});
// The Save buttons' server actions; nothing here saves.
vi.mock("@/app/actions/facilitator", () => ({
  saveObservation: vi.fn(),
  recordValidation: vi.fn(),
}));

const { RealFacilitatorView, ActivityPanel } = await import("./RealFacilitatorView");

const NOW = Date.UTC(2026, 9, 20, 12);
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function learner(over: Partial<FacilitatorLearner>): FacilitatorLearner {
  return {
    id: "u1",
    name: "Lena",
    email: "lena@example.com",
    progressPct: 0,
    completed: false,
    needsAttention: false,
    scenario: null,
    compCard: null,
    videoAnswered: 0,
    videoCorrect: 0,
    currentCourse: null,
    currentStage: null,
    currentStageLabel: null,
    lastActiveAt: null,
    secondsTotal: 0,
    secondsByStage: {},
    assessmentCorrect: 0,
    assessmentTotal: 0,
    simulationCorrect: 0,
    simulationTotal: 0,
    ...over,
  };
}

/** The figure under a stat card's label at the top of the list. */
function stat(html: string, label: string): string | undefined {
  const at = html.indexOf(`>${label}</p>`);
  if (at < 0) return undefined;
  return html.slice(at).match(/<p class="text-2xl font-bold">([^<]*)<\/p>/)?.[1];
}

describe("RealFacilitatorView: “Active in the last 24h”", () => {
  // Review finding 5: a change to this figure isn't part of spec 9.3, and
  // the staff guide (docs/staff-guide.md, "The figures at the top") says
  // what it counts today: every learner with any progress, however long
  // ago. It keeps that count until the owner signs off a change and the
  // guide changes with it.
  it("counts the learners with any progress, as the staff guide says", () => {
    const html = renderToStaticMarkup(
      createElement(RealFacilitatorView, {
        learners: [
          // Halfway, last seen three days ago.
          learner({ id: "a", progressPct: 50, lastActiveAt: hoursAgo(72) }),
          // No lesson done yet, but answered something two hours ago.
          learner({ id: "b", progressPct: 0, lastActiveAt: hoursAgo(2) }),
          // Finished, the day before yesterday.
          learner({ id: "c", progressPct: 100, completed: true, lastActiveAt: hoursAgo(25) }),
          // Hasn't started.
          learner({ id: "d" }),
        ],
      })
    );
    expect(stat(html, "Active in the last 24h")).toBe("2/4");
  });

  it("says “24 hours” in every language", () => {
    expect(en.facilitator.activeNow).toBe("Active in the last 24h");
    expect(de.facilitator.activeNow).toBe("Aktiv in den letzten 24h");
    expect(el.facilitator.activeNow).toBe("Ενεργοί τις τελευταίες 24 ώρες");
  });
});

/** "Currently on" in a learner's activity panel. */
function currentlyOn(html: string): string | undefined {
  return html.match(/<p class="mt-1 text-sm font-semibold leading-tight[^"]*">([^<]*)<\/p><p[^>]*>Currently on<\/p>/)?.[1];
}

/** The time-per-lesson rows: [name, time]. */
function timeRows(html: string): [string, string][] {
  return [
    ...html.matchAll(
      /<span class="w-24 flex-shrink-0[^"]*">([^<]*)<\/span>.*?<span class="tabular-nums[^"]*">([^<]*)<\/span>/g
    ),
  ].map((m) => [m[1], m[2]]);
}

const panel = (l: Partial<FacilitatorLearner>) =>
  renderToStaticMarkup(createElement(ActivityPanel, { learner: learner(l) }));

describe("RealFacilitatorView: where a learner is, by the course's step names (spec 6, D58)", () => {
  it("names a lesson of the course's own by its step name", () => {
    expect(currentlyOn(panel({ currentStage: "s-ownstory", currentStageLabel: "Your own story" }))).toBe(
      "Your own story"
    );
  });

  it("names a renamed standard lesson as the learner sees it", () => {
    expect(currentlyOn(panel({ currentStage: "concept", currentStageLabel: "The big idea" }))).toBe(
      "The big idea"
    );
  });

  it("keeps the standard name for a built-in course's lesson, and says when the learner is done", () => {
    expect(currentlyOn(panel({ currentStage: "concept" }))).toBe("Skill concept");
    expect(currentlyOn(panel({ currentStage: "complete" }))).toBe("Completed");
    expect(currentlyOn(panel({}))).toBe("—");
  });

  it("never shows a lesson's id when its name is missing", () => {
    expect(currentlyOn(panel({ currentStage: "s-ownstory" }))).toBe("—");
  });
});

describe("RealFacilitatorView: time per lesson (spec 6)", () => {
  it("shows time in the course's own lessons as one “Other lessons” row, and the rows add up to the time on task", () => {
    const html = panel({
      secondsTotal: 60 + 30 + 120 + 45,
      secondsByStage: { context: 60, concept: 30, "s-ownstory": 120, "s-another1": 45 },
    });
    expect(timeRows(html)).toEqual([
      ["Context", "1m"],
      ["Skill concept", "30s"],
      ["Other lessons", "2m"],
    ]);
    expect(html).toMatch(/<p class="mt-1 text-sm font-semibold leading-tight[^"]*">4m<\/p><p[^>]*>Time on task<\/p>/);
  });

  it("counts time recorded without a lesson under “Other lessons” too, as the statistics do", () => {
    const html = panel({ secondsTotal: 90, secondsByStage: { context: 60 } });
    expect(timeRows(html)).toEqual([
      ["Context", "1m"],
      ["Other lessons", "30s"],
    ]);
  });

  it("has no “Other lessons” row when all the time was on the seven standard lessons", () => {
    const html = panel({ secondsTotal: 90, secondsByStage: { context: 60, reflection: 30 } });
    expect(timeRows(html)).toEqual([
      ["Context", "1m"],
      ["Reflection", "30s"],
    ]);
  });
});
