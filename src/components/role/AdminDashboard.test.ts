import { describe, it, expect, vi } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";

/*
 * The admin overview (spec 6.3, SP10, SP11): an ADMIN's counts are the
 * project's, a partner admin's its organisation's, and the labels say so.
 * Only an ADMIN is offered organisations, the data tools and the
 * safeguarding contacts.
 */

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) =>
    createElement("a", { href, className }, children),
}));

const { AdminDashboard } = await import("./AdminDashboard");

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone?: string;
  children?: ReactNode;
}>;

const counts = { users: 7, cohorts: 2, organisations: 4, courses: 3 };

const render = (props: Parameters<typeof AdminDashboard>[0], locale = "en", messages = en) =>
  renderToStaticMarkup(
    createElement(IntlProvider, { locale, messages, timeZone: "UTC" }, createElement(AdminDashboard, props))
  ).replaceAll("<!-- -->", "");

describe("AdminDashboard", () => {
  it("labels a partner admin's counts as its organisation's, with no organisations count", () => {
    const html = render({ counts, organisationName: "Pro Arbeit" });
    expect(html).toContain("Pro Arbeit overview");
    expect(html).toContain("Learners at your organisation");
    expect(html).toContain("Your organisation&#x27;s cohorts");
    expect(html).not.toContain(">Organisations<");
    expect(html).not.toContain('href="/admin/data"');
    expect(html).not.toContain('href="/admin/safeguarding"');
    expect(html).toContain('href="/admin/people"');
    expect(html).toContain('href="/admin/cohorts"');
  });

  it("gives an ADMIN the project's counts and every tool", () => {
    const html = render({ counts, organisationName: null });
    expect(html).toContain("Admin dashboard");
    expect(html).toContain(">Learners<");
    expect(html).toContain(">Organisations<");
    for (const href of ["/admin/people", "/admin/cohorts", "/admin/data", "/admin/safeguarding"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("says who handles a data request that doesn't come from the person's own account page", () => {
    const admin = render({ counts, organisationName: null });
    expect(admin).not.toContain("no admin step");
    expect(admin).toContain("A request that reaches DIESIS another way is handled on the Data page.");
    const partner = render({ counts, organisationName: "Pro Arbeit" });
    expect(partner).not.toContain("no admin step");
    expect(partner).toContain("Pass a request that reaches you another way to DIESIS.");
  });

  it("says who the Learners figure leaves out (spec 7.4), for an ADMIN and a partner admin", () => {
    for (const organisationName of [null, "Pro Arbeit"]) {
      const html = render({ counts, organisationName });
      expect(html).toContain("Staff, former staff and test accounts left out.");
    }
    // The figure stays right under its label (what reads it on the page).
    expect(render({ counts, organisationName: null })).toMatch(/>Learners<\/p><p[^>]*>7<\/p>/);
  });

  it.each([
    ["de", de, "Ohne Personal, ehemaliges Personal und Testkonten."],
    ["el", el, "Χωρίς προσωπικό, πρώην προσωπικό και δοκιμαστικούς λογαριασμούς."],
  ])("says so in %s too, with the learners called the same in both labels", (locale, messages, note) => {
    for (const organisationName of [null, "Synthesis"]) {
      const html = render({ counts, organisationName }, locale, messages as typeof en);
      expect(html).toContain(note);
      // Greek: learners are "Εκπαιδευόμενοι" in both, never "Μαθητές" (pupils).
      expect(html).not.toContain("Μαθητές");
    }
  });

  it.each([
    ["de", de, "Lernende deiner Organisation"],
    ["el", el, "Εκπαιδευόμενοι του φορέα σου"],
  ])("says so in %s too", (locale, messages, learners) => {
    const html = render({ counts, organisationName: "Synthesis" }, locale, messages as typeof en);
    expect(html).toContain(learners);
    expect(html).toContain("Synthesis");
  });
});
