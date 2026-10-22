import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { forLanguage, normaliseLanguages } from "./item-language";

/*
 * Release 4 spec 4.2 and 4.4 (U16): the languages a document or link is for,
 * as stored, and which of them a learner gets.
 */

describe("normaliseLanguages", () => {
  it("keeps distinct languages, in the order en, de, el", () => {
    expect(normaliseLanguages(["de"])).toEqual(["de"]);
    expect(normaliseLanguages(["el", "en"])).toEqual(["en", "el"]);
    expect(normaliseLanguages(["de", "el"])).toEqual(["de", "el"]);
  });

  it("stores all three, and none, as every language: []", () => {
    expect(normaliseLanguages(["en", "de", "el"])).toEqual([]);
    expect(normaliseLanguages(["el", "de", "en"])).toEqual([]);
    expect(normaliseLanguages([])).toEqual([]);
  });

  it("refuses anything else", () => {
    for (const input of [
      undefined,
      null,
      "de",
      { 0: "de" },
      ["fr"],
      ["de", "fr"],
      ["DE"],
      [" de"],
      ["de", "de"],
      ["en", "de", "el", "en"],
      [1],
      [null],
      new Array(1000).fill("en"),
    ]) {
      expect(normaliseLanguages(input), JSON.stringify(input)?.slice(0, 40)).toBeNull();
    }
  });
});

describe("forLanguage", () => {
  const all = { id: "all", languages: [] as string[] };
  const absent = { id: "absent" };
  const stored = { id: "null", languages: null };
  const en = { id: "en", languages: ["en"] };
  const de = { id: "de", languages: ["de"] };
  const el = { id: "el", languages: ["el"] };
  const deEl = { id: "de+el", languages: ["de", "el"] };
  const items: { id: string; languages?: string[] | null }[] = [all, absent, stored, en, de, el, deEl];
  const ids = (locales: ("en" | "de" | "el")[], env = {}) => forLanguage(items, locales, env).map((i) => i.id);

  it("gives a learner reading one language the items for every language and for that one", () => {
    expect(ids(["en"])).toEqual(["all", "absent", "null", "en"]);
    expect(ids(["de"])).toEqual(["all", "absent", "null", "de", "de+el"]);
    expect(ids(["el"])).toEqual(["all", "absent", "null", "el", "de+el"]);
  });

  it("gives a learner reading two languages the items for either (spec 4.2's table)", () => {
    // A /de learner on a course still shown in English: English-only and German-only items.
    expect(ids(["en", "de"])).toEqual(["all", "absent", "null", "en", "de", "de+el"]);
  });

  it("gives none but the every-language items for no language", () => {
    expect(ids([])).toEqual(["all", "absent", "null"]);
  });

  it("gives every item with R4_ITEM_LANGUAGE=off", () => {
    expect(ids(["en"], { R4_ITEM_LANGUAGE: "off" })).toEqual(items.map((i) => i.id));
    expect(ids(["en"], { R4_ITEM_LANGUAGE: "on" })).toEqual(["all", "absent", "null", "en"]);
  });

  it("keeps the items' order and returns a new array", () => {
    const out = forLanguage(items, ["de"], { R4_ITEM_LANGUAGE: "off" });
    expect(out).not.toBe(items);
    expect(out).toEqual(items);
  });
});

describe("reading-types.ts", () => {
  it("has no runtime code: types only", async () => {
    expect(Object.keys(await import("./reading-types"))).toEqual([]);
    const source = readFileSync(new URL("./reading-types.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const statement of code.split("\n").filter((l) => /^\S/.test(l))) {
      expect(statement).toMatch(/^(import type|export (interface|type)|\})/);
    }
  });
});
