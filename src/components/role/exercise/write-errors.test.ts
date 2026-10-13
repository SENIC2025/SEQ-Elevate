import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import type { SectionsError } from "@/lib/cms/sections/contract";
import { removeErrorMessage, writeErrorMessage } from "./write-errors";

const FILES = { en, de, el };

/** The message at a dotted key under exerciseEditor, or undefined. */
function at(messages: typeof en, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
      messages.exerciseEditor
    );
}

/** Every refusal an exercise or content action can answer with. */
const CODES: (SectionsError | "not-cms-course" | "generic" | "something-new")[] = [
  "forbidden",
  "bad-input",
  "bad-locale",
  "unknown-course",
  "not-cms-course",
  "outline-unreadable",
  "not-a-section",
  "unknown-part",
  "too-many-sections",
  "too-many-parts",
  "at-edge",
  "label-too-long",
  "not-restorable",
  "main-required",
  "use-main-editor",
  "kind-mismatch",
  "parts-too-large",
  "changed-elsewhere",
  "live-course-standard-only",
  "has-learners",
  "generic",
  "something-new",
];

describe("the exercise editors' refusal messages", () => {
  it("has words in every language for every refusal", () => {
    for (const [locale, messages] of Object.entries(FILES)) {
      for (const error of CODES) {
        for (const message of [writeErrorMessage({ error }), removeErrorMessage({ error })]) {
          expect(typeof at(messages, message.key), `${locale} ${error} → ${message.key}`).toBe(
            "string"
          );
        }
      }
    }
  });

  it("names Release 1's refusals rather than a generic failure", () => {
    expect(writeErrorMessage({ error: "has-learners", count: 3 })).toEqual({
      key: "errors.hasLearners",
      values: { count: 3 },
    });
    expect(writeErrorMessage({ error: "not-a-section" }).key).toBe("errors.notASection");
    expect(writeErrorMessage({ error: "live-course-standard-only" }).key).toBe(
      "errors.liveCourseStandardOnly"
    );
    expect(writeErrorMessage({ error: "kind-mismatch" }).key).toBe("errors.kindMismatch");
    expect(writeErrorMessage({ error: "outline-unreadable" }).key).toBe("errors.outlineUnreadable");
    expect(writeErrorMessage({ error: "parts-too-large" }).key).toBe("errors.partsTooLarge");
    expect(writeErrorMessage({ error: "use-main-editor" }).key).toBe("errors.useMainEditor");
    expect(writeErrorMessage({ error: "unknown-part" }).key).toBe("errors.unknownPart");
  });

  it("keeps Release 0's wording for the refusals it already had", () => {
    expect(writeErrorMessage({ error: "forbidden" }).key).toBe("errors.forbidden");
    expect(writeErrorMessage({ error: "not-cms-course" }).key).toBe("errors.notCms");
    expect(writeErrorMessage({ error: "bad-input" }).key).toBe("errors.mismatch");
    expect(writeErrorMessage({ error: "whatever" }).key).toBe("errors.generic");
    // "Remove stage": its own sentence for anything but the named refusals.
    expect(removeErrorMessage({ error: "forbidden" }).key).toBe("errors.removeFailed");
    expect(removeErrorMessage({ error: "has-learners", count: 2 })).toEqual({
      key: "errors.hasLearners",
      values: { count: 2 },
    });
    expect(removeErrorMessage({ error: "not-a-section" }).key).toBe("errors.notASection");
  });

  it("says how many learners would lose the exercise, in each language", () => {
    expect(en.exerciseEditor.errors.hasLearners).toMatch(/\{count, plural/);
    expect(de.exerciseEditor.errors.hasLearners).toMatch(/\{count, plural/);
    expect(el.exerciseEditor.errors.hasLearners).toMatch(/\{count, plural/);
  });
});
