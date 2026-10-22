import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@prisma/client";

/*
 * Release 3 hardening (SS4), at run time: a Scope is a value the scope
 * module made, and nothing else is ever read as one. Every function of the
 * module that takes a Scope checks that the value it is given is one the
 * module made (it keeps them, as they are made), and throws otherwise,
 * before it reads anything of it: no filter is built, no row is counted
 * (fail closed; never a wider filter, nor a narrower one taken for a
 * scope). So whatever gets round the type check and the scope guard
 * (scope-guard.test.ts) — an object from JSON or posted by the browser to a
 * server action, a spread copy, Object.assign onto a new object, a generic
 * class or callback that builds one, a structured clone — is refused when
 * it is used.
 *
 * The first cases are the verifier's (polish2-verify V1, V3, V4): each
 * type-checks, passes the guard, and gave the project's filter, or another
 * organisation's, before the module checked.
 */

vi.mock("server-only", () => ({}));
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
  NotAScopeError,
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
  testOnlyScopeFor,
  type Scope,
  type Viewer,
} from "./scope";

beforeEach(() => {
  vi.clearAllMocks();
  userCount.mockResolvedValue(1);
  cohortCount.mockResolvedValue(1);
});

const PROJECT_JSON = '{"kind":"project","viewerId":"v","viewerOrganisationId":null}';
const mine = testOnlyScope({ kind: "organisation", viewerId: "v", organisationId: "org-a" });

/** Every function of the module that takes a Scope, called with `scope`, its answer awaited. */
const BUILDERS: [string, (scope: Scope) => unknown][] = [
  ["learnerUsersInScope", (s) => learnerUsersInScope(s)],
  ["learnerMembershipsInScope", (s) => learnerMembershipsInScope(s)],
  ["statisticsMembershipsInScope", (s) => statisticsMembershipsInScope(s, null)],
  ["statisticsMembershipsInScope with a date", (s) => statisticsMembershipsInScope(s, new Date("2026-12-01"))],
  ["peopleInScope", (s) => peopleInScope(s, {})],
  ["membershipsInScope", (s) => membershipsInScope(s, {})],
  ["organisationsInScope", (s) => organisationsInScope(s)],
  ["cohortsInScope", (s) => cohortsInScope(s)],
  ["inScope", (s) => inScope(s, "user-1")],
  ["cohortInScope", (s) => cohortInScope(s, "cohort-1")],
];

/** `call` is refused: it throws (or rejects) NotAScopeError, and nothing is read from the database. */
async function refused(call: () => unknown): Promise<void> {
  let thrown: unknown = null;
  try {
    await call();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, "refused").not.toBeNull();
  expect(thrown).toBeInstanceOf(NotAScopeError);
  expect(userCount).not.toHaveBeenCalled();
  expect(cohortCount).not.toHaveBeenCalled();
}

describe("the verifier's ways round the guard are refused at run time (polish2-verify)", () => {
  it("V1: an action taking Pick<Viewer, 'scope'> or Partial<Viewer>, given what the browser posts", async () => {
    async function asViewer(v: Pick<Viewer, "scope">) {
      return learnerUsersInScope(v.scope);
    }
    async function rolesAs(v: Partial<Viewer>) {
      return v.scope ? learnerUsersInScope(v.scope) : null;
    }
    const posted = JSON.parse(`{"scope":${PROJECT_JSON}}`);
    await refused(() => asViewer(posted));
    await refused(() => rolesAs(posted));
  });

  it("V3: a generic class's any comes out as a Scope", async () => {
    class Box<T> {
      constructor(private readonly value: any) {} // eslint-disable-line @typescript-eslint/no-explicit-any
      get(): T {
        return this.value;
      }
    }
    await refused(() => learnerUsersInScope(new Box<Scope>(JSON.parse(PROJECT_JSON)).get()));
  });

  it("V3/V4: a generic class's spread, and a generic function handing its spread to a callback", async () => {
    class Patch<T extends object> {
      constructor(private readonly base: T) {}
      with(p: Partial<T>): T {
        return { ...this.base, ...p };
      }
    }
    function withPatch<T extends object, R>(base: T, patch: Partial<T>, then: (value: T) => R): R {
      return then({ ...base, ...patch });
    }
    await refused(() => peopleInScope(new Patch(mine).with({ organisationId: "org-b" }), {}));
    await refused(() => withPatch(mine, { organisationId: "org-b" }, (s) => peopleInScope(s, {})));
  });

  it("V4: a generic function handing what it parsed to a callback", async () => {
    function withParsed<T, R>(raw: string, then: (value: T) => R): R {
      return then(JSON.parse(raw));
    }
    await refused(() => withParsed<Scope, unknown>(PROJECT_JSON, (s) => learnerUsersInScope(s)));
  });
});

describe("a value the scope module didn't make is never a Scope (SS4, at run time)", () => {
  const real = testOnlyScope({ kind: "project", viewerId: "v", viewerOrganisationId: null });
  // Each is a value of a real scope's shape and values (or another
  // organisation's), made outside the module.
  const forged: [string, () => unknown][] = [
    ["an object from JSON", () => JSON.parse(PROJECT_JSON)],
    ["a frozen literal", () => Object.freeze({ kind: "project", viewerId: "v", viewerOrganisationId: null })],
    ["a spread copy", () => ({ ...real })],
    ["a spread copy with another organisation", () => ({ ...mine, organisationId: "org-b" })],
    ["Object.assign onto a new object", () => Object.assign({}, mine, { organisationId: "org-b" })],
    ["a structured clone", () => structuredClone(real)],
    ["a JSON round trip", () => JSON.parse(JSON.stringify(real))],
    ["an object whose prototype is a real scope", () => Object.create(real)],
    ["a proxy of a real scope", () => new Proxy(real, {})],
    ["a none of its own", () => ({ kind: "none" })],
    ["null", () => null],
    ["undefined", () => undefined],
    ["a string", () => "project"],
  ];
  for (const [what, make] of forged) {
    it(`refuses ${what}, in every function that takes a Scope`, async () => {
      for (const [, use] of BUILDERS) await refused(() => use(make() as Scope));
    });
  }

  it("says what it refused, and nothing of the value", async () => {
    const secret = { kind: "organisation", viewerId: "someone@example.org", organisationId: "org-secret" };
    let message = "";
    try {
      peopleInScope(secret as unknown as Scope);
    } catch (e) {
      message = e instanceof Error ? e.message : "";
    }
    expect(message).toMatch(/not a scope made by the scope module/i);
    expect(message).not.toContain("someone@example.org");
    expect(message).not.toContain("org-secret");
  });

  it("accepts the scopes the module made: the tests' own, getViewer's (nobody's too), and the same scope again", async () => {
    vi.stubEnv("R3_PROFILE_GATE", "off");
    getCurrentUser.mockResolvedValue({ id: "v", email: "v@example.org", name: "V" });
    getProjectMemberships.mockResolvedValue([{ role: "ADMIN" as Role }]);
    findUnique.mockResolvedValue(null);
    const fromViewer = await getViewerScope();
    getCurrentUser.mockResolvedValueOnce(null);
    const nobody = (await getViewer()).scope;
    const scopes = [
      nobody,
      real,
      mine,
      testOnlyScope({ kind: "none" }),
      testOnlyScopeFor({ userId: "u", name: "N", roles: ["ADMIN"], profile: null }, { R3_PROFILE_GATE: "off" }),
      fromViewer,
      (await getViewer()).scope,
    ];
    for (const scope of scopes) {
      for (const [, use] of BUILDERS) expect(await use(scope)).toBeDefined();
    }
    expect(learnerUsersInScope(mine)).toEqual(learnerUsersInScope(mine));
    expect(await requireAdminProject()).not.toBeNull();
    vi.unstubAllEnvs();
  });
});
