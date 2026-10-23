import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@prisma/client";

/*
 * The one scoping module (D74, D75, spec 3.2): who sees whose learner and
 * people data, failing closed. FD-U2.
 */

vi.mock("server-only", () => ({}));
// Consent can be asked for only once the consent text is final (a draft's
// version starts "draft-", r3-switches.ts): these tests read the rules as
// they are then.
vi.mock("@/messages/en.json", async (importOriginal) => {
  const { default: en } = await importOriginal<{ default: typeof import("@/messages/en.json") }>();
  return { default: { ...en, profile: { ...en.profile, consent: { ...en.profile.consent, version: "2026-11-30" } } } };
});
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));
const getCurrentUser = vi.fn();
const getProjectMemberships = vi.fn();
vi.mock("@/lib/auth-helpers", () => ({
  getCurrentUser: () => getCurrentUser(),
  getProjectMemberships: (p: string) => getProjectMemberships(p),
}));
const findUnique = vi.fn();
const userCount = vi.fn();
const cohortCount = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    projectProfile: { findUnique: (a: unknown) => findUnique(a) },
    user: { count: (a: unknown) => userCount(a) },
    cohort: { count: (a: unknown) => cohortCount(a) },
  },
}));

import {
  MATCH_NOTHING,
  PROJECT,
  cohortInScope,
  cohortsInScope,
  getViewer,
  getViewerScope,
  inScope,
  learnerMembershipsInScope,
  learnerUsersInScope,
  membershipsInScope,
  organisationsInScope,
  peopleInScope,
  requireAdminProject,
  statisticsMembershipsInScope,
  testOnlyScope,
  testOnlyScopeFor as scopeFor,
  type Scope,
} from "./scope";
import { currentTermsVersion } from "./profile";
import { learnerMembershipWhere, learnerUserWhere } from "./learner-scope";

const COMPLETE = {
  organisationId: "org-a",
  country: "DE" as const,
  termsVersion: currentTermsVersion(),
  ageConfirmedAt: new Date("2026-11-20T09:00:00Z"),
  consentAt: null,
};
const ON = { R3_PARTNER_ACCESS: "on" };

// Only the scope module makes a Scope (SS4): tests ask its test-only factory.
const PROJECT_SCOPE: Scope = testOnlyScope({ kind: "project", viewerId: "v", viewerOrganisationId: null });
const ORG_SCOPE: Scope = testOnlyScope({ kind: "organisation", viewerId: "v", organisationId: "org-a" });
const NONE: Scope = testOnlyScope({ kind: "none" });

/** Every path in `value` that holds undefined. */
function undefinedPaths(value: unknown, path = "$"): string[] {
  if (value === undefined) return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => undefinedPaths(v, `${path}[${i}]`));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.entries(value).flatMap(([k, v]) => undefinedPaths(v, `${path}.${k}`));
  }
  return [];
}

describe("scopeFor", () => {
  const scope = (roles: Role[], profile: typeof COMPLETE | null, env: Record<string, string> = ON, name: string | null = "Viewer") =>
    scopeFor({ userId: "v", name, roles, profile }, env);

  it("gives an ADMIN the project, with their own organisation for Comp Cards", () => {
    expect(scope(["ADMIN"], COMPLETE)).toEqual({ kind: "project", viewerId: "v", viewerOrganisationId: "org-a" });
    expect(scope(["ADMIN", "CONTENT_EDITOR"], { ...COMPLETE, organisationId: null as unknown as string })).toEqual({
      kind: "project",
      viewerId: "v",
      viewerOrganisationId: null,
    });
    // Whatever the partner switch says.
    expect(scope(["ADMIN"], COMPLETE, {})).toEqual({ kind: "project", viewerId: "v", viewerOrganisationId: "org-a" });
  });

  it("gives a partner admin or facilitator their organisation, only with R3_PARTNER_ACCESS=on", () => {
    for (const roles of [["FACILITATOR"], ["PARTNER_ADMIN"], ["PARTNER_ADMIN", "CONTENT_EDITOR"], ["LEARNER", "FACILITATOR"]] as Role[][]) {
      expect(scope(roles, COMPLETE), JSON.stringify(roles)).toEqual({
        kind: "organisation",
        viewerId: "v",
        organisationId: "org-a",
      });
      expect(scope(roles, COMPLETE, {}), JSON.stringify(roles)).toEqual(NONE);
      expect(scope(roles, COMPLETE, { R3_PARTNER_ACCESS: "true" }), JSON.stringify(roles)).toEqual(NONE);
    }
  });

  it("gives staff with no organisation no one", () => {
    expect(scope(["FACILITATOR"], { ...COMPLETE, organisationId: null as unknown as string })).toEqual(NONE);
    expect(scope(["PARTNER_ADMIN"], { ...COMPLETE, organisationId: "" })).toEqual(NONE);
  });

  it("gives editors, learners, no role and unknown roles no one", () => {
    for (const roles of [["CONTENT_EDITOR"], ["LEARNER"], ["CONTENT_EDITOR", "LEARNER"], [], ["MENTOR"]] as Role[][]) {
      expect(scope(roles, COMPLETE), JSON.stringify(roles)).toEqual(NONE);
    }
  });

  it("gives anyone whose own profile is incomplete no one, an ADMIN included", () => {
    const incomplete = [
      null,
      { ...COMPLETE, country: null as unknown as "DE" },
      { ...COMPLETE, termsVersion: "an-older-version" },
      { ...COMPLETE, ageConfirmedAt: null as unknown as Date },
    ];
    for (const profile of incomplete) {
      for (const roles of [["ADMIN"], ["FACILITATOR"], ["PARTNER_ADMIN"]] as Role[][]) {
        expect(scope(roles, profile), JSON.stringify([roles, profile])).toEqual(NONE);
      }
    }
    expect(scope(["ADMIN"], COMPLETE, ON, "  ")).toEqual(NONE);
    expect(scope(["ADMIN"], COMPLETE, { ...ON, PROFILE_CONSENT: "required" })).toEqual(NONE);
  });

  it("doesn't need a complete profile with R3_PROFILE_GATE=off, and still needs the rest", () => {
    const off = { ...ON, R3_PROFILE_GATE: "off" };
    expect(scope(["ADMIN"], null, off)).toEqual({ kind: "project", viewerId: "v", viewerOrganisationId: null });
    expect(scope(["FACILITATOR"], { ...COMPLETE, termsVersion: "old" }, off)).toEqual({
      kind: "organisation",
      viewerId: "v",
      organisationId: "org-a",
    });
    expect(scope(["FACILITATOR"], null, off)).toEqual(NONE);
    expect(scope(["FACILITATOR"], COMPLETE, { R3_PROFILE_GATE: "off" })).toEqual(NONE);
    expect(scope(["CONTENT_EDITOR"], COMPLETE, off)).toEqual(NONE);
  });
});

describe("a scope can't be changed in place (SS4)", () => {
  it("every scope the module makes is frozen: a change throws and leaves it as it was", () => {
    const scopes = [
      scopeFor({ userId: "v", name: "V", roles: ["ADMIN"], profile: COMPLETE }, ON),
      scopeFor({ userId: "v", name: "V", roles: ["FACILITATOR"], profile: COMPLETE }, ON),
      scopeFor({ userId: "v", name: "V", roles: ["LEARNER"], profile: COMPLETE }, ON),
      testOnlyScope({ kind: "organisation", viewerId: "v", organisationId: "org-a" }),
    ];
    for (const scope of scopes) {
      const before = JSON.stringify(scope);
      expect(Object.isFrozen(scope), before).toBe(true);
      expect(() => Object.assign(scope, { kind: "project", viewerId: "x", viewerOrganisationId: null }), before).toThrow(TypeError);
      expect(() => Object.defineProperty(scope, "organisationId", { value: "org-b" }), before).toThrow(TypeError);
      expect(JSON.stringify(scope)).toBe(before);
    }
  });

  it("nor can the shape it was made from change it afterwards", () => {
    const shape = { kind: "organisation" as const, viewerId: "v", organisationId: "org-a" };
    const scope = testOnlyScope(shape);
    shape.organisationId = "org-b";
    expect(scope).toEqual({ kind: "organisation", viewerId: "v", organisationId: "org-a" });
  });
});

describe("getViewer", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("R3_PARTNER_ACCESS", "on");
    getCurrentUser.mockReset();
    getProjectMemberships.mockReset();
    findUnique.mockReset();
  });

  it("is nobody, with no scope, when not signed in", async () => {
    getCurrentUser.mockResolvedValue(null);
    const viewer = await getViewer();
    expect(viewer).toEqual({ user: null, roles: [], profile: null, scope: NONE });
    expect(findUnique).not.toHaveBeenCalled();
    // The same "nobody" for every request: neither it nor its roles can be changed.
    expect(Object.isFrozen(viewer) && Object.isFrozen(viewer.roles) && Object.isFrozen(viewer.scope)).toBe(true);
  });

  it("reads the roles and the profile in the project", async () => {
    getCurrentUser.mockResolvedValue({ id: "v", email: "fa@example.com", name: "Fa" });
    getProjectMemberships.mockResolvedValue([{ role: "FACILITATOR" }]);
    findUnique.mockResolvedValue(COMPLETE);
    expect(await getViewer()).toEqual({
      user: { id: "v", email: "fa@example.com" },
      roles: ["FACILITATOR"],
      profile: COMPLETE,
      scope: { kind: "organisation", viewerId: "v", organisationId: "org-a" },
    });
    expect(Object.isFrozen(await getViewer())).toBe(true);
    expect(getProjectMemberships).toHaveBeenCalledWith(PROJECT);
    expect(findUnique).toHaveBeenCalledWith({ where: { userId_projectId: { userId: "v", projectId: PROJECT } } });
    expect(await getViewerScope()).toEqual({ kind: "organisation", viewerId: "v", organisationId: "org-a" });
  });

  it("is nobody when any read fails (SC13), with one log line and no personal data", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failures: (() => void)[] = [
      () => getCurrentUser.mockRejectedValue(new Error("user fa@example.com")),
      () => {
        getCurrentUser.mockResolvedValue({ id: "v", email: "fa@example.com", name: "Fa" });
        getProjectMemberships.mockRejectedValue(new Error("roles of fa@example.com"));
        findUnique.mockResolvedValue(COMPLETE);
      },
      () => {
        getCurrentUser.mockResolvedValue({ id: "v", email: "fa@example.com", name: "Fa" });
        getProjectMemberships.mockResolvedValue([{ role: "ADMIN" }]);
        findUnique.mockRejectedValue(new Error("profile of fa@example.com"));
      },
    ];
    for (const fail of failures) {
      error.mockClear();
      fail();
      expect(await getViewer()).toEqual({ user: null, roles: [], profile: null, scope: NONE });
      expect(error).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(error.mock.calls)).not.toContain("fa@example.com");
    }
    error.mockRestore();
  });
});

/*
 * A page that reads the session can't be prerendered: Next signals that by
 * throwing from the session read, and a redirect is a throw too. getViewer
 * lets those through, so a page is never built once as "nobody" and served
 * so (and the log line stays for real read errors).
 */
describe("getViewer and Next's own signals", () => {
  it.each([
    ["rendering per request", "DYNAMIC_SERVER_USAGE"],
    ["a redirect", "NEXT_REDIRECT;replace;/en/welcome;307;"],
  ])("lets %s through, without a log line", async (_name, digest) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const signal = Object.assign(new Error(digest), { digest });
    getCurrentUser.mockReset();
    getCurrentUser.mockRejectedValue(signal);
    await expect(getViewer()).rejects.toBe(signal);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("the builders", () => {
  const builders = {
    learnerUsersInScope,
    learnerMembershipsInScope,
    statisticsMembershipsInScope: (s: Scope) => statisticsMembershipsInScope(s, new Date("2026-12-01T00:00:00+01:00")),
    statisticsWithoutDate: (s: Scope) => statisticsMembershipsInScope(s, null),
    peopleInScope: (s: Scope) => peopleInScope(s, { ADMIN_EMAILS: "boot@example.com" }),
    membershipsInScope: (s: Scope) => membershipsInScope(s, { ADMIN_EMAILS: "boot@example.com" }),
    organisationsInScope,
    cohortsInScope,
  };

  it.each(Object.entries(builders))("%s matches nothing for 'none'", (_, build) => {
    expect(build(NONE)).toEqual(MATCH_NOTHING);
    expect(MATCH_NOTHING).toEqual({ id: { in: [] } });
  });

  it.each(Object.entries(builders))("%s holds no undefined value at any depth, for any scope", (_, build) => {
    for (const scope of [NONE, PROJECT_SCOPE, ORG_SCOPE]) {
      expect(undefinedPaths(build(scope)), scope.kind).toEqual([]);
    }
  });

  it("gives an ADMIN the D53 rule unchanged", () => {
    expect(learnerUsersInScope(PROJECT_SCOPE)).toEqual(learnerUserWhere(PROJECT));
    expect(learnerMembershipsInScope(PROJECT_SCOPE)).toEqual(learnerMembershipWhere(PROJECT));
  });

  it("adds the organisation with AND, keeping both user filters", () => {
    const where = learnerMembershipsInScope(ORG_SCOPE);
    expect(where).toEqual({
      AND: [
        learnerMembershipWhere(PROJECT),
        { user: { profiles: { some: { projectId: PROJECT, organisationId: "org-a" } } } },
      ],
    });
    // Both `user` filters survive: the D53 rule's and the organisation's.
    const users = (where.AND as { user?: unknown }[]).map((w) => w.user).filter(Boolean);
    expect(users).toHaveLength(2);
    expect(learnerUsersInScope(ORG_SCOPE)).toEqual({
      AND: [learnerUserWhere(PROJECT), { profiles: { some: { projectId: PROJECT, organisationId: "org-a" } } }],
    });
  });

  it("never reads Membership.organisationId for access", () => {
    for (const scope of [PROJECT_SCOPE, ORG_SCOPE]) {
      for (const build of Object.values(builders)) {
        const json = JSON.stringify(build(scope));
        expect(json).not.toMatch(/"memberships":\{[^}]*"organisationId"/);
        expect(json).not.toMatch(/^\{"organisationId"/);
      }
    }
  });

  it("counts for statistics only learners who never held a staff role and aren't test accounts, from the date", () => {
    const from = new Date("2026-12-01T00:00:00+01:00");
    expect(statisticsMembershipsInScope(ORG_SCOPE, from)).toEqual({
      AND: [
        learnerMembershipsInScope(ORG_SCOPE),
        { user: { staffHistory: { none: { projectId: PROJECT } } } },
        { user: { profiles: { none: { projectId: PROJECT, testAccountAt: { not: null } } } } },
        { user: { enrollments: { some: { enrolledAt: { gte: from }, course: { projectId: PROJECT } } } } },
      ],
    });
    expect((statisticsMembershipsInScope(PROJECT_SCOPE, null).AND as unknown[]).length).toBe(3);
  });

  it("leaves ADMIN holders and ADMIN_EMAILS addresses out of an organisation's people", () => {
    expect(peopleInScope(ORG_SCOPE, { ADMIN_EMAILS: "Boot@Example.com; other@example.com" })).toEqual({
      AND: [
        { profiles: { some: { projectId: PROJECT, organisationId: "org-a" } } },
        { memberships: { none: { projectId: PROJECT, role: "ADMIN" } } },
        {
          NOT: {
            OR: [
              { email: { equals: "boot@example.com", mode: "insensitive" } },
              { email: { equals: "other@example.com", mode: "insensitive" } },
            ],
          },
        },
      ],
    });
    expect(peopleInScope(ORG_SCOPE, {})).toEqual({
      AND: [
        { profiles: { some: { projectId: PROJECT, organisationId: "org-a" } } },
        { memberships: { none: { projectId: PROJECT, role: "ADMIN" } } },
      ],
    });
    expect(membershipsInScope(ORG_SCOPE, {})).toEqual({
      AND: [{ projectId: PROJECT }, { user: peopleInScope(ORG_SCOPE, {}) }],
    });
  });

  it("gives an ADMIN everyone with a role or a profile in the project", () => {
    expect(peopleInScope(PROJECT_SCOPE)).toEqual({
      OR: [{ memberships: { some: { projectId: PROJECT } } }, { profiles: { some: { projectId: PROJECT } } }],
    });
    expect(membershipsInScope(PROJECT_SCOPE)).toEqual({ projectId: PROJECT });
  });

  it("covers the viewer's own organisation and its cohorts only", () => {
    expect(organisationsInScope(ORG_SCOPE)).toEqual({ AND: [{ projectId: PROJECT }, { id: "org-a" }] });
    expect(organisationsInScope(PROJECT_SCOPE)).toEqual({ projectId: PROJECT });
    expect(cohortsInScope(ORG_SCOPE)).toEqual({ AND: [{ projectId: PROJECT }, { organisationId: "org-a" }] });
    expect(cohortsInScope(PROJECT_SCOPE)).toEqual({ projectId: PROJECT });
  });
});

describe("inScope and cohortInScope", () => {
  beforeEach(() => {
    userCount.mockReset();
    cohortCount.mockReset();
  });

  it("refuse without a query for 'none' and for anything but an id", async () => {
    expect(await inScope(NONE, "u1")).toBe(false);
    for (const id of ["", null, undefined, 1, ["u1"], { id: "u1" }]) {
      expect(await inScope(ORG_SCOPE, id), String(id)).toBe(false);
      expect(await cohortInScope(PROJECT_SCOPE, id), String(id)).toBe(false);
    }
    expect(await cohortInScope(NONE, "c1")).toBe(false);
    expect(userCount).not.toHaveBeenCalled();
    expect(cohortCount).not.toHaveBeenCalled();
  });

  it("count the one person or cohort within the scope", async () => {
    userCount.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await inScope(ORG_SCOPE, "u1")).toBe(true);
    expect(await inScope(ORG_SCOPE, "u2")).toBe(false);
    expect(userCount.mock.calls[0][0]).toEqual({ where: { AND: [{ id: "u1" }, peopleInScope(ORG_SCOPE)] } });
    cohortCount.mockResolvedValueOnce(1);
    expect(await cohortInScope(ORG_SCOPE, "c1")).toBe(true);
    expect(cohortCount.mock.calls[0][0]).toEqual({ where: { AND: [{ id: "c1" }, cohortsInScope(ORG_SCOPE)] } });
  });
});

describe("requireAdminProject", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("R3_PARTNER_ACCESS", "on");
    getCurrentUser.mockResolvedValue({ id: "v", email: "ad@example.com", name: "Ad" });
    findUnique.mockResolvedValue(COMPLETE);
  });

  it("is the viewer for an ADMIN with project scope", async () => {
    getProjectMemberships.mockResolvedValue([{ role: "ADMIN" }]);
    expect((await requireAdminProject())?.scope.kind).toBe("project");
  });

  it("is null for a partner admin, a facilitator, and an ADMIN without a complete profile", async () => {
    getProjectMemberships.mockResolvedValue([{ role: "PARTNER_ADMIN" }]);
    expect(await requireAdminProject()).toBeNull();
    getProjectMemberships.mockResolvedValue([{ role: "FACILITATOR" }]);
    expect(await requireAdminProject()).toBeNull();
    getProjectMemberships.mockResolvedValue([{ role: "ADMIN" }]);
    findUnique.mockResolvedValue(null);
    expect(await requireAdminProject()).toBeNull();
  });
});
