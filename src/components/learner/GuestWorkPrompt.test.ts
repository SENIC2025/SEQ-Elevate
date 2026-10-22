import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderIn } from "@/components/course/sectioned/render.test-helpers";
import type { GuestWork } from "@/store/guest-migration";

/*
 * Release 3 (spec 5.5; WCAG 3.1.2): the offer of a guest's work names each
 * course by the title it was recorded with, marked with the language it was
 * recorded in when that isn't the page's. A title from a store written
 * before Release 3 has no language and is shown unmarked (decided at
 * integration: it was stored as the page showed it).
 */

let work: GuestWork | null = null;
vi.mock("@/store/demo-state", () => ({
  useDemoState: () => ({ guestWork: work, guestWorkDone: null, claimGuestWork: vi.fn(), discardGuestWork: vi.fn() }),
}));

const { GuestWorkPrompt } = await import("./GuestWorkPrompt");

const offer = (courses: GuestWork["courses"], locale: "en" | "de" | "el") => {
  work = { courses, compCard: false, reflections: 0, badges: 0 };
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
