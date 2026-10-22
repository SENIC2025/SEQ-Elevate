import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";

/*
 * Release 4 spec 6.1–6.2 (U17), Part B: every new message key, in English,
 * German and Greek, in new namespaces at the end of each file, so Stream R
 * only changes values (messages-parity.test.ts keeps the three in step).
 * English is final; German and Greek are drafts for partner review.
 * lessonLinks.email is Part A's (r4a-message-keys.test.ts).
 */

/** The English the spec gives, key by key. */
const SPEC_ENGLISH: Record<string, string> = {
  "furtherReading.title": "Further reading",
  "furtherReading.language.en": "In English",
  "furtherReading.language.de": "In German",
  "furtherReading.language.el": "In Greek",
  "courseReferences.title": "References & bibliography",
  "courseReferences.back": "Back to the course",
  "courseReferences.closeTab": "Close this tab to return to your lesson.",
  "courseReferences.shownIn.en": "This list is in English.",
  "courseReferences.shownIn.de": "This list is in German.",
  "courseReferences.shownIn.el": "This list is in Greek.",
  "courseReferences.metaTitle": "References & bibliography: {course}",
  "courseReading.references.heading": "References & bibliography",
  "courseReading.references.hint":
    "One entry per paragraph, in APA 7 style; use italics for titles. Learners find the list on its own page, linked from the course. It goes live when you save.",
  "courseReading.references.languageNote":
    "Learners using German or Greek see the list in their language if you write one here; otherwise they see the English list.",
  "courseReading.references.empty": "No list in this language yet.",
  "courseReading.references.save": "Save list",
  "courseReading.references.saved": "Saved. Learners see it now.",
  "courseReading.references.discard": "Discard changes",
  "courseReading.references.changedElsewhere":
    "Someone else saved this list since you opened it. Load their version, then make your change again.",
  "courseReading.references.reload": "Load their version",
  "courseReading.read.links": "Further reading",
  "courseReading.read.noLinks": "No further reading",
  "courseReading.for": "For: {languages}",
  "courseReading.deleteLinks": "{count, plural, one {# further-reading link} other {# further-reading links}}",
};
const KEYS = Object.keys(SPEC_ENGLISH);

/** The namespaces Release 4 adds, in the order they end each file. */
const NAMESPACES = ["furtherReading", "courseReferences", "courseReading"];

/** Keys Release 4 reuses rather than copies (spec 6.1). */
const REUSED = [
  "courseManager.page.read.draftDocument",
  "courseManager.languageName.en",
  "courseManager.languageName.de",
  "courseManager.languageName.el",
  "lessonLinks.newTab",
];

const at = (messages: unknown, path: string) =>
  path.split(".").reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], messages);

/** Every key under a namespace, as dotted paths. */
function keysOf(node: unknown, prefix: string): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node).flatMap(([k, v]) => keysOf(v, `${prefix}.${k}`));
}

describe("Release 4's message keys (Part B)", () => {
  it.each(Object.entries({ en, de, el }))("are all in %s, with some text", (_, messages) => {
    for (const key of KEYS) {
      const value = at(messages, key);
      expect(typeof value === "string" && value.trim() !== "", key).toBe(true);
    }
  });

  it("say in English what the spec says", () => {
    for (const [key, text] of Object.entries(SPEC_ENGLISH)) expect(at(en, key), key).toBe(text);
  });

  it.each(Object.entries({ en, de, el }))("are new namespaces at the end of %s, holding these keys and no others", (_, messages) => {
    expect(Object.keys(messages).slice(-NAMESPACES.length)).toEqual(NAMESPACES);
    const held = NAMESPACES.flatMap((ns) => keysOf(at(messages, ns), ns)).sort();
    expect(held).toEqual([...KEYS].sort());
  });

  it.each(Object.entries({ de, el }))("are translated: %s differs from English where the words do", (_, messages) => {
    for (const key of KEYS) {
      const english = at(en, key) as string;
      if (/[a-z]{4,}/i.test(english.replace(/\{[^}]*\}|<[^>]*>/g, ""))) expect(at(messages, key), key).not.toBe(english);
    }
  });

  it("speak to German readers with du, and call Greek learners μαθητές, as the platform does", () => {
    for (const key of KEYS) expect(at(el, key), key).not.toMatch(/εκπαιδευόμεν/);
    expect(at(el, "courseReading.references.hint")).toMatch(/μαθητές/);
    expect(at(de, "courseReading.references.hint")).toMatch(/\bdu speicherst\b/);
    expect(at(de, "courseReferences.closeTab")).toMatch(/^Schließe\b.*\bdeiner\b/);
  });

  it("keep the keys Release 4 reuses", () => {
    for (const messages of [en, de, el]) {
      for (const key of REUSED) expect(typeof at(messages, key), key).toBe("string");
    }
  });
});
