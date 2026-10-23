import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";

/*
 * Release 3 (spec 4.6, 5.9): the learner side's own wording, rendered with
 * the real messages — counts that read right for one, Greek dates with
 * their article, a guest-work summary that names everything it would add,
 * no reflection placeholder that promises a sharing there is none of, and
 * no hub line that offers staff the learners' reflections.
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

  // Course reflections are seen by no one but the learner (owner's decision,
  // 22 Oct): every placeholder says so, and none promises a sharing. The
  // English change is in the recorded walk's closed list as R3-D2
  // (e2e/fixtures/r3-deltas.ts).
  it.each([
    ["en", /shar/i, /only you see this/i],
    ["de", /teil/i, /nur du siehst das/i],
    ["el", /μοιρασ/i, /μόνο εσύ το βλέπεις/i],
  ] as const)("promises no sharing of a reflection in %s: nothing shares one", (lang, sharing, onlyYou) => {
    const course = (MESSAGES[lang] as { course: Record<string, { reflection?: { placeholder2?: string } }> }).course;
    const placeholders = Object.entries(course).flatMap(([slug, texts]) =>
      texts?.reflection?.placeholder2 ? [[slug, texts.reflection.placeholder2] as const] : []
    );
    expect(placeholders.length, `${lang}: the built-in courses' placeholders`).toBeGreaterThanOrEqual(2);
    for (const [slug, placeholder] of placeholders) {
      expect(placeholder, `${lang} course.${slug}.reflection.placeholder2`).not.toMatch(sharing);
      expect(placeholder, `${lang} course.${slug}.reflection.placeholder2`).toMatch(onlyYou);
    }
  });

  it("words the built-in course's second reflection placeholder as the owner decided", () => {
    expect(en.course.workplaceConflict.reflection.placeholder2).toBe("Be honest. Only you see this.");
    expect(de.course.workplaceConflict.reflection.placeholder2).toBe("Sei ehrlich. Nur du siehst das.");
    expect(el.course.workplaceConflict.reflection.placeholder2).toBe("Πες την αλήθεια. Μόνο εσύ το βλέπεις.");
  });

  // Support learners never shows a learner's reflections (the roster reads
  // none), so the hub doesn't promise them.
  it.each([
    ["en", /reflection/i],
    ["de", /reflexion/i],
    ["el", /αναστοχασ/i],
  ] as const)("doesn't offer staff a learner's reflections on the hub in %s", (lang, reflections) => {
    const desc = (MESSAGES[lang] as { hub: { facilitator: { desc: string } } }).hub.facilitator.desc;
    expect(desc).not.toMatch(reflections);
  });
});
