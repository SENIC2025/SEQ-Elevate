import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import de from "@/messages/de.json";

/*
 * The admin screens are English on every locale's address (D99: staff
 * screens other than Support learners stay English), so their English is
 * marked as English (WCAG 3.1.2): a screen reader on /de or /el reads it
 * with an English voice. Overview, Manage people, Organisations & cohorts
 * and Data, in every state they can be shown in (as /admin/safeguarding
 * and Statistics already are). On the overview, the figures' labels are
 * translated (the `admin` messages) and stay unmarked; the English around
 * them is marked.
 */

type Scope =
  | { kind: "project"; viewerId: string; viewerOrganisationId: string | null }
  | { kind: "organisation"; viewerId: string; organisationId: string }
  | { kind: "none" };

const PROJECT: Scope = { kind: "project", viewerId: "as", viewerOrganisationId: null };
const ORG_A: Scope = { kind: "organisation", viewerId: "paa", organisationId: "org-a" };
const NONE: Scope = { kind: "none" };

const getViewer = vi.fn();
vi.mock("@/lib/scope", () => ({ getViewer: () => getViewer() }));
vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useTranslations: (namespace: string) => createTranslator({ locale: "de", messages: de, namespace: namespace as never }),
}));
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, ...rest }: { href: string }) => h("a", { href: `/de${href}`, ...rest }) };
});
const getAdminMembers = vi.fn();
const getAdminOrgs = vi.fn();
const getCountryMappings = vi.fn();
vi.mock("@/lib/admin-queries", () => ({
  getAdminMembers: (...a: unknown[]) => getAdminMembers(...a),
  getAdminOrgs: (...a: unknown[]) => getAdminOrgs(...a),
  getCountryMappings: (...a: unknown[]) => getCountryMappings(...a),
  guardianAge: () => 16,
}));
const getAdminCounts = vi.fn();
vi.mock("@/lib/server-queries", () => ({
  getAdminCounts: (...a: unknown[]) => getAdminCounts(...a),
  scopeOrganisationName: async () => "Pro Arbeit",
}));
const getDataTools = vi.fn();
vi.mock("@/lib/account-data", () => ({ getDataTools: () => getDataTools(), brusselsDay: () => "2026-12-01" }));
vi.mock("@/lib/stats-from", () => ({ statsFrom: () => null }));
// The screens' own components: English throughout, placed inside the page.
vi.mock("@/components/role/PeopleManager", () => ({ PeopleManager: () => createElement("p", null, "People manager") }));
vi.mock("@/components/role/OrgCohortManager", () => ({
  OrgCohortManager: () => createElement("p", null, "Organisation manager"),
}));
vi.mock("@/components/role/CountryMappingPanel", () => ({
  CountryMappingPanel: () => createElement("p", null, "Country mapping panel"),
}));
vi.mock("@/components/role/DataTools", () => ({ DataTools: () => createElement("p", null, "Data tools") }));
// The notice's sign-in link reads the session; its language is SignInPrompt.test.ts's.
vi.mock("@/components/SignInPrompt", () => ({ SignInPrompt: () => null }));

const { default: Overview } = await import("./page");
const { default: People } = await import("./people/page");
const { default: Cohorts } = await import("./cohorts/page");
const { default: Data } = await import("./data/page");
const { AdminDashboard } = await import("@/components/role/AdminDashboard");

const params = { params: Promise.resolve({ locale: "de" }) };
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/**
 * Each piece of text in `html` with the language it is in: the `lang` of
 * the nearest element around it that has one (null: the page's own, here
 * German).
 */
function textLanguages(html: string): { text: string; lang: string | null }[] {
  const stack: (string | null)[] = [];
  const out: { text: string; lang: string | null }[] = [];
  const current = () => [...stack].reverse().find((l) => l !== null) ?? null;
  for (const token of html.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith("</")) stack.pop();
    else if (token.startsWith("<")) {
      const name = /^<([a-zA-Z0-9]+)/.exec(token)?.[1]?.toLowerCase() ?? "";
      if (VOID.has(name) || token.endsWith("/>")) continue;
      stack.push(/\slang="([^"]*)"/.exec(token)?.[1] ?? null);
    } else {
      const text = token.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").trim();
      if (text) out.push({ text, lang: current() });
    }
  }
  return out;
}

/** Every text of the page that isn't marked English. */
async function unmarked(page: Promise<unknown> | unknown): Promise<string[]> {
  const html = renderToStaticMarkup((await page) as ReactElement);
  const texts = textLanguages(html);
  expect(texts.length, "the page shows some text").toBeGreaterThan(0);
  return texts.filter((t) => t.lang !== "en").map((t) => t.text);
}

beforeEach(() => {
  getViewer.mockReset();
  getAdminMembers.mockReset().mockResolvedValue([]);
  getAdminOrgs.mockReset().mockResolvedValue([]);
  getCountryMappings.mockReset().mockResolvedValue([]);
  getAdminCounts.mockReset().mockResolvedValue({ users: 3, cohorts: 1, organisations: 2, courses: 4 });
  getDataTools.mockReset();
});

const as = (roles: string[], scope: Scope) =>
  getViewer.mockResolvedValue({ user: { id: "viewer" }, roles, profile: null, scope });

describe("the admin screens' English is marked as English under /de and /el (WCAG 3.1.2)", () => {
  it("Manage people: the page, for an ADMIN and a partner admin, and its notices", async () => {
    as(["ADMIN"], PROJECT);
    expect(await unmarked(People(params))).toEqual([]);
    as(["PARTNER_ADMIN"], ORG_A);
    getAdminOrgs.mockResolvedValue([{ id: "org-a", name: "Pro Arbeit", shortName: "PA", cohorts: [], people: 1, countries: [] }]);
    expect(await unmarked(People(params))).toEqual([]);
    as(["PARTNER_ADMIN"], NONE);
    getAdminMembers.mockResolvedValue(null);
    expect(await unmarked(People(params))).toEqual([]);
    as(["LEARNER"], NONE);
    expect(await unmarked(People(params))).toEqual([]);
  });

  it("Organisations & cohorts: the page, for an ADMIN and a partner admin, and its notices", async () => {
    as(["ADMIN"], PROJECT);
    expect(await unmarked(Cohorts(params))).toEqual([]);
    as(["PARTNER_ADMIN"], ORG_A);
    expect(await unmarked(Cohorts(params))).toEqual([]);
    as(["PARTNER_ADMIN"], NONE);
    getAdminOrgs.mockResolvedValue(null);
    expect(await unmarked(Cohorts(params))).toEqual([]);
    as(["FACILITATOR"], ORG_A);
    expect(await unmarked(Cohorts(params))).toEqual([]);
  });

  it("Data: the page and its notice", async () => {
    getDataTools.mockResolvedValue({ review: {}, log: [] });
    expect(await unmarked(Data(params))).toEqual([]);
    getDataTools.mockResolvedValue(null);
    expect(await unmarked(Data(params))).toEqual([]);
  });

  it("the overview's notices", async () => {
    as(["LEARNER"], NONE);
    expect(await unmarked(Overview(params))).toEqual([]);
    as(["PARTNER_ADMIN"], NONE);
    expect(await unmarked(Overview(params))).toEqual([]);
  });

  it("the overview: the English is marked, the translated figures' labels are not", async () => {
    for (const organisationName of [null, "Pro Arbeit"]) {
      const texts = textLanguages(renderToStaticMarkup(createElement(AdminDashboard, { counts: undefined, organisationName })));
      const german = texts.filter((t) => t.lang !== "en").map((t) => t.text);
      // The heading and the figures, in German (and the figures' numbers).
      expect(german).toContain(organisationName ? "Übersicht: Pro Arbeit" : "Admin-Dashboard");
      expect(german).toContain("Veröffentlichte Kurse");
      expect(german).toContain("DSGVO-Selbstbedienung");
      for (const text of german) {
        expect(text, "only translated text or a number is unmarked").not.toMatch(
          /People & roles|cohort|account page|Counts above|Download a copy|Delete their account|Everyone can/i
        );
      }
      const english = texts.filter((t) => t.lang === "en").map((t) => t.text);
      expect(english).toContain("People & roles");
      expect(english.some((t) => t.startsWith("Counts above are live."))).toBe(true);
    }
  });
});
