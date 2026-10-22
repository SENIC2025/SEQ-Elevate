import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderIn, textOf } from "@/components/course/sectioned/render.test-helpers";
import type { GuestWork } from "@/store/guest-migration";
import type { GuestWorkDone } from "@/store/demo-state";

/*
 * Release 3 (spec 5.5; WCAG 3.1.2): the offer of a guest's work names each
 * course by the title it was recorded with, marked with the language it was
 * recorded in when that isn't the page's. A title from a store written
 * before Release 3 has no language and is shown unmarked (decided at
 * integration: it was stored as the page showed it).
 */

let work: GuestWork | null = null;
let done: GuestWorkDone | null = null;
vi.mock("@/store/demo-state", () => ({
  useDemoState: () => ({
    guestWork: work,
    guestWorkDone: done,
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
  const offerLong = (locale: "en" | "de" | "el") => {
    work = { courses: [], compCard: true, cardTooLong: [{ field: "difficult", text: long }], texts: [], tooLong: [], reflections: 0, badges: 0 };
    const html = renderIn(createElement(GuestWorkPrompt), locale);
    work = null;
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
});

/*
 * Release 3 (D37, D69, D79, D80): what became of the work, as the server
 * answered each part. All of it in the account: "Added" (or "already");
 * otherwise one sentence per part, and that what wasn't added stays.
 */
describe("GuestWorkPrompt: what became of the work", () => {
  const said = (outcome: GuestWorkDone, locale: "en" | "de" | "el" = "en") => {
    work = { courses: [{ title: "Workplace conflict", locale: "en" }], compCard: true, cardTooLong: [], texts: [], tooLong: [], reflections: 0, badges: 1 };
    done = outcome;
    const html = renderIn(createElement(GuestWorkPrompt), locale);
    work = null;
    done = null;
    const status = html.match(/<p[^>]*role="status"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
    return { html: status, text: textOf(status) };
  };
  const claimed = (over: Partial<Extract<GuestWorkDone, { kind: "claimed" }>> = {}): GuestWorkDone => ({
    kind: "claimed",
    badgesMoved: 0,
    badgesAlready: 0,
    badgesRefused: 0,
    more: false,
    ...over,
  });
  const course = (outcome: "moved" | "already" | "kept" | "unavailable") => ({ outcome, title: "Workplace conflict", locale: "en" as const });

  it("says Added once all of it is in the account, and already when none of it needed adding", () => {
    expect(said(claimed({ course: course("moved"), compCard: "already", badgesAlready: 1 })).text).toBe("Added to your account.");
    expect(said(claimed({ course: course("already"), compCard: "already", badgesAlready: 1 })).text).toBe("It's already in your account.");
    expect(said(claimed({ course: course("moved"), more: true })).text).toBe(
      "Added to your account. More was saved on this browser while this was being added: it stays on this browser, and is offered again."
    );
  });

  it("otherwise says what became of each part, and that what wasn't added stays", () => {
    expect(said(claimed({ course: course("kept"), compCard: "moved", badgesMoved: 1 })).text).toBe(
      "Your progress in Workplace conflict wasn't added: your account already has progress in this course, which it keeps. Your Comp Card was added to your account. Your badge is in your account. What wasn't added stays on this browser until you remove it."
    );
    expect(said(claimed({ course: course("unavailable"), compCard: "shared", badgesAlready: 1, badgesRefused: 2 })).text).toBe(
      "Your progress in Workplace conflict wasn't added: the course isn't available any more. Your Comp Card wasn't added: your account's Comp Card is shared with your facilitators, and adding never shares it. To add it, set your Comp Card to “Only me” first. Your badge is in your account. 2 badges couldn't be added to your account. What wasn't added stays on this browser until you remove it."
    );
    expect(said(claimed({ compCard: "kept" })).text).toBe(
      "Your Comp Card wasn't added: your account already has a Comp Card with answers in it, which it keeps. What wasn't added stays on this browser until you remove it."
    );
  });

  it("marks the course's title with the language it was recorded in", () => {
    const { html } = said(claimed({ course: course("kept") }), "de");
    expect(html).toContain('Dein Fortschritt in <span lang="en">Workplace conflict</span> wurde nicht hinzugefügt');
  });

  it("says why nothing was added", () => {
    expect(said({ kind: "tooLong", count: 2 }).text).toBe(
      "Nothing was added: 2 answers are too long. Shorten them above, then add your work again, or remove it from this browser."
    );
    expect(said({ kind: "otherAccount" }).text).toBe("Nothing was added: another account is signed in on this browser now.");
    expect(said({ kind: "unconfirmed" }).text).toBe(
      "We couldn't confirm that it was added: the connection failed. It's still on this browser: try again."
    );
    expect(said({ kind: "failed" }).text).toBe("That didn't save. Please try again.");
    expect(said({ kind: "nothing" }).text).toBe("Nothing was added: there is no work on this browser to add any more.");
  });

  it("in German and Greek too", () => {
    expect(said(claimed({ course: course("kept"), badgesMoved: 2 }), "de").text).toContain("Deine 2 Abzeichen sind in deinem Konto.");
    expect(said(claimed({ compCard: "moved" }), "el").text).toBe("Προστέθηκε στον λογαριασμό σου.");
    expect(said({ kind: "tooLong", count: 1 }, "el").text).toContain("μια απάντηση είναι πολύ μεγάλη");
  });
});
