import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import type { CourseSummary } from "@/lib/cms/types";
import type { EnrollmentSummary } from "./LearnerDashboard";

// Real English messages behind next-intl's API, so a renamed key shows up
// here as a raw key path rather than at runtime.
const translator = (namespace: string) =>
  createTranslator({ locale: "en", messages: en, namespace: namespace as never });
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useTranslations: (namespace: string) => translator(namespace),
}));
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: ({ href, ...rest }: { href: string }) =>
      h("a", { href: `/en${href}`, ...rest }),
  };
});

// The guest's progress, as the store holds it; a signed-in learner's comes
// from `enrollments` instead.
const guest = {
  courseSlug: null as string | null,
  stagesCompleted: [] as string[],
  sectionsCompleted: [] as string[],
  completedAt: null as string | null,
};
vi.mock("@/store/demo-state", () => ({
  useDemoState: () => ({
    state: {
      badges: [],
      course: {
        courseTitle: null,
        simulation: null,
        scenario: { root: null, followup: null, rootLabel: null, followupLabel: null },
        reflection: { p1: "", p2: "", p3: "" },
        assessment: { answers: {}, checked: false },
        responses: {},
        ...guest,
      },
    },
  }),
}));

const { LearnerDashboard } = await import("./LearnerDashboard");

const NARRATIVE_ONLY = ["context", "concept", "behaviour", "reflection"] as const;
const ALL_SEVEN = [
  "context",
  "concept",
  "behaviour",
  "simulation",
  "scenario",
  "reflection",
  "assessment",
] as const;

/** A course created in the CMS, with only its four narrative lessons. */
const CREATED: CourseSummary = {
  slug: "asking-for-help",
  cluster: "communicationEi",
  title: "Asking for help",
  clusterLabel: "Communication",
  tagline: "Short and real",
  durationMinutes: 15,
  status: "published",
  stageKeys: [...NARRATIVE_ONLY],
};

/** A built-in course: all seven lessons. */
const BUILT_IN: CourseSummary = {
  slug: "workplace-conflict",
  cluster: "communicationEi",
  title: "Handling a small workplace conflict",
  clusterLabel: "Communication",
  tagline: "20 minutes",
  durationMinutes: 20,
  status: "published",
  stageKeys: [...ALL_SEVEN],
};

function render(
  courses: CourseSummary[],
  enrollments: EnrollmentSummary[] | null
): string {
  return renderToStaticMarkup(
    createElement(LearnerDashboard, { courses, enrollments })
  );
}

/** Every progress bar's value and accessible name, in page order. */
function bars(html: string) {
  return [
    ...html.matchAll(
      /role="progressbar" aria-valuenow="(\d+)"[^>]*aria-label="([^"]*)"/g
    ),
  ].map((m) => ({ value: Number(m[1]), label: m[2] }));
}

/** The journey checklist's items' markup (the last list on the page). */
function checklistItems(html: string): string[] {
  const lists = [...html.matchAll(/<ul class="mt-3 space-y-1.5">(.*?)<\/ul>/g)];
  const last = lists.at(-1)?.[1] ?? "";
  return [...last.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => m[1]);
}

/** The journey checklist's items, as seen (text for screen readers only left out). */
function checklist(html: string): string[] {
  return checklistItems(html).map((item) =>
    item.replace(/<span class="sr-only">.*?<\/span>/g, "").replace(/<[^>]+>/g, "")
  );
}

/** The journey checklist's items, as a screen reader reads them (icons are hidden). */
function checklistSpoken(html: string): string[] {
  return checklistItems(html).map((item) => item.replace(/<svg.*?<\/svg>/g, "").replace(/<[^>]+>/g, ""));
}

/** The hero's course title (the page's only h2 after "Current mission"). */
function hero(html: string): string | undefined {
  return html.match(/Current mission<\/span><h2[^>]*>([^<]*)<\/h2>/)?.[1];
}

beforeEach(() => {
  guest.courseSlug = null;
  guest.stagesCompleted = [];
  guest.sectionsCompleted = [];
  guest.completedAt = null;
});

describe("LearnerDashboard progress", () => {
  it("shows a finished four-lesson course as 100%, with its own four steps", () => {
    const html = render(
      [CREATED],
      [
        {
          slug: CREATED.slug,
          stages: [...NARRATIVE_ONLY],
          stagesCompleted: 4,
          completed: true,
        },
      ]
    );
    // Overall bar, then the journey bar (the hero bar shows only while the
    // course is in progress).
    expect(bars(html)).toEqual([
      { value: 100, label: "100%" },
      { value: 100, label: "4/4" },
    ]);
    expect(checklist(html)).toEqual([
      "Context",
      "Skill concept",
      "Behaviour model",
      "Reflection",
    ]);
  });

  it("divides by each course's own lessons for the overall bar", () => {
    const html = render(
      [CREATED, BUILT_IN],
      [
        {
          slug: CREATED.slug,
          stages: [...NARRATIVE_ONLY],
          stagesCompleted: 4,
          completed: true,
        },
        {
          slug: BUILT_IN.slug,
          stages: ["context"],
          stagesCompleted: 1,
          completed: false,
        },
      ]
    );
    // (4 + 1) of (4 + 7) lessons = 45%.
    expect(bars(html)[0]).toEqual({ value: 45, label: "45%" });
  });

  it("only counts completed steps the course actually has", () => {
    // Saved progress can name a step the course no longer has, e.g. a
    // practice an editor took out again.
    const html = render(
      [CREATED],
      [
        {
          slug: CREATED.slug,
          stages: ["context", "concept", "simulation"],
          stagesCompleted: 3,
          completed: false,
        },
      ]
    );
    const [overall, hero, journey] = bars(html);
    expect(overall.value).toBe(50);
    expect(hero).toEqual({ value: 50, label: "2/4 your journey" });
    expect(journey).toEqual({ value: 50, label: "2/4" });
  });

  it("uses the course's own steps for a guest too", () => {
    guest.courseSlug = CREATED.slug;
    guest.stagesCompleted = [...NARRATIVE_ONLY];
    guest.completedAt = "2026-10-01T10:00:00.000Z";
    const html = render([CREATED], null);
    expect(bars(html)).toEqual([
      { value: 100, label: "100%" },
      { value: 100, label: "4/4" },
    ]);
    expect(checklist(html)).toHaveLength(4);
  });

  it("keeps all seven steps for a built-in course", () => {
    const html = render(
      [BUILT_IN],
      [
        {
          slug: BUILT_IN.slug,
          stages: ["context", "concept"],
          stagesCompleted: 2,
          completed: false,
        },
      ]
    );
    expect(bars(html).at(-1)).toEqual({ value: 29, label: "2/7" });
    expect(checklist(html)).toHaveLength(7);
  });
});

/** A course with lessons of its own (D64), under its step names (D58). */
const OWN = "s-ownstory";
const HIDDEN = "s-hidden01";
const FLEXIBLE: CourseSummary = {
  slug: "speaking-up",
  cluster: "communicationEi",
  title: "Speaking up",
  clusterLabel: "Communication",
  tagline: "Your own lessons",
  durationMinutes: 15,
  status: "published",
  stageKeys: ["context", OWN, "concept"],
  unseenStageKeys: [HIDDEN, "behaviour"],
  stageLabels: { context: "Warm-up", [OWN]: "Your own story", concept: "Skill concept" },
};

describe("LearnerDashboard, Release 2: a course's own lessons (spec 6, D58, D64)", () => {
  it("names each step in “Your journey” as the player does, the course's own lessons included", () => {
    const html = render(
      [FLEXIBLE],
      [{ slug: FLEXIBLE.slug, stages: ["context", OWN], stagesCompleted: 2, completed: false }]
    );
    expect(checklist(html)).toEqual(["Warm-up", "Your own story", "Skill concept"]);
    expect(bars(html).at(-1)).toEqual({ value: 67, label: "2/3" });
  });

  it("keeps counting a lesson the learner finished that the course no longer shows, and says so under the list", () => {
    const html = render(
      [FLEXIBLE],
      [{ slug: FLEXIBLE.slug, stages: ["context", HIDDEN], stagesCompleted: 2, completed: false }]
    );
    // Three lessons shown, one finished lesson hidden since: 2 of 4.
    const [overall, heroBar, journey] = bars(html);
    expect(overall.value).toBe(50);
    expect(heroBar).toEqual({ value: 50, label: "2/4 your journey" });
    expect(journey).toEqual({ value: 50, label: "2/4" });
    expect(checklist(html)).toEqual([
      "Warm-up",
      "Your own story",
      "Skill concept",
      "and 1 completed lesson no longer in the course",
    ]);
  });

  it("tells a screen reader which lessons are done, not only by icon and colour", () => {
    // Review finding 8: the ticks are hidden from screen readers, so every
    // step read the same, while the line under them says "completed".
    const html = render(
      [FLEXIBLE],
      [{ slug: FLEXIBLE.slug, stages: ["context", HIDDEN], stagesCompleted: 2, completed: false }]
    );
    expect(checklistSpoken(html)).toEqual([
      "Warm-up, done",
      "Your own story",
      "Skill concept",
      "and 1 completed lesson no longer in the course",
    ]);
    // The ticks keep their size when a long step name wraps.
    for (const item of checklistItems(html)) {
      expect(item).toMatch(/^<(svg|span)[^>]*class="[^"]*\bflex-shrink-0\b/);
    }
  });

  it("says the language of a step name that isn't the page's (WCAG 3.1.2)", () => {
    // Review finding 7a: on a German page, a lesson of the course's own
    // named only in English.
    const html = render(
      [{ ...FLEXIBLE, stageLabelLangs: { [OWN]: "en" } }],
      [{ slug: FLEXIBLE.slug, stages: ["context"], stagesCompleted: 1, completed: false }]
    );
    const items = checklistItems(html);
    expect(items[1]).toContain('<span lang="en">Your own story</span>');
    expect(items[0]).not.toContain("lang=");
    expect(items[2]).not.toContain("lang=");
  });

  it("says nothing of lessons no longer shown that the learner never finished", () => {
    const html = render(
      [FLEXIBLE],
      [{ slug: FLEXIBLE.slug, stages: ["context"], stagesCompleted: 1, completed: false }]
    );
    expect(checklist(html)).toEqual(["Warm-up", "Your own story", "Skill concept"]);
    expect(html).not.toContain("no longer in the course");
  });

  it("counts a guest's own lessons from the browser's store", () => {
    guest.courseSlug = FLEXIBLE.slug;
    guest.stagesCompleted = ["context"];
    guest.sectionsCompleted = [OWN];
    const html = render([FLEXIBLE], null);
    expect(bars(html).at(-1)).toEqual({ value: 67, label: "2/3" });
  });
});

describe("LearnerDashboard, Release 2: the hero is the course the learner is in (spec 6)", () => {
  const OTHER: CourseSummary = { ...CREATED, slug: "saying-no", title: "Saying no" };
  const COMING: CourseSummary = { ...CREATED, slug: "later", title: "Later", comingSoon: true };
  const at = (hoursAgo: number) => new Date(Date.UTC(2026, 9, 20, 12) - hoursAgo * 3_600_000).toISOString();

  it("follows the course the learner was last in and hasn't finished", () => {
    const html = render(
      [BUILT_IN, CREATED, FLEXIBLE, OTHER],
      [
        { slug: BUILT_IN.slug, stages: [...ALL_SEVEN], stagesCompleted: 7, completed: true, updatedAt: at(0) },
        { slug: CREATED.slug, stages: ["context"], stagesCompleted: 1, completed: false, updatedAt: at(48) },
        { slug: FLEXIBLE.slug, stages: [OWN], stagesCompleted: 1, completed: false, updatedAt: at(1) },
        { slug: OTHER.slug, stages: [], stagesCompleted: 0, completed: false, updatedAt: at(3) },
      ]
    );
    expect(hero(html)).toBe("Speaking up");
    // Its journey and its bar are the hero's.
    expect(checklist(html)).toEqual(["Warm-up", "Your own story", "Skill concept"]);
    expect(bars(html)[1]).toEqual({ value: 33, label: "1/3 your journey" });
    expect(html).toContain('href="/en/learner/course/speaking-up"><button');
  });

  it("is the first published course when no course is under way", () => {
    expect(hero(render([COMING, CREATED, BUILT_IN], null))).toBe("Asking for help");
    const html = render(
      [COMING, CREATED, BUILT_IN],
      [{ slug: BUILT_IN.slug, stages: [...ALL_SEVEN], stagesCompleted: 7, completed: true, updatedAt: at(0) }]
    );
    expect(hero(html)).toBe("Asking for help");
  });

  it("is never a course the learner can't open from the list", () => {
    const html = render(
      [COMING, BUILT_IN, CREATED],
      [
        { slug: COMING.slug, stages: ["context"], stagesCompleted: 1, completed: false, updatedAt: at(0) },
        { slug: "unpublished-since", stages: ["context"], stagesCompleted: 1, completed: false, updatedAt: at(0) },
        { slug: CREATED.slug, stages: ["context"], stagesCompleted: 1, completed: false, updatedAt: at(5) },
      ]
    );
    expect(hero(html)).toBe("Asking for help");
    expect(
      hero(
        render(
          [COMING, BUILT_IN],
          [{ slug: "unpublished-since", stages: [], stagesCompleted: 0, completed: false, updatedAt: at(0) }]
        )
      )
    ).toBe("Handling a small workplace conflict");
  });

  it("follows a guest's course in the browser while it is under way", () => {
    guest.courseSlug = FLEXIBLE.slug;
    guest.sectionsCompleted = [OWN];
    expect(hero(render([BUILT_IN, FLEXIBLE], null))).toBe("Speaking up");
    guest.completedAt = "2026-10-01T10:00:00.000Z";
    expect(hero(render([BUILT_IN, FLEXIBLE], null))).toBe("Handling a small workplace conflict");
  });
});
