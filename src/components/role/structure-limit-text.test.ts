import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import { fieldKey, STRUCTURE_FIELD_CODES } from "@/lib/cms/structure";
import {
  sanitizeStructure,
  STRUCTURE_LIMITS,
  STRUCTURE_LIST_CODES,
  type StructureLimitBreach,
} from "@/lib/cms/structure-sanitize";
import type { Locale } from "@/lib/cms/types";
import { limitField, limitText } from "./structure-limit-text";

/**
 * What the exercise editor says when a save is refused for size: which box
 * (named as the "Not ready to save" reasons name it), which language, and
 * the limit — in the menu language, from the real message files.
 */

const FILES = { en, de, el } as const;

function say(menu: Locale, at: StructureLimitBreach) {
  const messages = FILES[menu];
  const t = createTranslator({ locale: menu, messages, namespace: "exerciseEditor" });
  const lang = createTranslator({
    locale: menu,
    messages,
    namespace: "courseManager.languageName",
  });
  return limitText(at, (key, values) => t(key as never, values as never), (l) => lang(l));
}

const followupOutcome: StructureLimitBreach = {
  limit: "text",
  field: "scenarioFollowupOutcome",
  params: { choice: 2, followup: 1 },
  locale: "el",
  max: STRUCTURE_LIMITS.maxTextChars,
};

describe("limitText", () => {
  it("names the box, its language and the limit", () => {
    expect(say("en", followupOutcome)).toBe(
      "Follow-up 2.1, follow-up outcome (Greek): shorten it to 2,000 characters or fewer."
    );
    expect(say("de", followupOutcome)).toBe(
      "Folgeschritt 2.1, was nach dem Folgeschritt passiert (Griechisch): Kürze den Text auf höchstens 2.000 Zeichen."
    );
    expect(say("el", { ...followupOutcome, locale: "de" })).toBe(
      "Συνέχεια 2.1, τι συμβαίνει μετά τη συνέχεια (Γερμανικά): συντόμευσε το κείμενο σε 2.000 χαρακτήρες το πολύ."
    );
  });

  it("names a list, how long it is and the limit", () => {
    expect(
      say("en", {
        limit: "list",
        list: "assessmentAnswers",
        params: { question: 3 },
        max: 8,
        count: 9,
      })
    ).toBe("Question 3, answers: there are 9, and at most 8 can be saved. Remove some.");
  });

  it("says when the stage as a whole is too large", () => {
    expect(say("en", { limit: "total", max: STRUCTURE_LIMITS.maxJsonChars })).toBe(
      "This stage is too large to save as a whole (over 200,000 characters). Shorten some of its texts."
    );
  });

  it("has words for every box and list, in every language", () => {
    for (const menu of ["en", "de", "el"] as const) {
      for (const field of STRUCTURE_FIELD_CODES) {
        const text = say(menu, {
          limit: "text",
          field,
          params: { option: 1, choice: 1, followup: 1, question: 1, answer: 1 },
          locale: "en",
          max: 200,
        });
        expect(text, `${menu} ${field}`).not.toMatch(/exerciseEditor|limits\.|\{/);
      }
      for (const list of STRUCTURE_LIST_CODES) {
        const text = say(menu, { limit: "list", list, params: { choice: 1, question: 1 }, max: 8, count: 9 });
        expect(text, `${menu} ${list}`).not.toMatch(/exerciseEditor|limits\.|\{/);
      }
    }
  });
});

describe("limitField", () => {
  it("points to the box by the key the editor gives it", () => {
    expect(limitField(followupOutcome)).toBe(
      fieldKey("scenarioFollowupOutcome", { choice: 2, followup: 1 })
    );
    expect(limitField({ limit: "total", max: 1 })).toBeNull();
  });

  it("matches what the server reports for a box", () => {
    const res = sanitizeStructure(
      {
        kind: "simulation",
        prompt: {},
        instruction: {},
        options: [
          { id: "o1", isBest: true, text: {}, feedback: {} },
          { id: "o2", isBest: false, text: {}, feedback: { de: "x".repeat(2_001) } },
        ],
      },
      "simulation"
    );
    expect(!res.ok && res.error === "too-large" && limitField(res.at)).toBe(
      fieldKey("simOptionFeedback", { option: 2 })
    );
  });
});
