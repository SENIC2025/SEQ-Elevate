import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";

/*
 * Release 3 (spec 4.6, 5.9): the learner side's own wording, rendered with
 * the real messages — counts that read right for one, Greek dates with
 * their article, a guest-work summary that names everything it would add,
 * and no reflection placeholder that promises a sharing there is none of.
 */

const MESSAGES = { en, de, el } as const;
type Lang = keyof typeof MESSAGES;
const tr = (lang: Lang, namespace: string) =>
  createTranslator({ locale: lang, messages: MESSAGES[lang], namespace: namespace as never }) as unknown as (
    key: string,
    values?: Record<string, string | number>
  ) => string;

describe("the learner side's wording", () => {
  it("counts the characters left in the singular for one", () => {
    expect(tr("en", "compCard")("charsLeft", { count: 1 })).toBe("1 character left");
    expect(tr("en", "compCard")("charsLeft", { count: 200 })).toBe("200 characters left");
    expect(tr("de", "compCard")("charsLeft", { count: 1 })).toBe("Noch 1 Zeichen");
    expect(tr("el", "compCard")("charsLeft", { count: 1 })).toBe("Απομένει 1 χαρακτήρας");
    expect(tr("el", "compCard")("charsLeft", { count: 200 })).toBe("Απομένουν 200 χαρακτήρες");
  });

  it("gives a Greek date its article: shared since the 21st", () => {
    expect(tr("el", "compCard")("sharing.sharedSince", { date: "21 Νοεμβρίου 2026" })).toBe(
      "Κοινοποιείται από τις 21 Νοεμβρίου 2026."
    );
  });

  it("counts the badges a guest store holds, so a store of badges alone says what would be added", () => {
    const values = { n: 0, courses: "", compCard: "false", badges: 2 };
    expect(tr("en", "guestWork")("summary", values)).toBe("No course progress. Comp Card: no. Badges: 2.");
    expect(tr("de", "guestWork")("summary", values)).toBe("Kein Kursfortschritt. Comp Card: nein. Abzeichen: 2.");
    expect(tr("el", "guestWork")("summary", values)).toBe("Καμία πρόοδος σε μάθημα. Comp Card: όχι. Σήματα: 2.");
  });

  // English keeps Release 2's wording for now: it is in the recorded walk
  // (e2e/fixtures/r1-learner-baseline.json), whose closed list of Release 3
  // differences (spec 18.4) has no entry for it.
  it.each([["de", /teil/i], ["el", /μοιρασ/i]] as const)(
    "promises no sharing of a reflection in %s: nothing shares one",
    (lang, sharing) => {
      const course = (MESSAGES[lang] as { course: Record<string, { reflection?: { placeholder2?: string } }> }).course;
      for (const [slug, texts] of Object.entries(course)) {
        const placeholder = texts?.reflection?.placeholder2;
        if (placeholder) expect(placeholder, `${lang} course.${slug}.reflection.placeholder2`).not.toMatch(sharing);
      }
    }
  );
});
