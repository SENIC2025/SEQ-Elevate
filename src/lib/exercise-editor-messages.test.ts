import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";

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
