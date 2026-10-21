import { describe, it, expect, vi, afterEach } from "vitest";

/*
 * Release 3 (D90, spec 9.3, UE1): a learner's dashboard lists each course
 * in the language they get it in. Release 2 listed a created course in the
 * menu language field by field, so a half-translated course's card mixed
 * German and English.
 */

const listCourses = vi.fn();
const findMany = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("./index", () => ({ listCourses }));
vi.mock("@/lib/prisma", () => ({ prisma: { course: { findMany } } }));

const { learnerCatalogue } = await import("./learner-catalogue");

const summary = (slug: string, locale: string) => ({
  slug,
  cluster: "communication",
  title: `${slug} ${locale}`,
  clusterLabel: `Skill ${locale}`,
  tagline: `Tagline ${locale}`,
  durationMinutes: 10,
  status: "published" as const,
  stageKeys: ["context", "s-abcdefgh"],
  stageLabels: { "s-abcdefgh": `Warm-up ${locale}` },
});

function catalogue() {
  listCourses.mockImplementation(async (_p: string, locale: string) => [
    summary("workplace-conflict", locale),
    summary("created-ready", locale),
    summary("created-not-ready", locale),
  ]);
  findMany.mockResolvedValue([
    { slug: "workplace-conflict", readyLocales: [] },
    { slug: "created-ready", readyLocales: ["de"] },
    { slug: "created-not-ready", readyLocales: ["el"] },
  ]);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("learnerCatalogue", () => {
  it("gives a created course not switched on in English, marked, and the rest as asked", async () => {
    catalogue();
    const courses = await learnerCatalogue("seq-elevate", "de");
    expect(courses.map((c) => [c.slug, c.title, c.contentLocale])).toEqual([
      ["workplace-conflict", "workplace-conflict de", undefined],
      ["created-ready", "created-ready de", undefined],
      ["created-not-ready", "created-not-ready en", "en"],
    ]);
    // The English summary whole: its step names too, never a mix.
    expect(courses[2]).toMatchObject({ clusterLabel: "Skill en", stageLabels: { "s-abcdefgh": "Warm-up en" } });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("reads nothing more in English", async () => {
    catalogue();
    const courses = await learnerCatalogue("seq-elevate", "en");
    expect(courses.every((c) => c.contentLocale === undefined)).toBe(true);
    expect(listCourses).toHaveBeenCalledTimes(1);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("gives every created course in English when the languages can't be read", async () => {
    catalogue();
    findMany.mockRejectedValueOnce(new Error("down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const courses = await learnerCatalogue("seq-elevate", "el");
    expect(courses.map((c) => c.contentLocale)).toEqual([undefined, "en", "en"]);
    expect(error.mock.calls[0][0]).not.toContain("created");
    error.mockRestore();
  });

  it("with R3_LANGUAGE_READY=off, every language as asked (Release 2's behaviour)", async () => {
    vi.stubEnv("R3_LANGUAGE_READY", "off");
    catalogue();
    const courses = await learnerCatalogue("seq-elevate", "de");
    expect(courses.map((c) => c.title)).toEqual(["workplace-conflict de", "created-ready de", "created-not-ready de"]);
  });
});
