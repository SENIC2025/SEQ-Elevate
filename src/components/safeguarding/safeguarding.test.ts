import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import type { SafeguardingContact, SafeguardingSetting } from "@/lib/safeguarding";

/*
 * The safeguarding box, its contacts and the line beside what learners
 * write (D93, spec 11.3; UF2): never empty (112 is in code), the
 * learner's own country's contacts with the organisation's before help
 * lines, the fallback line when there are none, a link to every country's
 * contacts on /help, a box that is a labelled landmark of its own, and a
 * line for reflections that says facilitators don't read them. Real
 * messages behind next-intl's API, in each language.
 */

const MESSAGES = { en, de, el } as const;
let locale: keyof typeof MESSAGES = "en";
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useTranslations: (namespace: string) =>
    createTranslator({ locale, messages: MESSAGES[locale], namespace: namespace as never }),
  useLocale: () => locale,
}));
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, ...rest }: { href: string }) => h("a", { href: `/${locale}${href}`, ...rest }) };
});

// The box's reader: who is asking, and the contacts as saved.
const getViewer = vi.fn();
const loadSafeguarding = vi.fn<() => Promise<SafeguardingSetting>>();
vi.mock("@/lib/scope", () => ({ getViewer }));
vi.mock("@/lib/safeguarding.server", () => ({ loadSafeguarding }));

const { SafeguardingBox } = await import("./SafeguardingBox");
const { SafeguardingBoxView } = await import("./SafeguardingBoxView");
const { SafeguardingHint } = await import("./SafeguardingHint");
const { ContactList } = await import("./ContactList");
const { problemText } = await import("./SafeguardingEditor");

const ORG: SafeguardingContact = {
  kind: "organisation",
  organisation: "Pro Arbeit",
  role: "Safeguarding lead",
  email: "schutz@example.org",
  hours: { en: "Mon–Fri 9–17", de: "Mo–Fr 9–17 Uhr" },
};
const LINE: SafeguardingContact = {
  kind: "helpline",
  organisation: "Nummer gegen Kummer",
  phone: "116 111",
  url: "https://www.nummergegenkummer.de/",
  note: { en: "Free and anonymous." },
};
const SETTING: SafeguardingSetting = { v: 1, contacts: { DE: [LINE, ORG], CY: [{ ...ORG, organisation: "Synthesis" }] }, updatedAt: null };

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const textOf = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

beforeEach(() => {
  locale = "en";
  getViewer.mockResolvedValue({ user: null, roles: [], profile: null, scope: { kind: "none" } });
  loadSafeguarding.mockResolvedValue({ v: 1, contacts: {}, updatedAt: null });
});

describe("SafeguardingBoxView", () => {
  it.each(["en", "de", "el"] as const)("always shows 112 and links every country's contacts (%s)", (l) => {
    locale = l;
    const markup = html(createElement(SafeguardingBoxView, { groups: [] }));
    expect(markup).toContain("112");
    expect(markup).toContain(`href="/${l}/help"`);
    expect(markup).toContain(MESSAGES[l].safeguarding.title);
    // With no contacts, the fallback line.
    expect(markup).toContain(MESSAGES[l].safeguarding.fallback);
  });

  it("is an aside named by its own heading", () => {
    const markup = html(createElement(SafeguardingBoxView, { groups: [] }));
    const labelled = /<aside aria-labelledby="([^"]+)"/.exec(markup)?.[1];
    expect(labelled).toBeTruthy();
    expect(markup).toContain(`<h2 id="${labelled}"`);
  });

  it("names the country and lists its contacts instead of the fallback line", () => {
    const markup = html(createElement(SafeguardingBoxView, { groups: [{ country: "DE", contacts: [ORG, LINE] }] }));
    expect(textOf(markup)).toContain("Contact for Germany:");
    expect(markup).not.toContain(en.safeguarding.fallback);
    expect(markup.indexOf("Pro Arbeit")).toBeLessThan(markup.indexOf("Nummer gegen Kummer"));
    expect(markup).toContain("112");
  });

  it.each([
    ["en", "DE", "Contact for Germany:"],
    ["en", "OTHER", "Contact for other countries:"],
    ["de", "CY", "Ansprechstelle für Zypern:"],
    ["de", "OTHER", "Ansprechstelle für andere Länder:"],
    ["el", "GR", "Επαφή (Ελλάδα):"],
    ["el", "BE", "Επαφή (Βέλγιο):"],
  ] as const)("names a country in the page's language (%s, %s)", (l, country, words) => {
    locale = l;
    expect(textOf(html(createElement(SafeguardingBoxView, { groups: [{ country, contacts: [ORG] }] })))).toContain(words);
  });
});

describe("SafeguardingBox (reads who asks and the contacts)", () => {
  it("shows the viewer's own country's contacts, the organisation's before the help line", async () => {
    getViewer.mockResolvedValue({ user: { id: "u" }, roles: ["LEARNER"], profile: { country: "DE" }, scope: { kind: "none" } });
    loadSafeguarding.mockResolvedValue(SETTING);
    const markup = html(await SafeguardingBox());
    expect(textOf(markup)).toContain("Contact for Germany:");
    expect(markup).not.toContain("Synthesis");
    expect(markup.indexOf("Pro Arbeit")).toBeLessThan(markup.indexOf("Nummer gegen Kummer"));
  });

  it("shows every country's contacts to someone with no country (a guest)", async () => {
    loadSafeguarding.mockResolvedValue(SETTING);
    const text = textOf(html(await SafeguardingBox()));
    expect(text).toContain("Contact for Germany:");
    expect(text).toContain("Contact for Cyprus:");
  });

  it("shows 112 and the fallback line when the viewer's country has none, or nothing could be read", async () => {
    getViewer.mockResolvedValue({ user: { id: "u" }, roles: ["LEARNER"], profile: { country: "GR" }, scope: { kind: "none" } });
    loadSafeguarding.mockResolvedValue(SETTING);
    const markup = html(await SafeguardingBox());
    expect(markup).toContain("112");
    expect(markup).toContain(en.safeguarding.fallback);
    expect(markup).not.toContain("Pro Arbeit");
  });
});

describe("ContactList", () => {
  it("links a phone to call, an address to write to and a website, as plain text", () => {
    const markup = html(createElement(ContactList, { contacts: [ORG, LINE] }));
    expect(markup).toContain('href="tel:116111"');
    expect(markup).toContain('href="mailto:schutz@example.org"');
    expect(markup).toContain('href="https://www.nummergegenkummer.de/"');
    expect(textOf(markup)).toContain("www.nummergegenkummer.de");
    expect(textOf(markup)).toContain("Help line: Nummer gegen Kummer");
    expect(textOf(markup)).toContain("Pro Arbeit · Safeguarding lead");
  });

  it("shows hours and notes in the page's language, else in English marked as English", () => {
    locale = "de";
    const markup = html(createElement(ContactList, { contacts: [ORG, LINE] }));
    expect(markup).toMatch(/<p class="[^"]*">Mo–Fr 9–17 Uhr<\/p>/);
    expect(markup).toMatch(/<p lang="en" class="[^"]*">Free and anonymous\.<\/p>/);
    expect(textOf(markup)).toContain("Hilfetelefon: Nummer gegen Kummer");
  });

  it("never renders a contact's text as markup", () => {
    const markup = html(createElement(ContactList, { contacts: [{ ...ORG, organisation: "<script>x</script>" }] }));
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
  });
});

describe("SafeguardingHint", () => {
  it("links /help beside free text", () => {
    const markup = html(createElement(SafeguardingHint));
    expect(markup).toContain('<a href="/en/help"');
    expect(markup).toContain("Worried about your safety");
  });

  it("says, beside a reflection, that facilitators don't read it", () => {
    locale = "de";
    const markup = html(createElement(SafeguardingHint, { variant: "reflection" }));
    expect(markup).toContain("Die Trainer:innen lesen nicht");
    expect(markup).toContain('<a href="/de/help"');
  });

  it("is one paragraph with one link, the shape the recorded walk expects (R3-D1)", () => {
    const markup = html(createElement(SafeguardingHint, { variant: "reflection" }));
    expect(markup).toMatch(/^<p[^>]*>[^<]*<a href="\/en\/help"[^>]*>[^<]+<\/a>[^<]*<\/p>$/);
  });
});

describe("the admin form's problems, in words", () => {
  it("names the country, the contact and what to change", () => {
    expect(problemText({ country: "DE", index: 1, field: "phone", problem: "invalid" })).toBe(
      "Germany, contact 2: write the phone number in digits, with + first for an international number (e.g. +49 30 1234567 or 116 111)."
    );
    expect(problemText({ country: "OTHER", index: null, field: null, problem: "too-many" })).toBe(
      "Other countries: up to 3 contacts per country."
    );
    expect(problemText({ country: "CY", index: 0, field: "reach", problem: "required" })).toBe(
      "Cyprus, contact 1: give a phone number, an email address or a website."
    );
    expect(problemText({ country: "GR", index: 2, field: "note", problem: "too-long" })).toBe(
      "Greece, contact 3: the note is too long (at most 500 characters)."
    );
  });
});
