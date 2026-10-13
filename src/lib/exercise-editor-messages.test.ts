import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import {
  NEW_SECTION_TEMPLATES,
  type PartFieldCode,
  type PartIssueCode,
  type PartListCode,
  type SectionsError,
} from "@/lib/cms/sections/contract";

/**
 * The exercise editor's wording, beyond what messages-parity checks: it must
 * call the thing being edited what the course page around it calls it. The
 * page lists "lessons" (de "Lektion", el "ενότητα"), and one of them is
 * named "Geführte Übung" — so an editor that says "Teil" or "Übung" reads
 * as if it meant some other part, or another lesson.
 */

/** Every string under a messages node. */
function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (node && typeof node === "object") return Object.values(node).flatMap(strings);
  return [];
}

describe("exercise editor wording", () => {
  it("German calls the edited lesson a Lektion, never a Teil or an Übung", () => {
    // The lesson's own name is fine: "Geführte Übung" is what the page calls it.
    const lessonName = de.course.stageLabel.simulation;
    const offending = strings(de.exerciseEditor)
      .map((s) => s.split(lessonName).join(""))
      .filter((s) => /\bTeil(s|e)?\b|Übung/.test(s));
    expect(offending).toEqual([]);
    expect(de.exerciseEditor.actions.saveStage).toBe("Lektion speichern");
    expect(de.exerciseEditor.actions.removeStage).toBe("Lektion entfernen");
    expect(de.exerciseEditor.fields.stageTitle).toBe("Titel der Lektion");
  });

  it("Greek calls the edited lesson an ενότητα, never a μέρος or a δραστηριότητα", () => {
    const offending = strings(el.exerciseEditor).filter((s) =>
      /μέρο|δραστηριότητ/i.test(s)
    );
    expect(offending).toEqual([]);
    expect(el.exerciseEditor.actions.saveStage).toBe("Αποθήκευση ενότητας");
    expect(el.exerciseEditor.actions.removeStage).toBe("Αφαίρεση ενότητας");
    expect(el.exerciseEditor.fields.stageTitle).toBe("Τίτλος ενότητας");
  });

  it("English keeps the button names the end-to-end tests look for", () => {
    expect(en.exerciseEditor.actions.saveStage).toBe("Save stage");
    expect(en.exerciseEditor.actions.removeStage).toBe("Remove stage");
  });

  it("names the editor's region in the menu language, with the page's lesson names", () => {
    const kinds = ["simulation", "scenario", "assessment"] as const;
    // End-to-end specs find the region by these English names.
    expect(kinds.map((k) => en.exerciseEditor.region[k])).toEqual([
      "Interactive stage — Simulation",
      "Interactive stage — Scenario",
      "Interactive stage — Assessment",
    ]);
    for (const messages of [de, el]) {
      for (const kind of kinds) {
        expect(messages.exerciseEditor.region[kind]).toBe(
          `${messages.exerciseEditor.region.fallback} — ${messages.course.stageLabel[kind]}`
        );
      }
    }
  });

  it("takes the region name from the messages, not from English in the code", () => {
    const source = (file: string) =>
      readFileSync(join(__dirname, "..", "components", file), "utf8");
    expect(source("course-manager/LessonSection.tsx")).not.toMatch(/Interactive stage/);
    expect(source("role/StructureAuthor.tsx")).not.toMatch(/"Interactive stage"/);
  });
});

/* ------------------------------ Release 1 ------------------------------ */

const FILES = { en, de, el } as const;

/** A messages node by its dotted path, or undefined. */
function at(messages: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined,
      messages
    );
}

/** "has-learners" → "hasLearners": how a refusal's code names its message. */
const errorKey = (code: string) => code.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/*
 * The refusals Release 1 adds. The exercise and lesson editors say each in
 * the menu language (exerciseEditor.errors.<errorKey(code)>). A stale save
 * ("changed-elsewhere") keeps today's message, exerciseEditor.conflict.
 */
const NEW_ERRORS = [
  "has-learners",
  "not-a-section",
  "live-course-standard-only",
  "kind-mismatch",
  "outline-unreadable",
  "parts-too-large",
  "use-main-editor",
  "unknown-part",
] as const satisfies readonly SectionsError[];

const NEW_ISSUES = [
  "reflectionNoPrompts",
  "reflectionPromptText",
  "ratingNoStatements",
  "ratingStatementText",
  "ratingEndLabels",
] as const satisfies readonly PartIssueCode[];

const NEW_BOXES = [
  "partTitle",
  "partIntro",
  "reflectionPromptLabel",
  "reflectionPromptPlaceholder",
  "ratingMinLabel",
  "ratingMaxLabel",
  "ratingStatementText",
] as const satisfies readonly PartFieldCode[];

const NEW_LISTS = [
  "reflectionPrompts",
  "ratingStatements",
] as const satisfies readonly PartListCode[];

describe("Release 1 editor wording", () => {
  it("says every new refusal in each language", () => {
    for (const [locale, messages] of Object.entries(FILES)) {
      const missing = NEW_ERRORS.filter(
        (code) => typeof at(messages, `exerciseEditor.errors.${errorKey(code)}`) !== "string"
      );
      expect(missing, locale).toEqual([]);
    }
    // How many learners would lose something, in every language.
    for (const messages of Object.values(FILES)) {
      expect(messages.exerciseEditor.errors.hasLearners).toMatch(/\{count, plural,/);
    }
  });

  it("names the new content's problems, boxes and lists in each language", () => {
    for (const [locale, messages] of Object.entries(FILES)) {
      const paths = [
        ...NEW_ISSUES.map((c) => `exerciseEditor.issues.${c}`),
        ...NEW_BOXES.map((c) => `exerciseEditor.limits.boxes.${c}`),
        ...NEW_LISTS.map((c) => `exerciseEditor.limits.lists.${c}`),
      ];
      expect(paths.filter((path) => typeof at(messages, path) !== "string"), locale).toEqual([]);
      expect(at(messages, "exerciseEditor.reflection"), locale).toBeTypeOf("object");
      expect(at(messages, "exerciseEditor.rating"), locale).toBeTypeOf("object");
    }
  });

  it("names the reflection and self-assessment regions like the others", () => {
    for (const messages of Object.values(FILES)) {
      for (const kind of ["reflection", "rating"] as const) {
        expect(messages.exerciseEditor.region[kind].startsWith(
          `${messages.exerciseEditor.region.fallback} — `
        )).toBe(true);
      }
    }
  });

  it("names every lesson template, for a new lesson nobody has named", () => {
    for (const messages of Object.values(FILES)) {
      expect(Object.keys(messages.course.sectionTemplate).sort()).toEqual(
        [...NEW_SECTION_TEMPLATES].sort()
      );
    }
  });
});

/*
 * Release 1's streams each own one namespace and edit nothing else in the
 * message files. The namespaces sit apart from each other (each right after
 * a namespace of its own area), so changes from parallel branches never
 * touch neighbouring lines and merge without conflicts.
 */
describe("Release 1 stream namespaces", () => {
  const PLACES = [
    ["sectionPreview", "coursePlayer"],
    ["lessonList", "courseManager"],
    ["lessonBlocks", "exerciseEditor"],
  ] as const;

  const SEEDED: Record<(typeof PLACES)[number][0], string[]> = {
    sectionPreview: [
      "banner",
      "answerFirst",
      "skippedNote",
      "ratingOption",
      "ratingScale",
      "editLesson",
      "partHeading",
    ],
    lessonList: [
      "heading",
      "count",
      "actionsFor",
      "moveUp",
      "moveDown",
      "moved",
      "hide",
      "show",
      "hiddenTag",
      "rename",
      "delete",
      "picker",
      "where",
      "many",
      "max",
      "liveLocked",
      "nonStandardHint",
      "conflict",
      "publish",
      "labelsLater",
      "laterNote",
      "fullTemplate",
    ],
    lessonBlocks: [
      "addContent",
      "types",
      "position",
      "groupLabel",
      "moveUp",
      "moveDown",
      "remove",
      "removeConfirm",
      "notInLearnerView",
      "liveLocked",
      "ownQuestionsNote",
      "draft",
      "notReady",
      "langState",
      "tooLarge",
    ],
  };

  it("puts each stream's namespace right after its neighbour, in every file", () => {
    for (const [locale, messages] of Object.entries(FILES)) {
      const keys = Object.keys(messages);
      for (const [namespace, after] of PLACES) {
        expect(keys.indexOf(namespace), `${locale} ${namespace}`).toBe(keys.indexOf(after) + 1);
      }
    }
  });

  it("seeds each namespace with the keys its stream starts from", () => {
    for (const [locale, messages] of Object.entries(FILES)) {
      for (const [namespace, keys] of Object.entries(SEEDED)) {
        const node = at(messages, namespace) as Record<string, unknown>;
        expect(
          keys.filter((k) => !(k in node)),
          `${locale} ${namespace}`
        ).toEqual([]);
      }
    }
  });

  it("names the publish blockers' reasons and the content types in full", () => {
    const reasons = ["customSection", "hiddenSection", "removedSection", "reordered", "extraParts", "unreadable"];
    const types = ["text", "practice", "scenario", "quiz", "reflection", "rating"];
    for (const messages of Object.values(FILES)) {
      expect(Object.keys(messages.lessonList.publish.reason).sort()).toEqual([...reasons].sort());
      expect(Object.keys(messages.lessonBlocks.types).sort()).toEqual([...types].sort());
      expect(Object.keys(messages.sectionPreview.partHeading).sort()).toEqual([...types].sort());
    }
  });

  it("keeps the new content's German and Greek free of the words the editor avoids", () => {
    // Content is "Inhalt" / "περιεχόμενο", never a "Teil" / "μέρος" of a lesson.
    const lessonName = de.course.stageLabel.simulation;
    const german = [de.lessonBlocks, de.lessonList, de.sectionPreview]
      .flatMap(strings)
      .map((s) => s.split(lessonName).join(""))
      .filter((s) => /\bTeil(s|e)?\b/.test(s));
    expect(german).toEqual([]);
    const greek = [el.lessonBlocks, el.lessonList, el.sectionPreview]
      .flatMap(strings)
      .filter((s) => /μέρο|δραστηριότητ/i.test(s));
    expect(greek).toEqual([]);
  });
});
