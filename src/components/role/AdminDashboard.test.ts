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

  it.each([
    ["de", de, "Lernende deiner Organisation"],
    ["el", el, "Εκπαιδευόμενοι του φορέα σου"],
  ])("says so in %s too", (locale, messages, learners) => {
    const html = render({ counts, organisationName: "Synthesis" }, locale, messages as typeof en);
    expect(html).toContain(learners);
    expect(html).toContain("Synthesis");
  });
});
