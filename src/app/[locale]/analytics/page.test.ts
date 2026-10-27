import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { Role } from "@prisma/client";
import { buildSampleAnalytics } from "@/lib/analytics-sample";

/*
 * The Statistics page (spec 7.5, SP8): staff (canSupportLearners) see the
 * figures of their scope, counted from STATS_FROM, and an empty page says
 * why it is empty — counting hasn't started, no learner of the
 * organisation has started since, or the account isn't linked to an
 * organisation. English only, as the rest of the page.
 */

type Scope =
  | { kind: "project"; viewerId: string; viewerOrganisationId: string | null }
  | { kind: "organisation"; viewerId: string; organisationId: string }
  | { kind: "none" };

const viewer = vi.fn();
const buildRealAnalytics = vi.fn();
const scopeOrganisationName = vi.fn();
vi.mock("@/lib/scope", () => ({ getViewer: () => viewer() }));
vi.mock("@/lib/analytics-real", () => ({ buildRealAnalytics }));
vi.mock("@/lib/server-queries", () => ({ scopeOrganisationName }));
vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));
// The notice's sign-in link reads the session (SignInPrompt.test.ts).
vi.mock("@/components/SignInPrompt", () => ({ SignInPrompt: () => null }));
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: ({ href, ...rest }: { href: string }) => h("a", { href: `/en${href}`, ...rest }),
  };
});

const { default: Page } = await import("./page");

const ORG_A: Scope = { kind: "organisation", viewerId: "fa", organisationId: "org-a" };
const PROJECT: Scope = { kind: "project", viewerId: "as", viewerOrganisationId: null };
const NONE: Scope = { kind: "none" };
const BEFORE = Date.UTC(2026, 9, 21, 12); // 21 October 2026
const AFTER = Date.UTC(2026, 11, 2, 12); // 2 December 2026

/** The page as `roles` with `scope` see it, at `now`, with `real` live figures. */
async function render({
  roles,
  scope,
  organisationId = null,
  organisation = null,
  real = null,
  now = BEFORE,
  live,
}: {
  roles: Role[];
  scope: Scope;
  organisationId?: string | null;
  organisation?: string | null;
  real?: ReturnType<typeof buildSampleAnalytics> | null | "unreadable";
  now?: number;
  live?: string;
}): Promise<string> {
  viewer.mockResolvedValue({ user: { id: "v", email: "v@example.com" }, roles, profile: { organisationId }, scope });
  buildRealAnalytics.mockResolvedValue(real);
  scopeOrganisationName.mockResolvedValue(organisation);
  vi.useFakeTimers({ toFake: ["Date"], now });
  try {
    const element = await Page({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve(live === undefined ? {} : { live }),
    });
    return renderToStaticMarkup(element as ReactElement).replace(/&#x27;/g, "'");
  } finally {
    vi.useRealTimers();
  }
}

/** The live site: test sign-in isn't switched on (D98). */
function liveSite() {
  vi.stubEnv("DEMO_LOGIN_ENABLED", "");
  vi.stubEnv("VERCEL_ENV", "production");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("the Statistics page", () => {
  it("counts from STATS_FROM and shows the figures with the same date", async () => {
    liveSite();
    vi.stubEnv("STATS_FROM", "2026-11-02T08:00:00Z");
    const html = await render({ roles: ["ADMIN"], scope: PROJECT, real: buildSampleAnalytics() });
    expect(buildRealAnalytics).toHaveBeenCalledWith(PROJECT, "en", new Date("2026-11-02T08:00:00Z"));
    expect(html).toContain("Counting from 2 November 2026. Staff, former staff and test accounts are left out.");
  });

  it("names a partner's organisation over its figures", async () => {
    liveSite();
    const html = await render({
      roles: ["FACILITATOR"],
      scope: ORG_A,
      organisationId: "org-a",
      organisation: "Pro Arbeit",
      real: buildSampleAnalytics(),
      now: AFTER,
    });
    expect(scopeOrganisationName).toHaveBeenCalledWith(ORG_A);
    expect(html).toContain(
      "Counting from 1 December 2026. Staff, former staff and test accounts are left out. Pro Arbeit only."
    );
  });

  it("says counting starts on 1 December 2026 while it hasn't", async () => {
    liveSite();
    const html = await render({ roles: ["ADMIN"], scope: PROJECT });
    expect(html).toContain("Counting starts on 1 December 2026.");
    expect(html).not.toContain("No statistics to show yet");
  });

  it("says no learner of the organisation has started since the date, once counting has started", async () => {
    liveSite();
    const html = await render({
      roles: ["PARTNER_ADMIN"],
      scope: ORG_A,
      organisationId: "org-a",
      organisation: "Pro Arbeit",
      now: AFTER,
    });
    expect(html).toContain("No learners in Pro Arbeit have started since 1 December 2026.");
    expect(html).not.toContain("Counting starts");
  });

  it("says no learner has started yet to an ADMIN once counting has started", async () => {
    liveSite();
    const html = await render({ roles: ["ADMIN"], scope: PROJECT, now: AFTER });
    expect(html).toContain("No statistics to show yet.");
  });

  it("with STATS_FROM=off, counts everything and gives no date", async () => {
    liveSite();
    vi.stubEnv("STATS_FROM", "off");
    const html = await render({ roles: ["FACILITATOR"], scope: ORG_A, organisationId: "org-a", organisation: "Pro Arbeit" });
    expect(buildRealAnalytics).toHaveBeenCalledWith(ORG_A, "en", null);
    expect(html).toContain("No learners in Pro Arbeit have started yet.");
  });

  it("tells staff whose account isn't linked to an organisation why they see nothing", async () => {
    liveSite();
    const html = await render({ roles: ["FACILITATOR"], scope: NONE });
    expect(html).toContain("Your account isn't linked to an organisation yet, so no learners are counted.");
    expect(html).not.toContain("Counting starts");
  });

  it("doesn't promise figures to partner staff who see no learners for now (partner access off)", async () => {
    // Review R2 (a): a facilitator whose account has an organisation, while
    // R3_PARTNER_ACCESS is off (before the review, or switched off after
    // launch), has no scope: counting may well have started, and reloading
    // won't help.
    liveSite();
    for (const now of [BEFORE, AFTER]) {
      const html = await render({ roles: ["FACILITATOR"], scope: NONE, organisationId: "org-a", now });
      expect(html).toContain("Statistics can't be shown to your account right now.");
      expect(html).not.toContain("as soon as a learner starts");
      expect(html).not.toContain("Counting starts");
    }
  });

  it("says a read that failed failed, never that no learner has started (spec 7.3)", async () => {
    // Review R2 (b).
    liveSite();
    for (const now of [BEFORE, AFTER]) {
      const html = await render({
        roles: ["FACILITATOR"],
        scope: ORG_A,
        organisationId: "org-a",
        organisation: "Pro Arbeit",
        real: "unreadable",
        now,
      });
      expect(html).toContain("The statistics couldn't be read just now. Try reloading the page in a few minutes.");
      expect(html).not.toContain("No learners in Pro Arbeit have started");
      expect(html).not.toContain("Counting starts");
    }
  });

  it("marks its English as English on a German or Greek page (WCAG 3.1.2), as the dashboard does", async () => {
    liveSite();
    for (const [roles, scope] of [
      [["ADMIN"], PROJECT],
      [["LEARNER"], NONE],
    ] as const) {
      const html = await render({ roles: [...roles], scope });
      expect(html.startsWith('<div lang="en"'), roles.join()).toBe(true);
    }
  });

  it("is for staff only, and reads nothing for anyone else", async () => {
    liveSite();
    const html = await render({ roles: ["LEARNER", "CONTENT_EDITOR"], scope: NONE });
    expect(html).toContain("This dashboard is for facilitators and admins.");
    expect(buildRealAnalytics).not.toHaveBeenCalled();
  });

  describe("on a test copy (test sign-in switched on)", () => {
    function testCopy() {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("DEMO_LOGIN_ENABLED", "true");
      vi.stubEnv("DEMO_ACCESS_CODE", "a-private-code-1");
    }

    it("shows the sample while few learners have started, saying nothing about counting", async () => {
      testCopy();
      const html = await render({ roles: ["ADMIN"], scope: PROJECT });
      expect(html).toContain("sample data");
      expect(html).not.toContain("Counting");
    });

    it("says why there are no live figures when they are asked for (?live=1)", async () => {
      testCopy();
      const html = await render({ roles: ["ADMIN"], scope: PROJECT, live: "1" });
      expect(html).toContain("Counting starts on 1 December 2026.");
      expect(html).not.toContain("sample data");
      const failed = await render({ roles: ["ADMIN"], scope: PROJECT, real: "unreadable", live: "1" });
      expect(failed).toContain("The statistics couldn't be read just now.");
    });

    it("shows the sample, not a failed read, when live figures aren't asked for", async () => {
      testCopy();
      const html = await render({ roles: ["ADMIN"], scope: PROJECT, real: "unreadable" });
      expect(html).toContain("sample data");
      expect(html).not.toContain("View live data");
    });
  });
});
