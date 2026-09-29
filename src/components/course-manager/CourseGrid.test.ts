import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import type { CourseGridEntry } from "@/lib/cms/course-admin-types";

// Real English messages behind next-intl's API, so a renamed key shows up
// here as a raw key path rather than at runtime.
const translator = (namespace: string) =>
  createTranslator({ locale: "en", messages: en, namespace: namespace as never });
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useTranslations: (namespace: string) => translator(namespace),
}));
// Stand-in for the locale-aware Link: "/en" + pathname + query, as
// next-intl builds it with localePrefix "always".
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: ({
      href,
      prefetch,
      ...rest
    }: {
      href: string | { pathname: string; query?: Record<string, string> };
      prefetch?: boolean;
    }) => {
      void prefetch;
      const url =
        typeof href === "string"
          ? `/en${href}`
          : `/en${href.pathname}?${new URLSearchParams(href.query)}`;
      return h("a", { href: url, ...rest });
    },
    useRouter: () => ({ push: () => {} }),
  };
});
// NewCourseForm (behind "New course") calls this server action; importing
// the real one would load the auth stack, which needs a Next.js runtime.
vi.mock("@/app/actions/course", () => ({ createCourse: vi.fn() }));

const { CourseGrid } = await import("./CourseGrid");

const DAY = 86_400_000;

const BUILT_IN: CourseGridEntry = {
  slug: "workplace-conflict",
  title: "Handling a small workplace conflict",
  tagline: "20 minutes · no grades",
  clusterLabel: "Communication",
  kind: "bundled",
  status: "published",
  durationMinutes: 20,
  enrolled: 12,
  lessonKeys: [
    "context",
    "concept",
    "behaviour",
    "simulation",
    "scenario",
    "reflection",
    "assessment",
  ],
  languages: {
    en: { state: "complete", covered: 7, total: 7 },
    de: { state: "partial", covered: 3, total: 7 },
    el: { state: "missing", covered: 0, total: 7 },
  },
  lastEdited: new Date(Date.now() - 3 * DAY - 60_000).toISOString(),
};

const CREATED: CourseGridEntry = {
  slug: "asking-for-what-you-need",
  title: "Asking for what you need",
  tagline: "",
  clusterLabel: "Skill",
  kind: "cms",
  status: "draft",
  durationMinutes: 15,
  enrolled: 0,
  lessonKeys: ["context", "concept", "behaviour", "reflection"],
  languages: {
    en: { state: "partial", covered: 1, total: 4 },
    de: { state: "missing", covered: 0, total: 4 },
    el: { state: "missing", covered: 0, total: 4 },
  },
  lastEdited: null,
};

async function render(entries: CourseGridEntry[]): Promise<string> {
  const { prelude } = await prerenderToNodeStream(
    createElement(CourseGrid, { entries, locale: "en" })
  );
  let html = "";
  for await (const chunk of prelude) html += chunk.toString();
  // Drop React's text separators so assertions read like the page does.
  return html.replaceAll("<!-- -->", "");
}

/** The markup of one card, found by its title id. */
function card(html: string, slug: string): string {
  const start = html.indexOf(`<article aria-labelledby="course-${slug}-title"`);
  expect(start, `card for ${slug}`).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</article>", start));
}

describe("CourseGrid", () => {
  it("leads with the page heading and a closed New course card", async () => {
    const html = await render([BUILT_IN]);
    expect(html).toMatch(/<h1[^>]*>Manage courses<\/h1>/);
    const button = /<button[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"[^>]*>New course/.exec(
      html
    );
    expect(button, "New course is a disclosure button").not.toBeNull();
    // aria-controls points at a real (hidden) element even while closed.
    expect(html).toContain(`id="${button![1]}" hidden=""`);
    expect(html.indexOf("New course")).toBeLessThan(html.indexOf("<article"));
    expect(html).not.toContain(en.courseManager.grid.empty);
  });

  it("says so when there are no courses yet", async () => {
    const html = await render([]);
    expect(html).toContain(en.courseManager.grid.empty);
    expect(html).not.toContain("<article");
  });

  it("makes the whole card a link to the course page, named by the title", async () => {
    const c = card(await render([BUILT_IN]), BUILT_IN.slug);
    expect(c).toMatch(
      /<h2 id="course-workplace-conflict-title"[^>]*><a href="\/en\/content\/courses\/workplace-conflict" data-card-link="true" class="[^"]*after:absolute after:inset-0[^"]*">Handling a small workplace conflict<\/a><\/h2>/
    );
  });

  it("links every lesson, numbered in learner order", async () => {
    const html = await render([BUILT_IN, CREATED]);
    const builtIn = card(html, BUILT_IN.slug);
    expect(builtIn).toContain('aria-label="Lessons in Handling a small workplace conflict"');
    expect(builtIn).toContain(
      '<a href="/en/content/courses/workplace-conflict?lesson=behaviour" aria-label="Edit lesson 3: Behaviour model"'
    );
    expect(builtIn.match(/\?lesson=/g)).toHaveLength(7);

    // A created course without interactive lessons: reflection is lesson 4.
    const created = card(html, CREATED.slug);
    expect(created).toContain(
      '<a href="/en/content/courses/asking-for-what-you-need?lesson=reflection" aria-label="Edit lesson 4: Reflection"'
    );
    expect(created.match(/\?lesson=/g)).toHaveLength(4);
  });

  it("previews the course as a learner, in a new tab that says so", async () => {
    const c = card(await render([BUILT_IN]), BUILT_IN.slug);
    expect(c).toMatch(
      /<a href="\/en\/learner\/course\/workplace-conflict\?preview=1" target="_blank" rel="noopener"[^>]*>.*Preview as learner.*<span class="sr-only"> \(opens in a new tab\)<\/span><\/a>/
    );
  });

  it("names status and kind in words, not colour alone, right after the title", async () => {
    const html = await render([BUILT_IN, CREATED]);
    const builtIn = card(html, BUILT_IN.slug);
    expect(builtIn).toMatch(/<\/h2><div[^>]*><span[^>]*>.*?Published<\/span><span[^>]*>Built-in<\/span><\/div>/);
    expect(card(html, CREATED.slug)).toMatch(/>Draft<\/span><span[^>]*>Created here<\/span>/);
  });

  it("shows lessons, enrolment and last edit as labelled facts", async () => {
    const html = await render([BUILT_IN, CREATED]);
    const builtIn = card(html, BUILT_IN.slug);
    expect(builtIn).toMatch(/<dt class="sr-only">Lessons<\/dt><dd[^>]*>.*?7 lessons<\/dd>/);
    expect(builtIn).toMatch(/<dt class="sr-only">Enrolled<\/dt><dd[^>]*>.*?12 learners enrolled<\/dd>/);
    expect(builtIn).toMatch(
      new RegExp(`<time dateTime="${BUILT_IN.lastEdited}" title="[^"]+UTC"[^>]*>Edited 3 days ago</time>`)
    );

    const created = card(html, CREATED.slug);
    expect(created).toContain("4 lessons");
    expect(created).toContain("Nobody enrolled yet");
    expect(created).toContain("Not edited yet");
    expect(created).not.toContain("<time");
  });

  it("gives each language chip a spoken state as well as its icon", async () => {
    const c = card(await render([BUILT_IN]), BUILT_IN.slug);
    expect(c).toContain('<span class="sr-only">English: complete</span>');
    expect(c).toContain('<span class="sr-only">German: 3 of 7 lessons</span>');
    expect(c).toContain('<span class="sr-only">Greek: not started</span>');
    expect(c).toContain("lucide-check");
    expect(c).toContain("lucide-circle-dashed");
    expect(c).toContain("lucide-circle ");
  });
});
