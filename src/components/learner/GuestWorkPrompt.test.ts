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
let pinned = false;
let changed = false;
vi.mock("@/store/demo-state", () => ({
  useDemoState: () => ({
    guestWork: work,
    guestWorkDone: done,
    signedInElsewhere: pinned,
    guestStoreChanged: changed,
    claimGuestWork: vi.fn(),
    discardGuestWork: vi.fn(),
    shortenGuestCard: vi.fn(),
  }),
}));

const { GuestWorkPrompt } = await import("./GuestWorkPrompt");

const offer = (courses: GuestWork["courses"], locale: "en" | "de" | "el") => {
  work = { courses, compCard: false, texts: [], tooLong: [], reflections: 0, badges: 0 };
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
 * Release 3 (D79, D80, D62.d): a text too long to add — a Comp Card answer
 * over 2,000 characters, a reflection answer over 5,000 — can't be added as
 * it is, and nothing is while there is one: the offer shows each to be
 * shortened, with its length against its own limit. Work too big to add
 * offers every answer it holds.
 */
describe("GuestWorkPrompt: texts too long to add", () => {
  const card = "x".repeat(2001);
  const reflection = "y".repeat(5003);
  const at = {
    card: { ref: { part: "compCard", field: "difficult" }, text: card, max: 2000 },
    reflection: { ref: { part: "course", key: "reflection/main", prompt: "p2" }, text: reflection, max: 5000, n: 2 },
    short: { ref: { part: "course", key: "s-abcdefgh/p-abcdefgh", prompt: "q1" }, text: "fine", max: 5000, n: 3 },
  } as const;
  const offer = (locale: "en" | "de" | "el", outcome: GuestWorkDone | null = null) => {
    work = {
      courses: [{ title: "Workplace conflict", locale: "en" }],
      compCard: true,
      texts: [at.reflection, at.short, at.card],
      tooLong: [at.reflection, at.card],
      reflections: 2,
      badges: 0,
    };
    done = outcome;
    const html = renderIn(createElement(GuestWorkPrompt), locale);
    work = null;
    done = null;
    return html;
  };

  it("says to add it before anything else is started in the account", () => {
    expect(textOf(offer("en"))).toContain(
      "Add it before you start anything else in your account: where your account already has its own progress in the course, or its own Comp Card, it keeps its own, and this can't be added."
    );
    expect(textOf(offer("de"))).toContain("Füge es hinzu, bevor du in deinem Konto etwas anderes anfängst");
    expect(textOf(offer("el"))).toContain("Πρόσθεσέ την πριν ξεκινήσεις οτιδήποτε άλλο στον λογαριασμό σου");
  });

  it("offers each to be shortened: a labelled box, its text, and how many characters too many for its limit", () => {
    const html = offer("en");
    const text = textOf(html);
    expect(text).toContain("These answers are too long to add. Shorten them here, then add your work to your account.");
    expect(text).toContain("What you change here is saved on this browser only.");
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>Reflection answer 2<\/label><textarea[^>]*id="\1"/);
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>What was difficult<\/label><textarea[^>]*id="\1"/);
    expect(html).toContain(`>${reflection}</textarea>`);
    expect(html).toContain(`>${card}</textarea>`);
    expect(html).not.toContain(">fine</textarea>");
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);
    expect(text).toContain("5,003 of at most 5,000 characters: 3 characters too many.");
    expect(text).toContain("2,001 of at most 2,000 characters: 1 character too many.");
    // One status in the offer, what became of the work; the length is said
    // politely once it fits, not as a second status.
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('<span aria-live="polite" class="sr-only"></span>');
  });

  it("in German and Greek too", () => {
    const de = textOf(offer("de"));
    expect(de).toContain("Diese Antworten sind zu lang zum Hinzufügen");
    expect(de).toContain("Reflexionsantwort 2");
    expect(de).toContain("Was schwer war");
    expect(de).toContain("2.001 von höchstens 2.000 Zeichen: 1 Zeichen zu viel.");
    const el = textOf(offer("el"));
    expect(el).toContain("Αυτές οι απαντήσεις είναι πολύ μεγάλες για να προστεθούν");
    expect(el).toContain("Απάντηση αναστοχασμού 2");
    expect(el).toContain("2.001 από το πολύ 2.000 χαρακτήρες: 1 χαρακτήρας παραπάνω.");
  });

  it("work too big to add offers every answer it holds", () => {
    const html = offer("en", { kind: "tooLarge" });
    expect(textOf(html)).toContain("Shorten some of these answers here, then add your work to your account.");
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>Reflection answer 3<\/label><textarea[^>]*id="\1"[^>]*>fine<\/textarea>/);
    expect(textOf(html)).toContain("4 of 5,000 characters: short enough to add.");
  });
});

/*
 * Release 3 (D37, D69, D79, D80): what became of the work, as the server
 * answered each part. All of it in the account: "Added" (or "already");
 * otherwise one sentence per part, and that what wasn't added stays.
 */
describe("GuestWorkPrompt: what became of the work", () => {
  const said = (outcome: GuestWorkDone, locale: "en" | "de" | "el" = "en") => {
    work = { courses: [{ title: "Workplace conflict", locale: "en" }], compCard: true, texts: [], tooLong: [], reflections: 0, badges: 1 };
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
      "Added to your account. More was saved on this browser while this was being added: that wasn't added, and stays on this browser."
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

/*
 * Release 3 (D79, IL-2b): a guest's page kept the guest's says so, and
 * that leaving or reloading it carries on with the account; once its work
 * was added, removed or changed in another tab, it says it saves no more.
 * Each a status with a way to reload, the offer left out.
 */
describe("GuestWorkPrompt: a guest's page kept the guest's", () => {
  const shown = (p: boolean, c: boolean) => {
    pinned = p;
    changed = c;
    work = { courses: [], compCard: true, texts: [], tooLong: [], reflections: 0, badges: 0 };
    const html = renderIn(createElement(GuestWorkPrompt), "en");
    pinned = false;
    changed = false;
    work = null;
    return { html, text: textOf(html) };
  };

  it("says it is still the guest's, and that another page or a reload carries on with the account", () => {
    const { html, text } = shown(true, false);
    expect(text).toContain("You've signed in in another tab.");
    expect(text).toContain("Going to another page, or reloading this one, carries on with your account");
    expect(text).toContain("Reload this page");
    expect(text).not.toContain("Add it to my account");
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it("says it saves no more once the work was changed in another tab, kept the guest's or not", () => {
    for (const p of [true, false]) {
      const { text } = shown(p, true);
      expect(text).toContain("The work saved on this browser was changed in another tab: added to an account, removed, or changed there. Nothing more on this page is saved.");
      expect(text).not.toContain("You've signed in in another tab.");
      expect(text).toContain("Reload this page");
    }
  });
});
