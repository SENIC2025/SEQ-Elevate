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
  completedAt: null as string | null,
};
vi.mock("@/store/demo-state", () => ({
  useDemoState: () => ({
    state: { badges: [], course: { ...guest } },
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

/** The journey checklist's items (the last list on the page). */
function checklist(html: string): string[] {
  const lists = [...html.matchAll(/<ul class="mt-3 space-y-1.5">(.*?)<\/ul>/g)];
  const last = lists.at(-1)?.[1] ?? "";
  return [...last.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, "")
  );
}

beforeEach(() => {
  guest.courseSlug = null;
  guest.stagesCompleted = [];
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
