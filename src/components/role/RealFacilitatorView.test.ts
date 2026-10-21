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
    testAccount: false,
    formerStaff: false,
    videoAnswered: 0,
    videoCorrect: 0,
    currentCourse: null,
    currentStage: null,
    currentStageLabel: null,
    currentCluster: null,
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

describe("RealFacilitatorView: an empty roster (SP1)", () => {
  it("names the viewer's organisation when it has no learners yet", () => {
    const html = renderToStaticMarkup(createElement(RealFacilitatorView, { learners: [], now: NOW, organisation: "Pro Arbeit" }));
    expect(html).toContain("No learners at Pro Arbeit yet.");
    expect(html).not.toContain(en.facilitator.noLearners);
  });

  it("says the project has no learners yet to a viewer of the whole project", () => {
    const html = renderToStaticMarkup(createElement(RealFacilitatorView, { learners: [], now: NOW, organisation: null }));
    expect(html).toContain(en.facilitator.noLearners);
    expect(html).not.toContain("No learners at");
  });
});

describe("RealFacilitatorView: “Active in the last 24h”", () => {
  // It counts what it says: learners whose last activity — lastActiveAt,
  // the "Last active" of their activity panel — is at most a day before the
  // server's time of the request (owner's decision at integration; Release
  // 1 counted every learner with any progress, however long ago).
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

  it("counts a learner active exactly 24 hours ago, and one whose time is after the server's", () => {
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

  it("counts from the server's time it is given, not the browser's clock", () => {
    // The page as sent and the page once it runs show the same figure:
    // a browser whose clock is two days ahead still counts learner b.
    vi.useFakeTimers({ now: NOW + 48 * 3_600_000 });
    try {
      const html = renderToStaticMarkup(createElement(RealFacilitatorView, { learners, now: NOW }));
      expect(stat(html, "Active in the last 24h")).toBe("1/4");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says “24 hours” in every language", () => {
    expect(en.facilitator.activeNow).toBe("Active in the last 24h");
    expect(de.facilitator.activeNow).toBe("Aktiv in den letzten 24h");
    expect(el.facilitator.activeNow).toBe("Ενεργοί τις τελευταίες 24 ώρες");
  });
});

/** "Currently on" in a learner's activity panel. */
function currentlyOn(html: string): string | undefined {
  return currentlyOnTag(html)?.[2];
}

/** "Currently on"'s value: [its tag's attributes, its text]. */
function currentlyOnTag(html: string): [string, string, string] | undefined {
  const m = html.match(/<p( class="mt-1 text-sm font-semibold leading-tight[^"]*"[^>]*)>([^<]*)<\/p><p[^>]*>Currently on<\/p>/);
  return m ? [m[0], m[1], m[2]] : undefined;
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

  it("says the language of a step name that isn't the page's (WCAG 3.1.2)", () => {
    // Review finding 7a: named only in English, on a German page.
    const named = currentlyOnTag(
      panel({ currentStage: "s-ownstory", currentStageLabel: "Your own story", currentStageLabelLang: "en" })
    );
    expect(named?.[2]).toBe("Your own story");
    expect(named?.[1]).toContain(' lang="en"');
    expect(currentlyOnTag(panel({ currentStage: "concept" }))?.[1]).not.toContain("lang=");
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

/*
 * UC1 (spec 4.5, 7.4, D80–D82): the server sends a learner's Comp Card only
 * as far as it is shared with the viewer's organisation (compCard null
 * otherwise), so the screen shows the shared fields and confidence, or
 * "Nothing shared with you." — never a field "redacted" on screen. The
 * scenario choice is progress, not the card: it is in the Activity panel.
 * The roster counts the cards shared with the viewer, and labels test
 * accounts and former staff.
 */
const SHARED = {
  fields: { wentWell: "I stayed calm", improve: "Ask earlier" },
  confidence: 4 as const,
  sharedAt: "2026-11-25T10:00:00.000Z",
};

const { CompCardPanel, LearnerLabels } = await import("./RealFacilitatorView");
const cardPanel = (card: FacilitatorLearner["compCard"]) =>
  renderToStaticMarkup(createElement(CompCardPanel, { card })).replace(/&#x27;/g, "'");

describe("RealFacilitatorView: the Comp Card, as shared with the viewer (UC1)", () => {
  it("shows the fields shared and the confidence", () => {
    const html = cardPanel(SHARED);
    expect(html).toContain("I stayed calm");
    expect(html).toContain("Ask earlier");
    expect(html).toContain(`4/5 — ${en.compCard.confidenceLabels["4"]}`);
    expect(html).not.toContain(en.facilitator.notShared);
  });

  it("names only the fields that reached it: a field hidden or left empty isn't a row", () => {
    const html = cardPanel(SHARED);
    expect(html).toContain(en.compCard.fieldWentWell);
    expect(html).toContain(en.compCard.fieldImprove);
    expect(html).not.toContain(en.compCard.fieldDifficult);
    expect(html).not.toContain(en.compCard.fieldBehaviour);
    // A confidence hidden by the template reaches it as null.
    expect(cardPanel({ ...SHARED, confidence: null })).not.toContain(en.compCard.fieldConfidence);
  });

  it("says “Nothing shared with you.” when nothing is", () => {
    const html = cardPanel(null);
    expect(html).toContain("Nothing shared with you.");
    expect(html).not.toContain(en.compCard.fieldWentWell);
  });

  it("never shows a field as redacted on screen", () => {
    for (const html of [cardPanel(SHARED), cardPanel(null)]) {
      expect(html).not.toMatch(/redacted|chose not to share/i);
    }
  });

  it("doesn't hold the scenario choice: that is progress, in the Activity panel", () => {
    expect(cardPanel(SHARED)).not.toContain(en.compCard.fieldScenario);
  });
});

describe("RealFacilitatorView: the scenario choice is in the Activity panel (D82)", () => {
  it("shows the choice the learner made, with the quiz and practice results", () => {
    const html = panel({ scenario: [{ text: "Speak to Sam in private" }, { text: "Tell Sam it's fine" }] });
    const quiz = html.indexOf(`${en.facilitator.quizPractice}:`);
    const scenario = html.indexOf(en.course.stageLabel.scenario);
    expect(scenario).toBeGreaterThan(-1);
    expect(quiz).toBeGreaterThan(-1);
    expect(html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'")).toContain(
      "Speak to Sam in private → Tell Sam it's fine"
    );
  });

  it("marks a part of the choice written in another language than the page's (WCAG 3.1.2)", () => {
    // Review R3: a created course's choice not translated yet reads in
    // English on a German page.
    const html = panel({ scenario: [{ text: "Sam unter vier Augen ansprechen" }, { text: "Tell Sam it's fine", lang: "en" }] });
    expect(html.replace(/&#x27;/g, "'")).toContain('<span lang="en">Tell Sam it\'s fine</span>');
    expect(html).toMatch(/<span>Sam unter vier Augen ansprechen<\/span>/);
  });
});

describe("RealFacilitatorView: the roster (spec 4.5, 7.4)", () => {
  const roster = (learners: FacilitatorLearner[]) =>
    renderToStaticMarkup(createElement(RealFacilitatorView, { learners, now: NOW }));
  /** A learner's row in the list. */
  const row = (html: string, name: string) => {
    const start = html.indexOf(`>${name}</p>`);
    return start < 0 ? "" : html.slice(start, html.indexOf("</li>", start));
  };

  it("counts the Comp Cards shared with the viewer", () => {
    const html = roster([
      learner({ id: "a", name: "Ana", compCard: SHARED }),
      learner({ id: "b", name: "Ben" }),
      learner({ id: "c", name: "Cleo" }),
    ]);
    expect(stat(html, "Comp Cards shared with you")).toBe("1/3");
  });

  it("labels a test account and a former staff member, and nobody else", () => {
    const html = roster([
      learner({ id: "t", name: "Tess", testAccount: true }),
      learner({ id: "f", name: "Finn", formerStaff: true }),
      learner({ id: "b", name: "Both", testAccount: true, formerStaff: true }),
      learner({ id: "r", name: "Rosa" }),
    ]);
    expect(row(html, "Tess")).toContain("Test account");
    expect(row(html, "Tess")).not.toContain("Former staff");
    expect(row(html, "Finn")).toContain("Former staff");
    expect(row(html, "Finn")).not.toContain("Test account");
    expect(row(html, "Both")).toContain("Test account");
    expect(row(html, "Both")).toContain("Former staff");
    expect(row(html, "Rosa")).not.toMatch(/Test account|Former staff/);
  });

  it("gives the labels in the page's language", () => {
    const labels = renderToStaticMarkup(
      createElement(LearnerLabels, { learner: learner({ testAccount: true, formerStaff: true }) })
    );
    expect(labels).toContain(en.facilitator.testAccount);
    expect(labels).toContain(en.facilitator.formerStaff);
    expect(renderToStaticMarkup(createElement(LearnerLabels, { learner: learner({}) }))).toBe("");
  });
});

describe("RealFacilitatorView: no field is hidden on screen any more (spec 4.6)", () => {
  it.each(Object.entries({ en, de, el }))("so %s has no words for one", (_, messages) => {
    expect(messages.facilitator).not.toHaveProperty("redacted");
    expect(messages.facilitator).not.toHaveProperty("redactedHint");
  });
});
