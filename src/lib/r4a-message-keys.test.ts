import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";

/*
 * Release 4 spec 6.1 (U17), Part A: the one key Part A adds,
 * lessonLinks.email, what screen readers hear after an email link (D105),
 * beside lessonLinks.newTab, which web links keep. It is the only key
 * Release 4 adds inside an existing namespace; Part B's keys are in new
 * namespaces (r4b-message-keys.test.ts). English is final; German and
 * Greek are drafts for partner review (messages-parity.test.ts keeps the
 * three in step).
 */

/** lessonLinks, as the spec gives it in each language. */
const LESSON_LINKS = {
  en: { newTab: "(opens in a new tab)", email: "(opens your email program)" },
  de: { newTab: "(öffnet in einem neuen Tab)", email: "(öffnet dein E-Mail-Programm)" },
  el: { newTab: "(ανοίγει σε νέα καρτέλα)", email: "(ανοίγει το πρόγραμμα email σου)" },
} as const;

describe("Release 4's message keys (Part A)", () => {
  it.each(Object.entries({ en, de, el }))("hold lessonLinks.email in %s, beside lessonLinks.newTab, and nothing else", (locale, messages) => {
    expect(messages.lessonLinks).toEqual(LESSON_LINKS[locale as keyof typeof LESSON_LINKS]);
  });

  it("are translated, in parentheses as the new-tab words are, and speak to German readers with du", () => {
    for (const messages of [de, el]) expect(messages.lessonLinks.email).not.toBe(en.lessonLinks.email);
    for (const messages of [en, de, el]) expect(messages.lessonLinks.email).toMatch(/^\(.+\)$/);
    expect(de.lessonLinks.email).toMatch(/\bdein\b/);
  });
});
