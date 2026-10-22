import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderIn, textOf } from "@/components/course/sectioned/render.test-helpers";
import type { GuestWork } from "@/store/guest-migration";
import type { GuestCardTooLong, GuestWorkDone } from "@/store/demo-state";

/*
 * Release 3 (spec 5.5; WCAG 3.1.2): the offer of a guest's work names each
 * course by the title it was recorded with, marked with the language it was
 * recorded in when that isn't the page's. A title from a store written
 * before Release 3 has no language and is shown unmarked (decided at
 * integration: it was stored as the page showed it).
 */

let work: GuestWork | null = null;
let done: GuestWorkDone | null = null;
let held: GuestCardTooLong | null = null;
vi.mock("@/store/demo-state", () => ({
  useDemoState: () => ({
    guestWork: work,
    guestWorkDone: done,
    guestCardTooLong: held,
    claimGuestWork: vi.fn(),
    discardGuestWork: vi.fn(),
    shortenGuestCard: vi.fn(),
  }),
}));

const { GuestWorkPrompt } = await import("./GuestWorkPrompt");

const offer = (courses: GuestWork["courses"], locale: "en" | "de" | "el") => {
  work = { courses, compCard: false, cardTooLong: [], texts: [], tooLong: [], reflections: 0, badges: 0 };
  return renderIn(createElement(GuestWorkPrompt), locale);
};

describe("GuestWorkPrompt: the courses' titles", () => {
  it("marks a title recorded in English on a German page as English, and nothing else", () => {
    const html = offer([{ title: "Workplace conflict", locale: "en" }], "de");
    expect(html).toContain('<span lang="en">Workplace conflict</span>');
    expect(html.match(/lang=/g)).toHaveLength(1);
    expect(html).toContain("Comp Card: nein");
  });

  it("leaves a title unmarked when it is in the page's language, or its language wasn't recorded", () => {
    expect(offer([{ title: "Arbeitskonflikt", locale: "de" }], "de")).not.toContain("lang=");
    expect(offer([{ title: "Arbeitskonflikt", locale: null }], "de")).not.toContain("lang=");
    expect(offer([{ title: "Arbeitskonflikt", locale: null }], "de")).toContain("Arbeitskonflikt");
  });

  it("marks each of several titles with its own language", () => {
    const html = offer(
      [
        { title: "Workplace conflict", locale: "en" },
        { title: "Σύγκρουση", locale: "el" },
      ],
      "de"
    );
    expect(html).toContain('<span lang="en">Workplace conflict</span>, <span lang="el">Σύγκρουση</span>');
  });
});

/*
 * Release 3 polish (D80): a Comp Card text longer than a card holds can't
 * be added as it is; the offer shows it to be shortened, with its length,
 * and after an "Add" says which text stayed and what to do.
 */
describe("GuestWorkPrompt: a Comp Card text too long to add", () => {
  const long = "x".repeat(2001);
  const offerLong = (locale: "en" | "de" | "el", outcome: GuestWorkDone | null = null, stayed: GuestCardTooLong | null = null) => {
    work = { courses: [], compCard: true, cardTooLong: [{ field: "difficult", text: long }], texts: [], tooLong: [], reflections: 0, badges: 0 };
    done = outcome;
    held = stayed;
    const html = renderIn(createElement(GuestWorkPrompt), locale);
    work = null;
    done = null;
    held = null;
    return html;
  };

  it("offers it to be shortened: a box labelled with the card's own words, its text, and how many characters too many", () => {
    const html = offerLong("en");
    const text = textOf(html);
    expect(text).toContain("This Comp Card answer is too long to add: an answer can have up to 2,000 characters.");
    expect(text).toContain("What you change here is saved on this browser only.");
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>What was difficult<\/label><textarea[^>]*id="\1"/);
    expect(html).toContain(`>${long}</textarea>`);
    expect(html).toMatch(/aria-invalid="true"/);
    expect(text).toContain("2,001 characters: 1 character too many.");
    // One status in the offer, what became of the work; the length is said
    // politely once it fits, not as a second status.
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('<span aria-live="polite" class="sr-only"></span>');
  });

  it("in German and Greek too", () => {
    const de = textOf(offerLong("de"));
    expect(de).toContain("Diese Antwort in der Comp Card ist zu lang zum Hinzufügen");
    expect(de).toContain("Was schwer war");
    expect(de).toContain("2.001 Zeichen: 1 Zeichen zu viel.");
    const el = textOf(offerLong("el"));
    expect(el).toContain("Αυτή η απάντηση στην Comp Card είναι πολύ μεγάλη για να προστεθεί");
    expect(el).toContain("2.001 χαρακτήρες: 1 χαρακτήρας παραπάνω.");
  });

  it("after an Add, names the text that stayed, says the rest was added, and what to do", () => {
    const text = textOf(offerLong("en", "cardTooLong", { fields: ["difficult"], added: true }));
    expect(text).toContain(
      "Everything else was added to your account. Your Comp Card answer to “What was difficult” wasn't added: it is longer than 2,000 characters. It stays on this browser: shorten it above, then add it, or remove it from this browser."
    );
    const two = textOf(offerLong("en", "cardTooLong", { fields: ["wentWell", "difficult"], added: false }));
    expect(two).toContain("Your Comp Card answers to “What went well” and “What was difficult” weren't added");
    expect(two).not.toContain("Everything else was added");
    expect(textOf(offerLong("de", "cardTooLong", { fields: ["difficult"], added: true }))).toContain(
      "Deine Antwort in der Comp Card zu „Was schwer war“ wurde nicht hinzugefügt"
    );
    expect(textOf(offerLong("el", "cardTooLong", { fields: ["difficult"], added: true }))).toContain("δεν προστέθηκε");
  });
});
