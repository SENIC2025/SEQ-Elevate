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

const { RealFacilitatorView } = await import("./RealFacilitatorView");

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
  const learners = [
    // Halfway, but last seen three days ago.
    learner({ id: "a", progressPct: 50, lastActiveAt: hoursAgo(72) }),
    // No lesson done yet, but answered something two hours ago.
    learner({ id: "b", progressPct: 0, lastActiveAt: hoursAgo(2) }),
    // Finished, the day before yesterday's evening.
    learner({ id: "c", progressPct: 100, completed: true, lastActiveAt: hoursAgo(25) }),
    // Hasn't started.
    learner({ id: "d" }),
  ];

  it("counts the learners active in the last 24 hours, not those with any progress", () => {
    const html = renderToStaticMarkup(createElement(RealFacilitatorView, { learners, now: NOW }));
    expect(stat(html, "Active in the last 24h")).toBe("1/4");
  });

  it("counts a learner active exactly 24 hours ago, and one whose clock ran ahead of the server's", () => {
    const html = renderToStaticMarkup(
      createElement(RealFacilitatorView, {
        learners: [
          learner({ id: "e", lastActiveAt: hoursAgo(24) }),
          learner({ id: "f", lastActiveAt: hoursAgo(-0.1) }),
          learner({ id: "g", lastActiveAt: hoursAgo(24.01) }),
        ],
        now: NOW,
      })
    );
    expect(stat(html, "Active in the last 24h")).toBe("2/3");
  });

  it("says “24 hours” in every language", () => {
    expect(en.facilitator.activeNow).toBe("Active in the last 24h");
    expect(de.facilitator.activeNow).toBe("Aktiv in den letzten 24h");
    expect(el.facilitator.activeNow).toBe("Ενεργοί τις τελευταίες 24 ώρες");
  });
});
