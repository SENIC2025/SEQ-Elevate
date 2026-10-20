import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";

/*
 * Release 2 spec 5.13: the Foundation adds every new message key, in
 * English, German and Greek, so the streams only change values in their
 * own namespaces (messages-parity.test.ts keeps the three in step).
 */

const KEYS = [
  ...["several", "quizLeft", "quizCheck", "announce", "stillToDo"].map((k) => `continueHint.${k}`),
  ...[
    "stepDone",
    "resumed",
    "newLesson",
    "noLessons",
    "staleBuild",
    "reload",
    "charsLeft",
    "answerTooLong",
    "earlierAnswers",
  ].map((k) => `coursePlayer.${k}`),
  "dashboard.lessonsNotShown",
  "facilitator.otherLessons",
  ...["move", "hide", "show", "addLesson", "addPart", "movePart", "removeText"].map(
    (k) => `liveChanges.title.${k}`
  ),
  "liveChanges.learners",
  ...["move", "hide", "show", "part"].map((k) => `liveChanges.effect.${k}`),
  ...["move", "hide", "show", "add", "remove"].map((k) => `liveChanges.confirm.${k}`),
  "liveChanges.cancel",
  "liveChanges.closed",
  "liveChanges.hasLearners.delete",
  "liveChanges.hasLearners.part",
  "liveChanges.lastLesson",
  "liveChanges.emptyNote",
];

const at = (messages: unknown, path: string) =>
  path.split(".").reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], messages);

describe("Release 2's message keys", () => {
  it.each(Object.entries({ en, de, el }))("are all in %s, with some text", (_, messages) => {
    for (const key of KEYS) {
      const value = at(messages, key);
      expect(typeof value === "string" && value.trim() !== "", key).toBe(true);
    }
  });

  it("say in English what the spec says", () => {
    expect(at(en, "continueHint.announce")).toBe("{item}: {need}");
    expect(at(en, "coursePlayer.stepDone")).toBe(", done");
    expect(at(en, "coursePlayer.staleBuild")).toBe(
      "A new version is available. Reload the page to keep saving your answers."
    );
    expect(at(en, "liveChanges.learners")).toBe(
      "{count, plural, one {# learner is taking this course} other {# learners are taking this course}} ({finished} finished)."
    );
  });
});
