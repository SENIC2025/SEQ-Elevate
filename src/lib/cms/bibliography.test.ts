import { describe, it, expect } from "vitest";
import { EMPTY_BIBLIOGRAPHY, bibliographyFor, parseBibliography, writtenLocales } from "./bibliography";

/*
 * Release 4 spec 5.2 (U16): a course's references as stored, and the list a
 * learner gets: in their effective content language when written there,
 * else English, else the first language written.
 */

const rich = { v: 1, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] } };

describe("parseBibliography", () => {
  it("reads version 1 with an entry per content language", () => {
    expect(
      parseBibliography({ v: 1, locales: { en: { text: "Author, A. (2020).", rich }, de: { text: "Autorin, B. (2021)." } } })
    ).toEqual({ v: 1, locales: { en: { text: "Author, A. (2020).", rich }, de: { text: "Autorin, B. (2021)." } } });
  });

  it("is no list at all for unreadable content", () => {
    for (const raw of [null, undefined, "x", [], { v: 2, locales: { en: { text: "x" } } }, { v: 1 }, { v: 1, locales: [] }]) {
      expect(parseBibliography(raw)).toEqual({ v: 1, locales: {} });
    }
  });

  it("leaves out unknown languages and entries without text, keeping the rest", () => {
    expect(
      parseBibliography({
        v: 1,
        locales: { fr: { text: "x" }, en: { text: 42 }, de: "text", el: { text: "Συγγραφέας (2022)." }, __proto__: { text: "x" } },
      })
    ).toEqual({ v: 1, locales: { el: { text: "Συγγραφέας (2022)." } } });
  });

  it("drops a null rich and keeps the stored order of languages", () => {
    const parsed = parseBibliography({ v: 1, locales: { el: { text: "c", rich: null }, de: { text: "b" } } });
    expect(parsed).toEqual({ v: 1, locales: { el: { text: "c" }, de: { text: "b" } } });
    expect(Object.keys(parsed.locales)).toEqual(["el", "de"]);
  });
});

describe("bibliographyFor and writtenLocales", () => {
  const content = (locales: Record<string, string>) =>
    parseBibliography({ v: 1, locales: Object.fromEntries(Object.entries(locales).map(([l, text]) => [l, { text }])) });

  it("gives the learner's effective content language when it is written", () => {
    const c = content({ en: "English list", de: "Deutsche Liste" });
    expect(bibliographyFor(c, "de")).toEqual({ locale: "de", entry: { text: "Deutsche Liste" } });
    expect(bibliographyFor(c, "en")).toEqual({ locale: "en", entry: { text: "English list" } });
  });

  it("falls back to English, then to the first language written", () => {
    expect(bibliographyFor(content({ en: "English list", de: "Deutsche Liste" }), "el")?.locale).toBe("en");
    expect(bibliographyFor(content({ el: "Ελληνική λίστα", de: "Deutsche Liste" }), "en")?.locale).toBe("el");
    expect(bibliographyFor(content({ de: "Deutsche Liste", el: "Ελληνική λίστα" }), "en")?.locale).toBe("de");
  });

  it("counts a list of spaces as not written", () => {
    const c = content({ de: "   ", en: "English list" });
    expect(writtenLocales(c)).toEqual(["en"]);
    expect(bibliographyFor(c, "de")?.locale).toBe("en");
    expect(bibliographyFor(content({ en: " " }), "en")).toBeNull();
  });

  it("gives nothing when no language has a list", () => {
    expect(bibliographyFor(EMPTY_BIBLIOGRAPHY, "en")).toBeNull();
    expect(writtenLocales(EMPTY_BIBLIOGRAPHY)).toEqual([]);
  });
});
