import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import { STAGES } from "@/data/course";
import { NEW_SECTION_TEMPLATES, type SectionsError } from "@/lib/cms/sections/contract";
import {
  NAME_SLOT,
  aroundName,
  choiceKey,
  defaultWhere,
  fallbackName,
  focusAfterDelete,
  focusAfterMove,
  nameIn,
  parseWhere,
  reasonText,
  refusalGone,
  refusalKey,
  usualOrder,
  whereToAt,
  whereValue,
  type ContentNames,
} from "./list-model";

const FILES = { en, de, el } as const;
const tr = (locale: keyof typeof FILES, namespace: string) =>
  createTranslator({ locale, messages: FILES[locale], namespace: namespace as never }) as unknown as (
    key: string,
    values?: Record<string, string | number>
  ) => string;

/** As the course page builds them, from the message files. */
const NAMES: ContentNames = {
  standard: Object.fromEntries(
    (["en", "de", "el"] as const).map((l) => [
      l,
      Object.fromEntries(STAGES.map((k) => [k, FILES[l].course.stageLabel[k]])),
    ])
  ) as ContentNames["standard"],
  template: Object.fromEntries(
    (["en", "de", "el"] as const).map((l) => [l, FILES[l].course.sectionTemplate])
  ) as ContentNames["template"],
  numbered: { en: en.course.sectionNumbered, de: de.course.sectionNumbered, el: el.course.sectionNumbered },
};

describe("names in the content language", () => {
  it("a standard lesson goes by the standard name of that language once its own is cleared", () => {
    const concept = { id: "concept" as const, template: "concept" as const, label: { de: "Die Idee" } };
    expect(nameIn(concept, "de", NAMES, { n: 2 })).toEqual({ text: "Die Idee", source: "own" });
    expect(fallbackName(concept, "de", NAMES, { n: 2 })).toBe(de.course.stageLabel.concept);
  });

  it("a lesson of the course's own falls back to another language, its title, its template", () => {
    const own = { id: "s-abcdefgh" as const, template: "quiz" as const, label: { en: "Check-in" } };
    expect(fallbackName(own, "de", NAMES, { n: 4 })).toBe("Check-in");
    expect(fallbackName(own, "en", NAMES, { n: 4, title: "Five questions" })).toBe("Five questions");
    expect(fallbackName(own, "en", NAMES, { n: 4 })).toBe(en.course.sectionTemplate.quiz);
  });
});

describe("where a new lesson goes", () => {
  it("a standard lesson in its usual place; else after the row it was opened from, or at the end", () => {
    expect(defaultWhere(true, 2, 6)).toBe("auto");
    expect(defaultWhere(false, 2, 6)).toBe(3);
    expect(defaultWhere(false, null, 6)).toBe(6);
    expect(defaultWhere(false, 5, 6)).toBe(6);
  });

  it("round-trips through the select", () => {
    for (const w of ["auto", 0, 4] as const) expect(parseWhere(whereValue(w))).toBe(w);
    expect(whereToAt("auto")).toBeNull();
    expect(whereToAt(3)).toBe(3);
  });
});

describe("focus after a change", () => {
  it("stays on the pressed move button, or goes to the other one at either end", () => {
    expect(focusAfterMove(3, -1, 6)).toBe("up");
    expect(focusAfterMove(1, -1, 6)).toBe("down");
    expect(focusAfterMove(2, 1, 6)).toBe("down");
    expect(focusAfterMove(4, 1, 6)).toBe("up");
  });

  it("goes to the next lesson after a delete, else the one before", () => {
    expect(focusAfterDelete(["a", "b", "c"], "b")).toBe("c");
    expect(focusAfterDelete(["a", "b", "c"], "c")).toBe("b");
    expect(focusAfterDelete(["a"], "a")).toBeNull();
    expect(focusAfterDelete(["a"], "x")).toBeNull();
  });
});

describe("words", () => {
  const nameOf = (id: string) => (id === "concept" ? "Skill concept" : "Wrap-up");

  it("names each publishing blocker, linking to the lesson when it is on the page", () => {
    const t = tr("en", "lessonList.publish.reason");
    expect(reasonText({ code: "custom-section", sectionId: "s-abcdefgh" }, nameOf, t)).toMatchObject({
      text: "“Wrap-up” is a new lesson",
      href: "#lesson-s-abcdefgh",
      name: "Wrap-up",
    });
    expect(reasonText({ code: "removed-section", sectionId: "concept" }, nameOf, t)).toMatchObject({
      text: "“Skill concept” was deleted",
      href: null,
    });
  });

  it("says what the usual order is when the lessons are in a new one", () => {
    const t = tr("en", "lessonList.publish.reason");
    const r = reasonText({ code: "reordered" }, nameOf, t, "Context, Skill concept, Reflection");
    expect(r.text).toBe("The lessons are in a new order. Usually: Context, Skill concept, Reflection");
    expect(r.href).toBeNull();
    // The order is the part in the content language.
    expect(r.name).toBe("Context, Skill concept, Reflection");
    expect(aroundName(r.format)).toEqual({ before: "The lessons are in a new order. Usually: ", after: "" });
  });

  it("puts the usual order of the standard lessons back together, hidden ones too", () => {
    expect(usualOrder(["reflection", "s-abcdefgh", "context", "simulation", "concept"])).toEqual([
      "context",
      "concept",
      "simulation",
      "reflection",
    ]);
  });

  it("finds the name in a sentence in every language, so it can carry the content language", () => {
    for (const locale of ["en", "de", "el"] as const) {
      const t = tr(locale, "lessonList");
      const parts = aroundName((name) => t("delete.title", { name }));
      expect(parts, locale).not.toBeNull();
      expect(`${parts!.before}${NAME_SLOT}${parts!.after}`).toBe(t("delete.title", { name: NAME_SLOT }));
    }
    expect(aroundName(() => "no name here")).toBeNull();
  });

  it("says a refusal for the whole list when its lesson is gone from the fresh list", () => {
    // A colleague deleted it: the row (and its message box) is gone.
    expect(refusalGone("s-abcdefgh", "changed-elsewhere", ["context", "concept"])).toBe(true);
    expect(refusalGone("s-abcdefgh", "not-a-section", null)).toBe(true);
    // Still there: said in its row.
    expect(refusalGone("concept", "changed-elsewhere", ["context", "concept"])).toBe(false);
    expect(refusalGone("concept", "has-learners", null)).toBe(false);
    expect(refusalGone("picker", "changed-elsewhere", [])).toBe(false);
  });

  it("has words for every refusal and every picker choice in every language", () => {
    const errors: SectionsError[] = [
      "forbidden",
      "bad-input",
      "bad-locale",
      "unknown-course",
      "not-cms-course",
      "outline-unreadable",
      "not-a-section",
      "too-many-sections",
      "at-edge",
      "label-too-long",
      "not-restorable",
      "changed-elsewhere",
      "live-course-standard-only",
      "has-learners",
    ];
    for (const locale of ["en", "de", "el"] as const) {
      const t = tr(locale, "lessonList");
      for (const e of errors) {
        const text = t(refusalKey(e), { count: 2, max: 15 });
        expect(text, `${locale} ${e}`).not.toMatch(/lessonList\./);
      }
      for (const choice of [...NEW_SECTION_TEMPLATES, "restore:context" as const]) {
        const k = choiceKey(choice);
        expect(t(k.label, { name: "X" })).not.toMatch(/lessonList\./);
        expect(t(k.hint)).not.toMatch(/lessonList\./);
      }
    }
  });

  it("keeps the same keys and placeholders in German and Greek", () => {
    const flat = (o: unknown, at = ""): Record<string, string> =>
      typeof o === "string"
        ? { [at]: o }
        : Object.assign({}, ...Object.entries(o as object).map(([k, v]) => flat(v, at ? `${at}.${k}` : k)));
    // The arguments, not the words of a plural's branches ("{count, plural, one {# …}}").
    const args = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]))].sort();
    const base = flat(en.lessonList);
    for (const other of [de.lessonList, el.lessonList]) {
      const o = flat(other);
      expect(Object.keys(o).sort()).toEqual(Object.keys(base).sort());
      for (const [k, v] of Object.entries(base)) expect(args(o[k]), k).toEqual(args(v));
    }
  });
});
