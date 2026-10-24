import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createElement, type FC, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";

/*
 * Release 4 spec 5.4 (U19, D109): a created course's references and
 * bibliography on a learner page of its own. It answers "not found" for an
 * unknown or built-in course, a course without a list, a draft or archived
 * course for anyone who can't edit it, and while R4_FURTHER_READING is off;
 * its tab title then never names the course. The list is in the language
 * the course is shown in (Release 3, D90), else English, else the first
 * written, marked with its language when that isn't the page's. Opened from
 * a lesson (?from=lesson) it says to close the tab; otherwise it links back
 * to the course.
 */

const getCourse = vi.fn();
const getCourseStatus = vi.fn();
const getViewerRoles = vi.fn();
const getCourseReferences = vi.fn();
const learnerContentLocale = vi.fn();

const MESSAGES = { en, de, el } as Record<string, unknown>;
const request = vi.hoisted(() => ({ locale: "en" }));

/** next-intl's translator over the real messages, as getTranslations gives it. */
function translator(locale: string, namespace: string) {
  return (key: string, values: Record<string, string> = {}) => {
    const text = `${namespace}.${key}`
      .split(".")
      .reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], MESSAGES[locale]);
    if (typeof text !== "string") throw new Error(`no message ${namespace}.${key} in ${locale}`);
    return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "");
  };
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cms", () => ({ getCourse }));
vi.mock("@/lib/cms/course-overlay", () => ({ getCourseStatus }));
vi.mock("@/lib/server-queries", () => ({ getViewerRoles }));
vi.mock("@/lib/cms/course-references", () => ({ getCourseReferences }));
vi.mock("@/lib/cms/language-ready", () => ({ learnerContentLocale }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: (locale: string) => {
    request.locale = locale;
  },
  getTranslations: async (arg: string | { locale: string; namespace: string }) =>
    typeof arg === "string" ? translator(request.locale, arg) : translator(arg.locale, arg.namespace),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

const { default: Page, generateMetadata, dynamic } = await import("./page");

const SLUG = "speak-up";
const rich = {
  v: 1,
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Author, A. A. (2020). " },
          { type: "text", text: "Title of the work", marks: [{ type: "italic" }] },
          { type: "text", text: ". Publisher. https://doi.org/10.1000/xyz" },
        ],
      },
    ],
  },
};
const LIST_EN = { locale: "en", text: "Author, A. A. (2020). Title of the work. Publisher. https://doi.org/10.1000/xyz", rich };

type Sp = { preview?: string; from?: string };

function setup(o: {
  status?: "draft" | "published" | "archived" | null;
  editor?: boolean;
  /** The language learners get the course in (learnerContentLocale). */
  learnerLocale?: string;
  list?: typeof LIST_EN | { locale: string; text: string } | null;
  title?: string;
}) {
  getCourseStatus.mockResolvedValue(o.status === undefined ? "published" : o.status);
  getViewerRoles.mockResolvedValue(o.editor ? ["CONTENT_EDITOR"] : ["LEARNER"]);
  learnerContentLocale.mockImplementation(async (_p: string, _s: string, requested: string) => o.learnerLocale ?? requested);
  getCourseReferences.mockResolvedValue(o.list === undefined ? LIST_EN : o.list);
  getCourse.mockImplementation(async (_p: string, slug: string, locale: string) => ({
    slug,
    title: o.title ?? `Speak up (${locale})`,
    stages: [],
  }));
}

const IntlProvider = NextIntlClientProvider as FC<{ locale: string; messages: unknown; timeZone: string; children?: ReactNode }>;

/** The page as a request renders it: the server part, then its client parts in the page's language. */
async function visit(locale = "en", sp: Sp = {}): Promise<string> {
  const el = (await Page({
    params: Promise.resolve({ locale, courseId: SLUG }),
    searchParams: Promise.resolve(sp),
  })) as ReactElement;
  return renderToStaticMarkup(createElement(IntlProvider, { locale, messages: MESSAGES[locale], timeZone: "UTC" }, el));
}

async function titleOf(locale = "en", sp: Sp = {}) {
  return (
    await generateMetadata({
      params: Promise.resolve({ locale, courseId: SLUG }),
      searchParams: Promise.resolve(sp),
    })
  ).title;
}

/** The element whose class list holds `cls`, as rendered (its opening tag). */
const openingTag = (html: string, cls: string) => html.match(new RegExp(`<[a-z]+[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`))?.[0];

beforeEach(() => {
  vi.unstubAllEnvs();
  request.locale = "en";
});
afterEach(() => vi.clearAllMocks());

describe("the references page", () => {
  it("is rendered for every request (it reads who views it and live data)", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("shows a published course's list to a learner: the heading, the course, the list set as a reference list", async () => {
    setup({});
    const html = await visit();
    expect(html).toContain(`<h1 class="text-2xl font-bold tracking-tight">${en.courseReferences.title.replace("&", "&amp;")}</h1>`);
    expect(html).toContain(">Speak up (en)</p>");
    const list = openingTag(html, "seq-references");
    expect(list, "the list's container").toBeDefined();
    expect(list).toContain("seq-prose");
    expect(list).not.toContain("lang=");
    expect(html).toContain("<em>Title of the work</em>");
    // The address in the text is a link, opening in a new tab.
    expect(html).toMatch(/<a href="https:\/\/doi\.org\/10\.1000\/xyz"[^>]*target="_blank"/);
    expect(getCourseReferences).toHaveBeenCalledWith("seq-elevate", SLUG, "en");
  });

  it("links back to the course, or, opened from a lesson, says to close the tab instead", async () => {
    setup({});
    const html = await visit();
    expect(html).toContain(`<a href="/learner/course/${SLUG}"`);
    expect(html).toContain(`>${en.courseReferences.back}</a>`);
    expect(html).not.toContain(en.courseReferences.closeTab);

    const fromLesson = await visit("en", { from: "lesson" });
    expect(fromLesson).toContain(en.courseReferences.closeTab);
    expect(fromLesson).not.toContain(en.courseReferences.back);
    expect(fromLesson).not.toContain(`href="/learner/course/${SLUG}"`);
  });

  it("gives a German learner the English list of a course shown in English, marked, and says so", async () => {
    setup({ learnerLocale: "en" });
    const html = await visit("de");
    expect(learnerContentLocale).toHaveBeenCalledWith("seq-elevate", SLUG, "de");
    expect(getCourseReferences).toHaveBeenCalledWith("seq-elevate", SLUG, "en");
    expect(html).toContain(`<h1 class="text-2xl font-bold tracking-tight">${de.courseReferences.title}</h1>`);
    expect(openingTag(html, "seq-references")).toContain('lang="en"');
    expect(html).toContain(de.courseReferences.shownIn.en);
    // The course's title is the English one, marked too.
    expect(html).toContain('lang="en" class="mt-1 text-[var(--muted-foreground)]">Speak up (en)</p>');
    expect(html).toContain(`>${de.courseReferences.back}</a>`);
  });

  it("marks only the list when the course is shown in German but its list is the English one", async () => {
    setup({ learnerLocale: "de", list: { locale: "en", text: "Author (2020)." } });
    const html = await visit("de");
    expect(getCourseReferences).toHaveBeenCalledWith("seq-elevate", SLUG, "de");
    expect(openingTag(html, "seq-references")).toContain('lang="en"');
    expect(html).toContain(de.courseReferences.shownIn.en);
    expect(html).toContain('<p class="mt-1 text-[var(--muted-foreground)]">Speak up (de)</p>');
  });

  it("marks nothing when the list is in the page's language", async () => {
    setup({ learnerLocale: "el", list: { locale: "el", text: "Συγγραφέας (2022)." } });
    const html = await visit("el");
    expect(openingTag(html, "seq-references")).not.toContain("lang=");
    for (const note of Object.values(el.courseReferences.shownIn)) expect(html).not.toContain(note);
    expect(html).toContain("Συγγραφέας (2022).");
  });

  it("answers not found: unknown, built-in or without a list, draft or archived for a learner, and with the switch off", async () => {
    const cases: [string, Parameters<typeof setup>[0], () => void][] = [
      ["an unknown course", { status: null }, () => {}],
      ["a draft, for a learner", { status: "draft" }, () => {}],
      ["an archived course, for a learner", { status: "archived" }, () => {}],
      ["a built-in course, or no list in any language", { list: null }, () => {}],
      ["the switch off, for a learner", {}, () => vi.stubEnv("R4_FURTHER_READING", "off")],
      ["the switch off, for an editor", { editor: true }, () => vi.stubEnv("R4_FURTHER_READING", " OFF ")],
    ];
    for (const [name, o, before] of cases) {
      vi.unstubAllEnvs();
      setup(o);
      before();
      await expect(visit(), name).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(visit("en", { preview: "1" }), `${name}, ?preview=1`).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("lets an editor read a draft's list, in the language asked for, and keeps the preview on the way back", async () => {
    setup({ status: "draft", editor: true, learnerLocale: "en" });
    const html = await visit("de");
    expect(getCourseReferences).toHaveBeenCalledWith("seq-elevate", SLUG, "de");
    expect(html).toContain("Speak up (de)");
    setup({ status: "published", editor: true, learnerLocale: "en" });
    const preview = await visit("de", { preview: "1" });
    expect(getCourseReferences).toHaveBeenLastCalledWith("seq-elevate", SLUG, "de");
    expect(preview).toContain(`<a href="/learner/course/${SLUG}?preview=1"`);
    // Without ?preview=1 an editor reads a published course as learners do.
    await visit("de");
    expect(getCourseReferences).toHaveBeenLastCalledWith("seq-elevate", SLUG, "en");
  });

  it("says in an editor's preview that learners get English until the language is switched on", async () => {
    const notLive = (messages: typeof en, language: string) =>
      messages.coursePlayer.languageNotLive.replaceAll("{language}", language);
    setup({ editor: true, learnerLocale: "en", list: { locale: "de", text: "Autorin (2021)." } });
    expect(await visit("de", { preview: "1" })).toContain(notLive(de, "Deutsch"));
    // A draft is always a preview for its editors; Greek writes the name in lower case.
    setup({ status: "draft", editor: true, learnerLocale: "en", list: { locale: "el", text: "Συγγραφέας (2022)." } });
    expect(await visit("el")).toContain(notLive(el, "ελληνικά"));
    // Learners, and a preview in a language learners get, have no such line.
    setup({ learnerLocale: "en" });
    expect(await visit("de")).not.toContain(notLive(de, "Deutsch"));
    setup({ editor: true, learnerLocale: "de", list: { locale: "de", text: "Autorin (2021)." } });
    expect(await visit("de", { preview: "1" })).not.toContain(notLive(de, "Deutsch"));
    setup({ editor: true });
    expect(await visit("en", { preview: "1" })).not.toContain(notLive(en, "English"));
  });

  it("never gives ?preview=1 a learner's meaning: it is the language learners get", async () => {
    setup({ learnerLocale: "en" });
    const html = await visit("de", { preview: "1" });
    expect(getCourseReferences).toHaveBeenCalledWith("seq-elevate", SLUG, "en");
    expect(html).toContain(`<a href="/learner/course/${SLUG}"`);
    expect(html).not.toContain("preview=1");
  });
});

describe("the references page's tab title", () => {
  it("names the course when the page shows a list", async () => {
    setup({});
    expect(await titleOf()).toBe("References & bibliography: Speak up (en)");
    setup({ learnerLocale: "en" });
    expect(await titleOf("de")).toBe(`${de.courseReferences.metaTitle.replace("{course}", "Speak up (en)")}`);
    setup({ status: "draft", editor: true });
    expect(await titleOf()).toBe("References & bibliography: Speak up (en)");
  });

  it("is the generic title whenever the page would answer not found", async () => {
    const cases: [Parameters<typeof setup>[0], (() => void)?][] = [
      [{ status: null }],
      [{ status: "draft" }],
      [{ status: "archived" }],
      [{ list: null }],
      [{ status: "draft", editor: false, title: "Secret draft" }],
      [{ editor: true }, () => vi.stubEnv("R4_FURTHER_READING", "off")],
    ];
    for (const [o, before] of cases) {
      vi.unstubAllEnvs();
      setup(o);
      before?.();
      expect(await titleOf(), JSON.stringify(o)).toBe(en.courseReferences.title);
      expect(await titleOf("de"), JSON.stringify(o)).toBe(de.courseReferences.title);
    }
  });
});
