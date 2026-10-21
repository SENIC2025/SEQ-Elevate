import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * Which language a learner reads a course in (D90, spec 9.2): English, a
 * bundled course, or a language signed off for the course; otherwise the
 * whole course in English. An error answers English.
 */

vi.mock("server-only", () => ({}));
const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { course: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));

import { contentLocaleFor, learnerContentLocale } from "./language-ready";

describe("contentLocaleFor", () => {
  it("always gives English as English", () => {
    expect(contentLocaleFor("created", [], "en", {})).toBe("en");
    expect(contentLocaleFor("created", ["de"], "en", {})).toBe("en");
  });

  it("gives a bundled course in every language, whatever the list holds", () => {
    expect(contentLocaleFor("builtin", [], "de", {})).toBe("de");
    expect(contentLocaleFor("builtin", null, "el", {})).toBe("el");
  });

  it("gives a created course in a language only once it is signed off", () => {
    expect(contentLocaleFor("created", [], "de", {})).toBe("en");
    expect(contentLocaleFor("created", ["el"], "de", {})).toBe("en");
    expect(contentLocaleFor("created", ["de"], "de", {})).toBe("de");
    expect(contentLocaleFor("created", ["de", "el"], "el", {})).toBe("el");
    expect(contentLocaleFor("created", null, "el", {})).toBe("en");
    expect(contentLocaleFor("created", undefined, "el", {})).toBe("en");
  });

  it("gives every language when R3_LANGUAGE_READY=off", () => {
    expect(contentLocaleFor("created", [], "de", { R3_LANGUAGE_READY: "off" })).toBe("de");
    expect(contentLocaleFor("created", [], "de", { R3_LANGUAGE_READY: "on" })).toBe("en");
  });
});

describe("learnerContentLocale", () => {
  beforeEach(() => {
    findUnique.mockReset();
    vi.unstubAllEnvs();
  });

  it("never reads the database for English or a bundled course", async () => {
    expect(await learnerContentLocale("seq-elevate", "my-course", "en")).toBe("en");
    expect(await learnerContentLocale("seq-elevate", "workplace-conflict", "de")).toBe("de");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("reads a created course's languages", async () => {
    findUnique.mockResolvedValue({ readyLocales: ["el"], meta: { en: { title: "T" } } });
    expect(await learnerContentLocale("seq-elevate", "my-course", "el")).toBe("el");
    expect(await learnerContentLocale("seq-elevate", "my-course", "de")).toBe("en");
    expect(findUnique).toHaveBeenCalledWith({
      where: { projectId_slug: { projectId: "seq-elevate", slug: "my-course" } },
      select: { readyLocales: true, meta: true },
    });
  });

  it("treats a database course with no copy of its own as bundled", async () => {
    findUnique.mockResolvedValue({ readyLocales: [], meta: null });
    expect(await learnerContentLocale("seq-elevate", "old-bundled", "de")).toBe("de");
  });

  it("answers English for a course it can't find, and on any error", async () => {
    findUnique.mockResolvedValueOnce(null);
    expect(await learnerContentLocale("seq-elevate", "gone", "de")).toBe("en");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    findUnique.mockRejectedValueOnce(new Error("connection lost to learner@example.com"));
    expect(await learnerContentLocale("seq-elevate", "my-course", "el")).toBe("en");
    // One line, without the error's message.
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).not.toContain("learner@example.com");
    error.mockRestore();
  });

  it("gives what was asked for when switched off, without a query", async () => {
    vi.stubEnv("R3_LANGUAGE_READY", "off");
    expect(await learnerContentLocale("seq-elevate", "my-course", "de")).toBe("de");
    expect(findUnique).not.toHaveBeenCalled();
  });
});
