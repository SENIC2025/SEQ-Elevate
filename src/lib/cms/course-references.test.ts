import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Release 4 spec 5.4 (D109): the loader of a created course's references
 * and bibliography. Built-in courses have none; a learner gets the list in
 * their content language, else English, else the first written; any error
 * answers "no list", so no page fails because of references, and the log
 * never holds the list's text.
 */

const findUnique = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { course: { findUnique } } }));

const { getCourseReferences, hasCourseReferences, readCourseBibliography } = await import("./course-references");

const P = "seq-elevate";
const rich = { v: 1, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] } };
const created = (content: unknown) => ({ meta: { en: { title: "T" } }, bibliography: content === undefined ? null : { content } });

beforeEach(() => {
  findUnique.mockClear();
  findUnique.mockResolvedValue(null);
});

describe("readCourseBibliography", () => {
  it("reads a created course's row by project and slug, selecting only what it needs", async () => {
    findUnique.mockResolvedValue(created({ v: 1, locales: { en: { text: "Author (2020).", rich } } }));
    expect(await readCourseBibliography(P, "my-course")).toEqual({ v: 1, locales: { en: { text: "Author (2020).", rich } } });
    expect(findUnique).toHaveBeenCalledWith({
      where: { projectId_slug: { projectId: P, slug: "my-course" } },
      select: { meta: true, bibliography: { select: { content: true } } },
    });
  });

  it("is an empty list for a created course without a row", async () => {
    findUnique.mockResolvedValue(created(undefined));
    expect(await readCourseBibliography(P, "my-course")).toEqual({ v: 1, locales: {} });
  });

  it("is none for a built-in course, by its slug or by its row, and for an unknown course", async () => {
    expect(await readCourseBibliography(P, "workplace-conflict")).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
    findUnique.mockResolvedValue({ meta: null, bibliography: { content: { v: 1, locales: { en: { text: "x" } } } } });
    expect(await readCourseBibliography(P, "old-course")).toBeNull();
    findUnique.mockResolvedValue(null);
    expect(await readCourseBibliography(P, "nothing-here")).toBeNull();
  });
});

describe("getCourseReferences", () => {
  const stored = { v: 1, locales: { de: { text: "Autorin (2021)." }, en: { text: "Author (2020).", rich } } };

  it("gives the list in the language asked for when it is written", async () => {
    findUnique.mockResolvedValue(created(stored));
    expect(await getCourseReferences(P, "my-course", "de")).toEqual({ locale: "de", text: "Autorin (2021)." });
  });

  it("falls back to English, then to the first language written", async () => {
    findUnique.mockResolvedValue(created(stored));
    expect(await getCourseReferences(P, "my-course", "el")).toEqual({ locale: "en", text: "Author (2020).", rich });
    findUnique.mockResolvedValue(created({ v: 1, locales: { el: { text: "Συγγραφέας (2022)." } } }));
    expect(await getCourseReferences(P, "my-course", "en")).toEqual({ locale: "el", text: "Συγγραφέας (2022)." });
  });

  it("is null without a written list, for a built-in course, and on any error, logging no text", async () => {
    findUnique.mockResolvedValue(created({ v: 1, locales: { en: { text: "   " } } }));
    expect(await getCourseReferences(P, "my-course", "en")).toBeNull();
    expect(await getCourseReferences(P, "workplace-conflict", "en")).toBeNull();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    findUnique.mockRejectedValue(new Error("connection lost: Author (2020)."));
    expect(await getCourseReferences(P, "my-course", "en")).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain("Author");
    error.mockRestore();
  });
});

describe("hasCourseReferences", () => {
  it("is true only when some language has a list", async () => {
    findUnique.mockResolvedValue(created({ v: 1, locales: { el: { text: "Συγγραφέας (2022)." } } }));
    expect(await hasCourseReferences(P, "my-course")).toBe(true);
    findUnique.mockResolvedValue(created({ v: 1, locales: { en: { text: "" } } }));
    expect(await hasCourseReferences(P, "my-course")).toBe(false);
    findUnique.mockResolvedValue(created(undefined));
    expect(await hasCourseReferences(P, "my-course")).toBe(false);
    expect(await hasCourseReferences(P, "workplace-conflict")).toBe(false);
  });

  it("is false on any error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    findUnique.mockRejectedValue(new Error("down"));
    expect(await hasCourseReferences(P, "my-course")).toBe(false);
    error.mockRestore();
  });
});
