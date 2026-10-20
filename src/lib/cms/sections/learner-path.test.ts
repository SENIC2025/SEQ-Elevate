import { describe, it, expect } from "vitest";
import { STAGES } from "@/data/course";
import { presentStageKeys } from "../course-derive";
import type { Locale } from "../types";
import { LEGACY_FIXTURES } from "./fixtures";
import {
  frontierOf,
  isReachable,
  lessonHasContent,
  lessonPlanOf,
  lessonRenderKind,
  nextAfter,
  nextLesson,
  type LessonFacts,
} from "./learner-path";
import type { ResolvedSection } from "./contract";

/*
 * The one list of lessons learners get (spec 3.2): the player plays it and
 * every counter counts by it, so they can't disagree. A standard lesson
 * with only its main content is drawn by today's stage screen ("stage"),
 * everything else by the sectioned view ("section"); hiding and reordering
 * never change which. Plus the rules of moving through it (Q4: in order,
 * Back always allowed).
 */

const OWN = "s-abcdefgh";
const OWN2 = "s-00000002";
const LOCALES: Locale[] = ["en", "de", "el"];
const para = (text: string) => ({ kind: "paragraph", text });
const MAIN = { id: "main", type: "main" };
const textPart = (id: string, text = "More") => ({ id, type: "text", blocks: { en: [para(text)] } });
const SIM = {
  kind: "simulation",
  title: { en: "Practise asking" },
  prompt: { en: "Hi" },
  instruction: {},
  options: [
    { id: "a", isBest: true, text: { en: "Yes" }, feedback: {} },
    { id: "b", isBest: false, text: { en: "No" }, feedback: {} },
  ],
};

function facts(stageKey: string, cols: Partial<LessonFacts> = {}): LessonFacts {
  return { stageKey, structure: null, parts: null, narrative: null, hasVideo: false, publishedDocuments: 0, ...cols };
}
const section = (id: string, more: Partial<ResolvedSection> = {}): ResolvedSection =>
  ({ id, template: id.startsWith("s-") ? "text" : id, custom: id.startsWith("s-"), ...more }) as ResolvedSection;
const ids = (plan: { lessons: { id: string }[] }) => plan.lessons.map((l) => l.id);

describe("lessonRenderKind", () => {
  it("draws a standard lesson with only its main content by its stage screen", () => {
    expect(lessonRenderKind("context", null)).toBe("stage");
    expect(lessonRenderKind("simulation", { v: 1, items: [MAIN] })).toBe("stage");
    // Unreadable content is read as main only, as the sectioned view reads it.
    expect(lessonRenderKind("assessment", "garbage")).toBe("stage");
  });

  it("draws a lesson with extra content, and every lesson of the course's own, by the sectioned view", () => {
    expect(lessonRenderKind("concept", { v: 1, items: [MAIN, textPart("p-00000001")] })).toBe("section");
    expect(lessonRenderKind(OWN, null)).toBe("section");
  });
});

describe("lessonHasContent", () => {
  it("always has the four standard text lessons, written or not", () => {
    for (const k of ["context", "concept", "behaviour", "reflection"]) {
      expect(lessonHasContent(section(k), facts(k))).toBe(true);
    }
  });

  it("has an exercise once it is saved for learners, never a draft alone", () => {
    expect(lessonHasContent(section("simulation"), facts("simulation", { structure: SIM }))).toBe(true);
    expect(lessonHasContent(section("simulation"), facts("simulation"))).toBe(false);
    expect(lessonHasContent(section("simulation"), facts("simulation", { structure: { kind: "scenario" } }))).toBe(false);
  });

  it("has a lesson of the course's own with text, a live question, a video or a published document", () => {
    const own = section(OWN);
    expect(lessonHasContent(own, facts(OWN))).toBe(false);
    expect(lessonHasContent(own, facts(OWN, { narrative: { en: { title: "T" } } }))).toBe(false);
    expect(lessonHasContent(own, facts(OWN, { narrative: { de: { blocks: [para("Text")] } } }))).toBe(true);
    expect(lessonHasContent(own, facts(OWN, { parts: { v: 1, items: [MAIN, textPart("p-00000001")] } }))).toBe(true);
    expect(lessonHasContent(own, facts(OWN, { hasVideo: true }))).toBe(true);
    expect(lessonHasContent(own, facts(OWN, { publishedDocuments: 1 }))).toBe(true);
    const draftOnly = { v: 1, items: [MAIN, { id: "p-00000002", type: "quiz", data: null, draft: { kind: "assessment" } }] };
    expect(lessonHasContent(own, facts(OWN, { parts: draftOnly }))).toBe(false);
  });

  it("has a practice of the course's own once its exercise is saved", () => {
    const own = section(OWN, { template: "practice" });
    expect(lessonHasContent(own, facts(OWN, { structure: SIM }))).toBe(true);
    expect(lessonHasContent(own, facts(OWN))).toBe(false);
  });
});

describe("lessonPlanOf: built-in courses", () => {
  it("is all seven, in order, by their stage screens, with the standard names", () => {
    const plan = lessonPlanOf("bundled", null, [], "en");
    expect(ids(plan)).toEqual(STAGES);
    expect(plan.lessons.every((l) => l.kind === "stage")).toBe(true);
    expect(plan.lessons.map((l) => l.label)).toEqual([
      "Context",
      "Skill concept",
      "Behaviour model",
      "Guided practice",
      "Applied scenario",
      "Reflection",
      "Quick check",
    ]);
    expect(plan.unseen).toEqual([]);
    expect(lessonPlanOf("bundled", null, [], "de").lessons[0].label).toBe("Kontext");
  });
});

describe("lessonPlanOf: created courses", () => {
  it("is what learners get today for every course as Release 0 left it, in every language", () => {
    for (const f of LEGACY_FIXTURES) {
      const rows = f.lessons.map((l) => facts(l.stageKey, { structure: l.structure ?? null, parts: l.parts ?? null }));
      for (const locale of LOCALES) {
        const plan = lessonPlanOf("cms", null, rows, locale);
        expect(ids(plan), f.name).toEqual(presentStageKeys("cms", f.lessons));
        expect(plan.lessons.every((l) => l.kind === "stage"), f.name).toBe(true);
      }
    }
  });

  it("follows the outline: order, hidden lessons left out, step names, the course's own lessons", () => {
    const outline = {
      v: 1,
      sections: [
        { id: "concept", template: "concept", label: { en: "The idea", de: "Die Idee" } },
        { id: "context", template: "context", hidden: true },
        { id: OWN, template: "text", label: { de: "Eigene" } },
        { id: OWN2, template: "practice" },
        { id: "behaviour", template: "behaviour" },
        { id: "reflection", template: "reflection" },
      ],
    };
    const rows = [
      facts(OWN, { narrative: { en: { title: "Own title", blocks: [para("Own")] } } }),
      facts(OWN2),
      facts("behaviour", { parts: { v: 1, items: [MAIN, textPart("p-00000001")] } }),
    ];
    const en = lessonPlanOf("cms", outline, rows, "en");
    expect(en.lessons).toEqual([
      { id: "concept", kind: "stage", label: "The idea" },
      // Named in German only: said so (see "the language of a step name").
      { id: OWN, kind: "section", label: "Eigene", lang: "de" },
      { id: "behaviour", kind: "section", label: "Behaviour model" },
      { id: "reflection", kind: "stage", label: "Reflection" },
    ]);
    // Hidden, and a practice of the course's own nobody has saved yet.
    expect(en.unseen).toEqual(["context", OWN2]);
    const de = lessonPlanOf("cms", outline, rows, "de");
    expect(ids(de)).toEqual(ids(en));
    expect(de.lessons.map((l) => l.label)).toEqual(["Die Idee", "Eigene", "Verhaltens-Modell", "Reflexion"]);
  });

  it("names a lesson of the course's own without a step name by its title, else its template", () => {
    const outline = { v: 1, sections: [{ id: "context", template: "context" }, { id: OWN, template: "blank" }] };
    const own = (rows: LessonFacts[]) => lessonPlanOf("cms", outline, rows, "en").lessons.find((l) => l.id === OWN);
    expect(own([facts(OWN, { hasVideo: true })])).toEqual({ id: OWN, kind: "section", label: "Blank lesson" });
    expect(own([facts(OWN, { hasVideo: true, narrative: { en: { title: "Own" } } })])?.label).toBe("Own");
  });

  it("says the language of a step name that isn't in the plan's (WCAG 3.1.2), and only then", () => {
    // Review finding 7a: a lesson of the course's own named only in English
    // was shown on German pages with nothing to say it is English.
    const outline = {
      v: 1,
      sections: [
        { id: "concept", template: "concept", label: { en: "The idea" } },
        { id: OWN, template: "text", label: { en: "Your own story" } },
        { id: OWN2, template: "blank" },
        { id: "reflection", template: "reflection", label: { de: "Nachdenken", el: "Σκέψη" } },
      ],
      removed: ["context", "behaviour"],
    };
    const rows = [
      facts(OWN, { narrative: { en: { title: "A story", blocks: [para("Text")] } } }),
      // No step name in any language: its title, written in English only.
      facts(OWN2, { hasVideo: true, narrative: { en: { title: "Only in English" } } }),
    ];
    const langs = (locale: Locale) =>
      lessonPlanOf("cms", outline, rows, locale).lessons.map((l) => [l.label, l.lang]);
    expect(langs("de")).toEqual([
      // A standard lesson not renamed in German has its German name.
      ["Skill-Konzept", undefined],
      ["Your own story", "en"],
      ["Only in English", "en"],
      ["Nachdenken", undefined],
    ]);
    expect(langs("en")).toEqual([
      ["The idea", undefined],
      ["Your own story", undefined],
      ["Only in English", undefined],
      ["Reflection", undefined],
    ]);
    expect(langs("el")).toEqual([
      ["Έννοια δεξιότητας", undefined],
      ["Your own story", "en"],
      ["Only in English", "en"],
      ["Σκέψη", undefined],
    ]);
    // A built-in course's names are always the plan's language.
    expect(lessonPlanOf("bundled", null, [], "de").lessons.every((l) => l.lang === undefined)).toBe(true);
  });

  it("gives the derived list when the outline can't be read (fails open, D18)", () => {
    const rows = [facts("simulation", { structure: SIM })];
    const plan = lessonPlanOf("cms", { v: 9 }, rows, "en");
    expect(ids(plan)).toEqual(["context", "concept", "behaviour", "simulation", "reflection"]);
    expect(plan.lessons.every((l) => l.kind === "stage")).toBe(true);
  });

  it("draws a standard lesson whose content can't be read by its stage screen", () => {
    const plan = lessonPlanOf("cms", null, [facts("concept", { parts: "garbage" })], "en");
    expect(plan.lessons.find((l) => l.id === "concept")?.kind).toBe("stage");
  });

  it("keeps a standard exercise with extra content but no saved exercise when it has something to show", () => {
    const outline = {
      v: 1,
      sections: [{ id: "simulation", template: "simulation" }],
      removed: ["context", "concept", "behaviour", "reflection"],
    };
    const withText = facts("simulation", { parts: { v: 1, items: [MAIN, textPart("p-00000001")] } });
    expect(lessonPlanOf("cms", outline, [withText], "en").lessons).toEqual([
      { id: "simulation", kind: "section", label: "Guided practice" },
    ]);
    const empty = facts("simulation", { parts: { v: 1, items: [MAIN, textPart("p-00000001", " ")] } });
    expect(lessonPlanOf("cms", outline, [empty], "en")).toEqual({ lessons: [], unseen: ["simulation"] });
  });

  it("with the kill switch, is exactly what Release 1 learners get, keeping the rest unseen", () => {
    const outline = {
      v: 1,
      sections: [
        { id: OWN, template: "text", label: { en: "Own" } },
        { id: "behaviour", template: "behaviour", label: { en: "Renamed" } },
        { id: "context", template: "context", hidden: true },
        { id: "concept", template: "concept" },
        { id: "reflection", template: "reflection" },
      ],
    };
    const rows = [facts(OWN, { hasVideo: true }), facts("concept", { parts: { v: 1, items: [MAIN, textPart("p-00000001")] } })];
    const plan = lessonPlanOf("cms", outline, rows, "en", { legacyOnly: true });
    expect(plan.lessons).toEqual([
      { id: "context", kind: "stage", label: "Context" },
      { id: "concept", kind: "stage", label: "Skill concept" },
      { id: "behaviour", kind: "stage", label: "Behaviour model" },
      { id: "reflection", kind: "stage", label: "Reflection" },
    ]);
    expect(plan.unseen).toEqual([OWN]);
  });
});

describe("nextLesson", () => {
  const IDS = ["context", OWN, "concept"];

  it("is the first lesson not done, in the course's order", () => {
    expect(nextLesson(IDS, new Set(["context"]), null)).toBe(OWN);
    expect(nextLesson(IDS, new Set([OWN]), null)).toBe("context");
  });

  it("is the completion once the course is completed", () => {
    expect(nextLesson(IDS, new Set(), "2026-11-10T09:00:00.000Z")).toBe("complete");
  });

  it("is the last lesson, never the completion, when all are done but the course isn't completed", () => {
    expect(nextLesson(IDS, new Set(IDS), null)).toBe("concept");
  });

  it("is empty for a course with no lessons", () => {
    expect(nextLesson([], new Set(), null)).toBe("empty");
  });
});

describe("frontierOf and isReachable (Q4: in order, Back always)", () => {
  const IDS = ["context", "concept", OWN, "behaviour"];

  it("reaches up to the first lesson not done", () => {
    const frontier = frontierOf(IDS, new Set(["context", OWN]), false);
    expect(frontier).toBe(1);
    expect([0, 1, 2, 3].map((i) => isReachable(i, frontier, 1, false))).toEqual([true, true, false, false]);
  });

  it("keeps the lesson being shown reachable", () => {
    expect(isReachable(3, 1, 3, false)).toBe(true);
  });

  it("reaches every lesson once all are done, the course is completed, or in preview", () => {
    expect(frontierOf(IDS, new Set(IDS), false)).toBe(3);
    expect(frontierOf(IDS, new Set(), true)).toBe(3);
    expect(isReachable(3, 0, 0, true)).toBe(true);
  });

  it("is -1 for a course with no lessons", () => {
    expect(frontierOf([], new Set(), false)).toBe(-1);
  });
});

describe("nextAfter", () => {
  const IDS = ["context", OWN, "concept"];

  it("is the next lesson in order, done or not", () => {
    expect(nextAfter(IDS, new Set(), "context")).toEqual({ to: OWN });
    expect(nextAfter(IDS, new Set([OWN]), "context")).toEqual({ to: OWN });
  });

  it("after the last lesson, sends the learner back to a lesson still to do", () => {
    expect(nextAfter(IDS, new Set(["context"]), "concept")).toEqual({ to: OWN, stillToDo: OWN });
  });

  it("completes the course after the last lesson once every other is done", () => {
    expect(nextAfter(IDS, new Set(["context", OWN]), "concept")).toEqual({ to: "complete" });
  });

  it("counts the lesson being left as done", () => {
    expect(nextAfter(["context"], new Set(), "context")).toEqual({ to: "complete" });
  });
});
