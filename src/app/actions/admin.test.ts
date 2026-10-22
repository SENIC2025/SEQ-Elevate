import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Manage people, organisations and cohorts (UA1; spec 3.4 SP16–SP26, 6.3).
 *
 * The role says which powers, the scope whose people: an ADMIN (project
 * scope) manages everyone and is the only one to touch organisations, the
 * country mapping and anyone's country or organisation; a partner admin
 * (organisation scope) manages its own organisation's people, grants only
 * LEARNER and FACILITATOR, and changes or removes only people who hold
 * nothing else. Every organisation change goes through
 * setPersonOrganisation (D101). The scope module, the organisation writer,
 * the limiter and the database are stood in for; what each answers is set
 * per test.
 */

const PROJECT = "seq-elevate";
const ADMIN_USER = { id: "admin-1", email: "admin@example.org", name: "Ada", emailVerified: new Date() };
const PAA_USER = { id: "paa-1", email: "paa@example.org", name: "Pia", emailVerified: new Date() };
const PROJECT_SCOPE = { kind: "project", viewerId: ADMIN_USER.id, viewerOrganisationId: null };
const ORG_A = "org-a";
const ORG_A_SCOPE = { kind: "organisation", viewerId: PAA_USER.id, organisationId: ORG_A };

const getCurrentUser = vi.fn();
const getViewer = vi.fn();
const requireAdminProject = vi.fn();
const inScope = vi.fn();
const cohortInScope = vi.fn();
const organisationsInScope = vi.fn((scope: { kind: string; organisationId?: string }) => ({
  scoped: scope.kind === "project" ? "project" : scope.organisationId,
}));
const membershipsInScope = vi.fn((scope: { kind: string; organisationId?: string }) => ({
  membershipsOf: scope.kind === "project" ? "project" : scope.organisationId,
}));
const getAdminMembers = vi.fn(async () => []);
const getAdminOrgs = vi.fn(async () => []);
const getCountryMappings = vi.fn(async () => []);
const setPersonOrganisation = vi.fn(async () => ({ changed: true }));
const checkRateLimit = vi.fn();
const sendInvitation = vi.fn(async () => ({ ok: true }));

const fn = () => vi.fn();
const db = {
  organisation: { create: fn(), count: fn(), deleteMany: fn() },
  cohort: { count: fn(), create: fn(), updateMany: fn(), deleteMany: fn(), findFirst: fn() },
  countryMapping: { count: fn(), upsert: fn(), findUnique: fn() },
  projectProfile: { count: fn(), findMany: fn(), findUnique: fn(), upsert: fn(), update: fn(), createMany: fn() },
  user: { findFirst: fn(), count: fn(), create: fn(), update: fn(), findUnique: fn(), findUniqueOrThrow: fn() },
  membership: { findMany: fn(), count: fn(), upsert: fn(), delete: fn(), create: fn(), updateMany: fn(), deleteMany: fn() },
  auditLog: { create: fn(), count: fn() },
  compCard: { updateMany: fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
};

vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser }));
vi.mock("@/lib/scope", () => ({
  getViewer,
  requireAdminProject,
  inScope,
  cohortInScope,
  organisationsInScope,
  membershipsInScope,
}));
vi.mock("@/lib/admin-queries", () => ({ getAdminMembers, getAdminOrgs, getCountryMappings }));
vi.mock("@/lib/person-organisation", () => ({ setPersonOrganisation }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/invitations", () => ({ sendInvitation }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const admin = await import("./admin");
const {
  addMember,
  assignCohort,
  createCohort,
  createOrganisation,
  deleteCohort,
  deleteOrganisation,
  removeMember,
  resendInvitation,
  setCountryMapping,
  setGuardianSharing,
  setMemberRoles,
  updateCohort,
  updatePersonProfile,
} = admin;

/** Signed in as an ADMIN with project scope. */
function asAdmin() {
  getCurrentUser.mockResolvedValue(ADMIN_USER);
  getViewer.mockResolvedValue({ user: ADMIN_USER, roles: ["ADMIN"], profile: null, scope: PROJECT_SCOPE });
  requireAdminProject.mockResolvedValue({ user: ADMIN_USER, roles: ["ADMIN"], profile: null, scope: PROJECT_SCOPE });
}

/** Signed in as a partner admin of organisation A. */
function asPartnerAdmin() {
  getCurrentUser.mockResolvedValue(PAA_USER);
  getViewer.mockResolvedValue({ user: PAA_USER, roles: ["PARTNER_ADMIN"], profile: null, scope: ORG_A_SCOPE });
  requireAdminProject.mockResolvedValue(null);
}

/** `userId`'s roles in the project, as membership.findMany answers them. */
function holds(roles: string[]) {
  db.membership.findMany.mockResolvedValue(
    roles.map((role, i) => ({ id: `m-${i}`, role, organisationId: null, cohortId: null }))
  );
}

const WRITES = [
  db.organisation.create,
  db.organisation.deleteMany,
  db.cohort.create,
  db.cohort.updateMany,
  db.cohort.deleteMany,
  db.countryMapping.upsert,
  db.projectProfile.upsert,
  db.projectProfile.update,
  db.user.create,
  db.user.update,
  db.membership.upsert,
  db.membership.delete,
  db.membership.create,
  db.membership.updateMany,
  db.membership.deleteMany,
  db.compCard.updateMany,
  setPersonOrganisation,
];
/** Did anything change (a refusal's own log row aside)? */
const changedAnything = () => WRITES.some((w) => w.mock.calls.length > 0) || auditedActions().some((a) => !a.endsWith("_refused"));
const auditedActions = () => db.auditLog.create.mock.calls.map((c) => (c[0] as { data: { action: string } }).data.action);
const auditRows = (action: string) =>
  db.auditLog.create.mock.calls
    .map((c) => (c[0] as { data: Record<string, unknown> }).data)
    .filter((d) => d.action === action);

beforeEach(() => {
  vi.clearAllMocks();
  for (const group of Object.values(db)) {
    if (typeof group === "function") continue;
    for (const f of Object.values(group)) (f as ReturnType<typeof vi.fn>).mockReset();
  }
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => unknown) => work(db));
  db.auditLog.create.mockResolvedValue({});
  db.auditLog.count.mockResolvedValue(0);
  db.organisation.count.mockResolvedValue(1);
  db.cohort.count.mockResolvedValue(0);
  db.countryMapping.count.mockResolvedValue(0);
  db.projectProfile.count.mockResolvedValue(0);
  db.projectProfile.findUnique.mockResolvedValue(null);
  db.projectProfile.upsert.mockResolvedValue({ id: "profile-1" });
  db.projectProfile.createMany.mockResolvedValue({ count: 0 });
  db.user.findFirst.mockResolvedValue(null);
  db.user.create.mockResolvedValue({ id: "new-user" });
  db.user.findUnique.mockResolvedValue({ name: null });
  db.user.findUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    email: `${where.id}@example.org`,
    name: null,
    emailVerified: null,
  }));
  db.membership.findMany.mockResolvedValue([]);
  db.membership.count.mockResolvedValue(0);
  db.membership.upsert.mockResolvedValue({});
  db.membership.deleteMany.mockResolvedValue({ count: 1 });
  db.membership.updateMany.mockResolvedValue({ count: 1 });
  inScope.mockResolvedValue(true);
  cohortInScope.mockResolvedValue(true);
  checkRateLimit.mockResolvedValue({ ok: true, count: 1, limit: 30 });
  setPersonOrganisation.mockResolvedValue({ changed: true });
  getAdminMembers.mockResolvedValue([]);
  getAdminOrgs.mockResolvedValue([]);
  getCountryMappings.mockResolvedValue([]);
  asAdmin();
});

/* ------------------------------------------------------------------ who --- */

describe("who manages people", () => {
  const calls: [string, () => Promise<{ ok: boolean; error?: string }>][] = [
    ["createOrganisation", () => createOrganisation("Org", "O")],
    ["deleteOrganisation", () => deleteOrganisation("org-b")],
    ["setCountryMapping", () => setCountryMapping("DE", "org-b")],
    ["createCohort", () => createCohort(ORG_A, "Autumn")],
    ["updateCohort", () => updateCohort("cohort-a", { name: "Renamed" })],
    ["deleteCohort", () => deleteCohort("cohort-a")],
    ["addMember", () => addMember("new@example.org", "LEARNER")],
    ["resendInvitation", () => resendInvitation("learner-1")],
    ["setMemberRoles", () => setMemberRoles("learner-1", ["LEARNER"])],
    ["assignCohort", () => assignCohort("learner-1", null)],
    ["removeMember", () => removeMember("learner-1")],
    ["updatePersonProfile", () => updatePersonProfile("learner-1", { name: "Ana" })],
    ["setGuardianSharing", () => setGuardianSharing("learner-1", true)],
  ];

  it.each(calls)("%s refuses a facilitator, and changes nothing", async (_, call) => {
    getViewer.mockResolvedValue({ user: PAA_USER, roles: ["FACILITATOR"], profile: null, scope: ORG_A_SCOPE });
    requireAdminProject.mockResolvedValue(null);
    await expect(call()).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(changedAnything()).toBe(false);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(calls)("%s refuses a partner admin with no scope (partner access off, or no organisation)", async (_, call) => {
    getViewer.mockResolvedValue({ user: PAA_USER, roles: ["PARTNER_ADMIN"], profile: null, scope: { kind: "none" } });
    requireAdminProject.mockResolvedValue(null);
    await expect(call()).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(changedAnything()).toBe(false);
  });

  it.each(calls)("%s refuses an ADMIN whose own profile isn't complete (no scope)", async (_, call) => {
    getViewer.mockResolvedValue({ user: ADMIN_USER, roles: ["ADMIN"], profile: null, scope: { kind: "none" } });
    requireAdminProject.mockResolvedValue(null);
    await expect(call()).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(changedAnything()).toBe(false);
  });

  it("leaves organisations and the country mapping to an ADMIN: a partner admin is refused", async () => {
    asPartnerAdmin();
    await expect(createOrganisation("Org", "O")).resolves.toEqual({ ok: false, error: "forbidden" });
    await expect(deleteOrganisation(ORG_A)).resolves.toEqual({ ok: false, error: "forbidden" });
    await expect(setCountryMapping("DE", ORG_A)).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(changedAnything()).toBe(false);
  });
});

/* -------------------------------------------------------- organisations --- */

describe("deleteOrganisation (SP16)", () => {
  it.each([
    ["has-cohorts", () => db.cohort.count.mockResolvedValue(1)],
    ["has-mapping", () => db.countryMapping.count.mockResolvedValue(1)],
    ["has-people", () => db.projectProfile.count.mockResolvedValue(2)],
  ])("refuses while it %s, and deletes nothing", async (error, given) => {
    given();
    await expect(deleteOrganisation("org-b")).resolves.toEqual({ ok: false, error });
    expect(db.organisation.deleteMany).not.toHaveBeenCalled();
  });

  it("counts the people whose profile names it", async () => {
    await deleteOrganisation("org-b");
    expect(db.projectProfile.count).toHaveBeenCalledWith({ where: { projectId: PROJECT, organisationId: "org-b" } });
  });

  it("answers has-people when the database refuses (someone joined it meanwhile)", async () => {
    db.organisation.deleteMany.mockRejectedValue(Object.assign(new Error("fk"), { code: "P2003" }));
    await expect(deleteOrganisation("org-b")).resolves.toEqual({ ok: false, error: "has-people" });
    expect(auditedActions()).toEqual([]);
  });

  it("deletes one with nobody, no cohort and no country, audited with the scope", async () => {
    const res = await deleteOrganisation("org-b");
    expect(res.ok).toBe(true);
    expect(db.organisation.deleteMany).toHaveBeenCalledWith({ where: { id: "org-b", projectId: PROJECT } });
    expect(auditRows("org.deleted")[0]).toMatchObject({ entityId: "org-b", metadata: { scope: "project" } });
  });
});

/* -------------------------------------------------------------- cohorts --- */

describe("cohorts, in scope only (SP17, SP18)", () => {
  it("a partner admin makes a cohort in its own organisation", async () => {
    asPartnerAdmin();
    db.cohort.create.mockResolvedValue({ id: "cohort-new" });
    const res = await createCohort(ORG_A, "Autumn");
    expect(res.ok).toBe(true);
    expect(organisationsInScope).toHaveBeenCalledWith(ORG_A_SCOPE);
    expect(auditRows("cohort.created")[0]).toMatchObject({ metadata: { scope: ORG_A } });
    expect(getAdminOrgs).toHaveBeenCalledWith(ORG_A_SCOPE);
  });

  it("another organisation's is answered as unknown, and nothing is made", async () => {
    asPartnerAdmin();
    db.organisation.count.mockResolvedValue(0);
    await expect(createCohort("org-b", "Autumn")).resolves.toEqual({ ok: false, error: "unknown-org" });
    expect(changedAnything()).toBe(false);
  });

  it("updates and deletes only a cohort in scope", async () => {
    asPartnerAdmin();
    cohortInScope.mockResolvedValue(false);
    await expect(updateCohort("cohort-b", { name: "Mine now" })).resolves.toEqual({ ok: false, error: "unknown-cohort" });
    await expect(deleteCohort("cohort-b")).resolves.toEqual({ ok: false, error: "unknown-cohort" });
    expect(cohortInScope).toHaveBeenCalledWith(ORG_A_SCOPE, "cohort-b");
    expect(changedAnything()).toBe(false);
  });

  it("a partner admin deletes a cohort of its own when it is shown everyone in it", async () => {
    asPartnerAdmin();
    db.cohort.deleteMany.mockResolvedValue({ count: 1 });
    const res = await deleteCohort("cohort-a");
    expect(res.ok).toBe(true);
    // Asked about the cohort's members it is NOT shown (an ADMIN, an
    // ADMIN_EMAILS address, someone of another organisation).
    expect(db.membership.count).toHaveBeenCalledWith({
      where: { cohortId: "cohort-a", NOT: { membershipsOf: ORG_A } },
    });
    expect(db.cohort.deleteMany).toHaveBeenCalledWith({ where: { id: "cohort-a", projectId: PROJECT } });
    expect(auditedActions()).toEqual(["cohort.deleted"]);
  });

  it("a partner admin can't delete a cohort with someone in it it isn't shown: the question it saw counted only its own people", async () => {
    asPartnerAdmin();
    db.membership.count.mockResolvedValue(1);
    await expect(deleteCohort("cohort-a")).resolves.toEqual({ ok: false, error: "has-others" });
    expect(changedAnything()).toBe(false);
  });

  it("an ADMIN, shown everyone, deletes a cohort whoever is in it", async () => {
    db.membership.count.mockResolvedValue(3);
    db.cohort.deleteMany.mockResolvedValue({ count: 1 });
    const res = await deleteCohort("cohort-a");
    expect(res.ok).toBe(true);
    expect(db.cohort.deleteMany).toHaveBeenCalledWith({ where: { id: "cohort-a", projectId: PROJECT } });
  });

  it("renames a cohort in scope, and returns the organisations as the caller sees them", async () => {
    asPartnerAdmin();
    const res = await updateCohort("cohort-a", { name: "  Spring  " });
    expect(res.ok).toBe(true);
    expect(db.cohort.updateMany).toHaveBeenCalledWith({ where: { id: "cohort-a", projectId: PROJECT }, data: { name: "Spring" } });
    expect(getAdminOrgs).toHaveBeenCalledWith(ORG_A_SCOPE);
  });
});

/* ------------------------------------------------------------ addMember --- */

describe("addMember (SP19)", () => {
  /** An existing account: its row, profile and roles. */
  function existing(over: { profile?: Record<string, unknown> | null; roles?: string[] } = {}) {
    db.user.findFirst.mockResolvedValue({ id: "user-x", email: "x@example.org" });
    db.projectProfile.findUnique.mockResolvedValue(over.profile === undefined ? null : over.profile);
    holds(over.roles ?? []);
  }

  it("a partner admin grants only LEARNER and FACILITATOR", async () => {
    asPartnerAdmin();
    for (const role of ["ADMIN", "PARTNER_ADMIN", "CONTENT_EDITOR"] as const) {
      await expect(addMember("new@example.org", role)).resolves.toEqual({ ok: false, error: "bad-role" });
    }
    expect(changedAnything()).toBe(false);
  });

  it("refuses an address in use outside the partner admin's organisation, and renames nothing", async () => {
    asPartnerAdmin();
    existing({ profile: { organisationId: "org-b", profileCompletedAt: new Date() }, roles: ["LEARNER"] });
    inScope.mockResolvedValue(false);
    db.user.count.mockResolvedValue(0); // not claimable
    await expect(addMember("x@example.org", "LEARNER", "Renamed")).resolves.toEqual({ ok: false, error: "out-of-scope" });
    expect(changedAnything()).toBe(false);
    expect(inScope).toHaveBeenCalledWith(ORG_A_SCOPE, "user-x");
  });

  it("logs a refusal without the address, and counts it against the fail-closed add-by: limit", async () => {
    asPartnerAdmin();
    existing({ profile: { organisationId: "org-b" } });
    inScope.mockResolvedValue(false);
    db.user.count.mockResolvedValue(0);
    await addMember("x@example.org", "LEARNER");
    const [row] = auditRows("member.add_refused");
    expect(row).toMatchObject({ entity: "User", entityId: null, actorId: PAA_USER.id, metadata: { scope: ORG_A, reason: "out-of-scope" } });
    expect(JSON.stringify(db.auditLog.create.mock.calls)).not.toContain("x@example.org");
    expect(checkRateLimit).toHaveBeenCalledWith(`add-by:${PAA_USER.id}`, { limit: 30, windowMs: 3_600_000 });
  });

  it("answers only rate-limited once over the limit, or when the limiter fails (fail closed)", async () => {
    asPartnerAdmin();
    existing({ profile: { organisationId: "org-b" } });
    inScope.mockResolvedValue(false);
    db.user.count.mockResolvedValue(0);
    checkRateLimit.mockResolvedValue({ ok: false, count: 31, limit: 30 });
    await expect(addMember("x@example.org", "LEARNER")).resolves.toEqual({ ok: false, error: "rate-limited" });
    checkRateLimit.mockRejectedValue(new Error("db down"));
    await expect(addMember("x@example.org", "LEARNER")).resolves.toEqual({ ok: false, error: "rate-limited" });
  });

  it("after 30 refusals within the hour refuses every add, before looking anyone up", async () => {
    asPartnerAdmin();
    db.auditLog.count.mockResolvedValue(30);
    await expect(addMember("new@example.org", "LEARNER")).resolves.toEqual({ ok: false, error: "rate-limited" });
    expect(db.user.findFirst).not.toHaveBeenCalled();
    expect(changedAnything()).toBe(false);
    expect(db.auditLog.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ action: "member.add_refused", actorId: PAA_USER.id, projectId: PROJECT }),
    });
  });

  it("claims an account that holds nothing yet, in the partner admin's organisation", async () => {
    asPartnerAdmin();
    existing({ profile: null, roles: [] });
    inScope.mockResolvedValue(false);
    db.user.count.mockResolvedValue(1);
    const res = await addMember("x@example.org", "LEARNER", "Kim");
    expect(res).toMatchObject({ ok: true, id: "user-x" });
    expect(setPersonOrganisation).toHaveBeenCalledWith(db, "user-x", ORG_A, {
      actorId: PAA_USER.id,
      source: "partner-admin",
      scope: ORG_A,
    });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "user-x" }, data: { name: "Kim" } });
    // Claimable: no organisation, never completed, no staff role, no learner data.
    const where = JSON.stringify(db.user.count.mock.calls[0][0]);
    for (const part of ["organisationId", "profileCompletedAt", "enrollments", "compCards", "badges", '"not":"LEARNER"']) {
      expect(where).toContain(part);
    }
  });

  it("never claims an ADMIN_EMAILS address", async () => {
    asPartnerAdmin();
    vi.stubEnv("ADMIN_EMAILS", "x@example.org");
    existing({ profile: null, roles: [] });
    inScope.mockResolvedValue(false);
    db.user.count.mockResolvedValue(1);
    await expect(addMember("x@example.org", "LEARNER")).resolves.toEqual({ ok: false, error: "out-of-scope" });
    vi.unstubAllEnvs();
    expect(changedAnything()).toBe(false);
  });

  it("never adds an ADMIN_EMAILS address, not even one with no account yet (an ADMIN's organisation is set by an ADMIN)", async () => {
    asPartnerAdmin();
    vi.stubEnv("ADMIN_EMAILS", "boss@example.org");
    try {
      // No account yet: nothing to be in scope or to claim.
      db.user.findFirst.mockResolvedValue(null);
      await expect(addMember(" Boss@Example.org", "LEARNER", "Boss")).resolves.toEqual({
        ok: false,
        error: "out-of-scope",
      });
    } finally {
      vi.unstubAllEnvs();
    }
    // Refused before the address is looked up, as any other out-of-scope one.
    expect(db.user.findFirst).not.toHaveBeenCalled();
    expect(changedAnything()).toBe(false);
    expect(auditRows("member.add_refused")[0]).toMatchObject({ entityId: null, metadata: { reason: "out-of-scope" } });
  });

  it("lets an ADMIN add an ADMIN_EMAILS address, with the organisation it picks", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@example.org");
    try {
      const res = await addMember("boss@example.org", "LEARNER", undefined, { organisationId: ORG_A });
      expect(res).toMatchObject({ ok: true, id: "new-user" });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(setPersonOrganisation).toHaveBeenCalledWith(db, "new-user", ORG_A, expect.objectContaining({ source: "admin" }));
  });

  it("adds a role to someone of its own organisation, never renaming someone who completed the profile step", async () => {
    asPartnerAdmin();
    existing({ profile: { organisationId: ORG_A, profileCompletedAt: new Date() }, roles: ["LEARNER"] });
    const res = await addMember("x@example.org", "FACILITATOR", "Renamed");
    expect(res.ok).toBe(true);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(setPersonOrganisation).not.toHaveBeenCalled();
    expect(db.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { userId: "user-x", projectId: PROJECT, role: "FACILITATOR" } })
    );
  });

  it("an ADMIN doesn't rename someone who completed the profile step either", async () => {
    existing({ profile: { organisationId: ORG_A, profileCompletedAt: new Date() }, roles: ["LEARNER"] });
    const res = await addMember("x@example.org", "FACILITATOR", "Renamed");
    expect(res.ok).toBe(true);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("refuses a partner admin someone of its organisation who holds a role it can't grant (another partner admin, an editor)", async () => {
    asPartnerAdmin();
    for (const role of ["PARTNER_ADMIN", "CONTENT_EDITOR"]) {
      existing({ profile: { organisationId: ORG_A, profileCompletedAt: new Date() }, roles: [role] });
      await expect(addMember("x@example.org", "LEARNER")).resolves.toEqual({ ok: false, error: "out-of-scope" });
    }
    expect(changedAnything()).toBe(false);
  });

  it("never changes an existing organisation: an ADMIN asking for another one is told has-organisation", async () => {
    existing({ profile: { organisationId: ORG_A, profileCompletedAt: null }, roles: ["LEARNER"] });
    db.organisation.count.mockResolvedValue(1);
    await expect(addMember("x@example.org", "FACILITATOR", undefined, { organisationId: "org-b" })).resolves.toEqual({
      ok: false,
      error: "has-organisation",
    });
    expect(changedAnything()).toBe(false);
  });

  it("an ADMIN's chosen organisation must be the project's", async () => {
    db.organisation.count.mockResolvedValue(0);
    await expect(addMember("new@example.org", "LEARNER", undefined, { organisationId: "elsewhere" })).resolves.toEqual({
      ok: false,
      error: "unknown-org",
    });
    expect(changedAnything()).toBe(false);
  });

  it("refuses the manager's own address (no one sets their own organisation)", async () => {
    await expect(addMember(" ADMIN@example.org ", "LEARNER", undefined, { organisationId: ORG_A })).resolves.toEqual({
      ok: false,
      error: "self",
    });
    asPartnerAdmin();
    await expect(addMember("paa@example.org", "LEARNER")).resolves.toEqual({ ok: false, error: "self" });
    expect(changedAnything()).toBe(false);
  });

  it("makes a new person in the partner admin's organisation, whatever organisation is sent", async () => {
    asPartnerAdmin();
    const res = await addMember("new@example.org", "LEARNER", "Noa", { organisationId: "org-b" });
    expect(res).toMatchObject({ ok: true, id: "new-user", invite: "not-requested" });
    expect(db.user.create).toHaveBeenCalledWith({ data: { email: "new@example.org", name: "Noa" }, select: { id: true } });
    expect(setPersonOrganisation).toHaveBeenCalledWith(db, "new-user", ORG_A, expect.objectContaining({ source: "partner-admin" }));
    expect(getAdminMembers).toHaveBeenCalledWith(ORG_A_SCOPE);
  });

  it("makes user, membership and profile in one transaction", async () => {
    asPartnerAdmin();
    let inside = false;
    const seen: string[] = [];
    db.$transaction.mockImplementation(async (work: (tx: typeof db) => unknown) => {
      inside = true;
      try {
        return await work(db);
      } finally {
        inside = false;
      }
    });
    db.user.create.mockImplementation(async () => (seen.push(`user:${inside}`), { id: "new-user" }));
    db.membership.upsert.mockImplementation(async () => (seen.push(`membership:${inside}`), {}));
    setPersonOrganisation.mockImplementation(async () => (seen.push(`organisation:${inside}`), { changed: true }));
    await addMember("new@example.org", "LEARNER");
    expect(seen).toEqual(["user:true", "membership:true", "organisation:true"]);
  });

  it("caps a name at the profile step's 50 characters, and refuses one with a line break", async () => {
    await expect(addMember("new@example.org", "LEARNER", "x".repeat(51))).resolves.toEqual({ ok: false, error: "bad-name" });
    await expect(addMember("new@example.org", "LEARNER", "Ana\nBeth")).resolves.toEqual({ ok: false, error: "bad-name" });
    expect(changedAnything()).toBe(false);
  });

  it("records a guardian's permission for a learner, and whether it covers sharing the Comp Card", async () => {
    asPartnerAdmin();
    const res = await addMember("young@example.org", "LEARNER", undefined, { guardianConsent: true, guardianSharing: true });
    expect(res.ok).toBe(true);
    const upsert = db.projectProfile.upsert.mock.calls[0][0] as { create: Record<string, unknown> };
    expect(upsert.create.guardianConsentRecordedAt).toBeInstanceOf(Date);
    expect(upsert.create.guardianSharingConsentAt).toBeInstanceOf(Date);
    expect(auditRows("member.guardian_consent_recorded")[0]).toMatchObject({
      entity: "ProjectProfile",
      entityId: "profile-1",
      metadata: { scope: ORG_A, sharing: true },
    });
  });

  it("records the guardian's permission without sharing unless that is ticked too", async () => {
    await addMember("young@example.org", "LEARNER", undefined, { guardianConsent: true });
    const upsert = db.projectProfile.upsert.mock.calls[0][0] as { create: Record<string, unknown> };
    expect(upsert.create.guardianSharingConsentAt).toBeNull();
    expect(auditRows("member.guardian_consent_recorded")[0]).toMatchObject({ metadata: { sharing: false } });
  });

  it("records a guardian's permission only for a learner who hasn't done the profile step", async () => {
    await expect(addMember("young@example.org", "FACILITATOR", undefined, { guardianConsent: true })).resolves.toEqual({
      ok: false,
      error: "guardian-learner-only",
    });
    existing({ profile: { organisationId: null, profileCompletedAt: new Date() }, roles: ["LEARNER"] });
    await expect(addMember("x@example.org", "LEARNER", undefined, { guardianConsent: true })).resolves.toEqual({
      ok: false,
      error: "guardian-not-needed",
    });
    expect(changedAnything()).toBe(false);
  });

  it("answers a guardian's permission for someone who holds a staff role as one for learners only", async () => {
    // Not done the profile step, but a facilitator: the age isn't why.
    existing({ profile: null, roles: ["FACILITATOR"] });
    await expect(addMember("x@example.org", "LEARNER", undefined, { guardianConsent: true })).resolves.toEqual({
      ok: false,
      error: "guardian-learner-only",
    });
    expect(changedAnything()).toBe(false);
  });

  it("never writes a membership's organisation", async () => {
    await addMember("new@example.org", "LEARNER", undefined, { organisationId: ORG_A });
    expect(JSON.stringify(db.membership.upsert.mock.calls)).not.toContain("organisationId");
    expect(setPersonOrganisation).toHaveBeenCalledWith(db, "new-user", ORG_A, expect.objectContaining({ source: "admin" }));
  });
});

/* ------------------------------------------------------- setMemberRoles --- */

describe("setMemberRoles (SP21)", () => {
  it("refuses switching off your own Admin role, and changes nothing", async () => {
    holds(["ADMIN", "FACILITATOR"]);
    await expect(setMemberRoles(ADMIN_USER.id, ["FACILITATOR"])).resolves.toEqual({ ok: false, error: "own-admin" });
    expect(changedAnything()).toBe(false);
  });

  it("lets you switch your other roles on and off, keeping Admin", async () => {
    holds(["ADMIN"]);
    const res = await setMemberRoles(ADMIN_USER.id, ["ADMIN", "FACILITATOR"]);
    expect(res.ok).toBe(true);
    expect(db.membership.create).toHaveBeenCalledTimes(1);
    expect(db.membership.delete).not.toHaveBeenCalled();
  });

  it("lets an admin switch off another admin's Admin role", async () => {
    holds(["ADMIN", "CONTENT_EDITOR"]);
    const res = await setMemberRoles("admin-2", ["CONTENT_EDITOR"]);
    expect(res.ok).toBe(true);
    expect(db.membership.delete).toHaveBeenCalledWith({ where: { id: "m-0" } });
  });

  it("gives new role rows no organisation (the profile holds it), keeping the cohort", async () => {
    db.membership.findMany.mockResolvedValue([{ id: "m-0", role: "LEARNER", organisationId: "org-b", cohortId: "cohort-a" }]);
    await setMemberRoles("learner-1", ["LEARNER", "FACILITATOR"]);
    expect(db.membership.create).toHaveBeenCalledWith({
      data: { userId: "learner-1", projectId: PROJECT, role: "FACILITATOR", cohortId: "cohort-a" },
    });
  });

  it("answers someone outside the partner admin's organisation as not found", async () => {
    asPartnerAdmin();
    inScope.mockResolvedValue(false);
    await expect(setMemberRoles("learner-b", ["FACILITATOR"])).resolves.toEqual({ ok: false, error: "not-found" });
    expect(inScope).toHaveBeenCalledWith(ORG_A_SCOPE, "learner-b");
    expect(changedAnything()).toBe(false);
  });

  it("never lets a partner admin grant a role beyond LEARNER and FACILITATOR", async () => {
    asPartnerAdmin();
    holds(["FACILITATOR"]);
    for (const role of ["ADMIN", "PARTNER_ADMIN", "CONTENT_EDITOR"] as const) {
      await expect(setMemberRoles("facilitator-a", ["FACILITATOR", role])).resolves.toEqual({ ok: false, error: "not-grantable" });
    }
    expect(changedAnything()).toBe(false);
  });

  it("never lets a partner admin change another partner admin or an editor of its organisation", async () => {
    asPartnerAdmin();
    for (const roles of [["PARTNER_ADMIN"], ["CONTENT_EDITOR"], ["LEARNER", "CONTENT_EDITOR"]]) {
      holds(roles);
      await expect(setMemberRoles("colleague", ["LEARNER"])).resolves.toEqual({ ok: false, error: "not-grantable" });
    }
    expect(changedAnything()).toBe(false);
  });

  it("lets a partner admin make one of its learners a facilitator", async () => {
    asPartnerAdmin();
    holds(["LEARNER"]);
    const res = await setMemberRoles("learner-a", ["LEARNER", "FACILITATOR"]);
    expect(res.ok).toBe(true);
    expect(auditRows("member.roles_changed")[0]).toMatchObject({ entityId: "learner-a", metadata: { scope: ORG_A } });
    expect(getAdminMembers).toHaveBeenCalledWith(ORG_A_SCOPE);
  });
});

/* --------------------------------------------- assignCohort, removeMember --- */

describe("assignCohort (SP22)", () => {
  it("refuses a cohort of another organisation than the person's, and never writes an organisation", async () => {
    db.cohort.findFirst.mockResolvedValue({ organisationId: "org-b" });
    db.projectProfile.findUnique.mockResolvedValue({ organisationId: ORG_A });
    await expect(assignCohort("learner-a", "cohort-b")).resolves.toEqual({ ok: false, error: "cohort-other-organisation" });
    expect(changedAnything()).toBe(false);
  });

  it("puts someone in a cohort of their own organisation, changing only the cohort", async () => {
    db.cohort.findFirst.mockResolvedValue({ organisationId: ORG_A });
    db.projectProfile.findUnique.mockResolvedValue({ organisationId: ORG_A });
    const res = await assignCohort("learner-a", "cohort-a2");
    expect(res.ok).toBe(true);
    expect(db.membership.updateMany).toHaveBeenCalledWith({
      where: { userId: "learner-a", projectId: PROJECT },
      data: { cohortId: "cohort-a2" },
    });
    expect(setPersonOrganisation).not.toHaveBeenCalled();
  });

  it("refuses a partner admin another organisation's person, or cohort", async () => {
    asPartnerAdmin();
    inScope.mockResolvedValue(false);
    await expect(assignCohort("learner-b", "cohort-a")).resolves.toEqual({ ok: false, error: "not-found" });
    inScope.mockResolvedValue(true);
    cohortInScope.mockResolvedValue(false);
    await expect(assignCohort("learner-a", "cohort-b")).resolves.toEqual({ ok: false, error: "unknown-cohort" });
    expect(changedAnything()).toBe(false);
  });
});

describe("removeMember (SP23)", () => {
  it("still refuses removing yourself", async () => {
    await expect(removeMember(ADMIN_USER.id)).resolves.toEqual({ ok: false, error: "self" });
    expect(changedAnything()).toBe(false);
  });

  it("removes someone else's roles, and nothing more (their profile and organisation stay)", async () => {
    holds(["LEARNER"]);
    const res = await removeMember("learner-1");
    expect(res.ok).toBe(true);
    expect(db.membership.deleteMany).toHaveBeenCalledWith({ where: { userId: "learner-1", projectId: PROJECT } });
    expect(setPersonOrganisation).not.toHaveBeenCalled();
    expect(db.projectProfile.upsert).not.toHaveBeenCalled();
  });

  it("never lets a partner admin remove another partner admin, an editor, or someone of another organisation", async () => {
    asPartnerAdmin();
    for (const roles of [["PARTNER_ADMIN"], ["CONTENT_EDITOR"]]) {
      holds(roles);
      await expect(removeMember("colleague")).resolves.toEqual({ ok: false, error: "not-grantable" });
    }
    inScope.mockResolvedValue(false);
    await expect(removeMember("learner-b")).resolves.toEqual({ ok: false, error: "not-found" });
    expect(changedAnything()).toBe(false);
  });
});

describe("resendInvitation (SP20)", () => {
  it("answers someone outside the scope as not found, and sends nothing", async () => {
    asPartnerAdmin();
    inScope.mockResolvedValue(false);
    await expect(resendInvitation("learner-b", "en")).resolves.toEqual({ ok: false, error: "not-found" });
    expect(sendInvitation).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------- updatePersonProfile --- */

describe("updatePersonProfile (SP26)", () => {
  it("moves a learner with a new country to the organisation it is mapped to, through setPersonOrganisation", async () => {
    holds(["LEARNER"]);
    db.projectProfile.findUnique.mockResolvedValue({ country: "DE" });
    db.countryMapping.findUnique.mockResolvedValue({ organisationId: "org-b" });
    const res = await updatePersonProfile("learner-a", { country: "CY" });
    expect(res.ok).toBe(true);
    expect(setPersonOrganisation).toHaveBeenCalledWith(db, "learner-a", "org-b", {
      actorId: ADMIN_USER.id,
      source: "admin",
      scope: "project",
    });
    expect(auditRows("person.country_changed")[0]).toMatchObject({ entity: "ProjectProfile", metadata: { scope: "project" } });
    // The organisation is never written here directly.
    expect(JSON.stringify(db.projectProfile.upsert.mock.calls)).not.toContain("organisationId");
  });

  it("gives a learner of an unmapped country no organisation", async () => {
    holds(["LEARNER"]);
    db.projectProfile.findUnique.mockResolvedValue({ country: "DE" });
    db.countryMapping.findUnique.mockResolvedValue(null);
    await updatePersonProfile("learner-a", { country: "GR" });
    expect(setPersonOrganisation).toHaveBeenCalledWith(db, "learner-a", null, expect.objectContaining({ source: "admin" }));
  });

  it("sends an organisation change alone through setPersonOrganisation too", async () => {
    holds(["LEARNER"]);
    await updatePersonProfile("learner-a", { organisationId: "org-b" });
    expect(setPersonOrganisation).toHaveBeenCalledWith(db, "learner-a", "org-b", expect.objectContaining({ source: "admin" }));
    expect(db.projectProfile.upsert).not.toHaveBeenCalled();
  });

  it("never moves a staff member with their country", async () => {
    holds(["FACILITATOR"]);
    db.projectProfile.findUnique.mockResolvedValue({ country: "DE" });
    db.countryMapping.findUnique.mockResolvedValue({ organisationId: "org-b" });
    await updatePersonProfile("staff-a", { country: "CY" });
    expect(setPersonOrganisation).not.toHaveBeenCalled();
  });

  it("refuses an ADMIN's own country or organisation (no one sets their own)", async () => {
    holds(["ADMIN"]);
    await expect(updatePersonProfile(ADMIN_USER.id, { organisationId: ORG_A })).resolves.toEqual({ ok: false, error: "self" });
    await expect(updatePersonProfile(ADMIN_USER.id, { country: "BE" })).resolves.toEqual({ ok: false, error: "self" });
    expect(changedAnything()).toBe(false);
  });

  it("leaves countries and organisations to an ADMIN: a partner admin is refused", async () => {
    asPartnerAdmin();
    holds(["LEARNER"]);
    await expect(updatePersonProfile("learner-a", { country: "CY" })).resolves.toEqual({ ok: false, error: "forbidden" });
    await expect(updatePersonProfile("learner-a", { organisationId: null })).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(changedAnything()).toBe(false);
  });

  it("lets a partner admin change the name of one of its learners, 1–50 characters, never blank", async () => {
    asPartnerAdmin();
    holds(["LEARNER"]);
    await expect(updatePersonProfile("learner-a", { name: "   " })).resolves.toEqual({ ok: false, error: "bad-name" });
    await expect(updatePersonProfile("learner-a", { name: "y".repeat(51) })).resolves.toEqual({ ok: false, error: "bad-name" });
    expect(changedAnything()).toBe(false);
    const res = await updatePersonProfile("learner-a", { name: " Lea " });
    expect(res.ok).toBe(true);
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "learner-a" }, data: { name: "Lea" } });
    expect(auditRows("person.name_changed")[0]).toMatchObject({ metadata: { scope: ORG_A } });
  });

  it("answers another organisation's person as not found", async () => {
    asPartnerAdmin();
    inScope.mockResolvedValue(false);
    await expect(updatePersonProfile("learner-b", { name: "Mine" })).resolves.toEqual({ ok: false, error: "not-found" });
    expect(changedAnything()).toBe(false);
  });
});

/* ---------------------------------------------------- setCountryMapping --- */

describe("setCountryMapping (SP25)", () => {
  it("maps a country, audited with the scope", async () => {
    const res = await setCountryMapping("DE", ORG_A);
    expect(res).toMatchObject({ ok: true, placed: 0 });
    expect(db.countryMapping.upsert).toHaveBeenCalledWith({
      where: { projectId_country: { projectId: PROJECT, country: "DE" } },
      create: { projectId: PROJECT, country: "DE", organisationId: ORG_A },
      update: { organisationId: ORG_A },
    });
    expect(db.projectProfile.findMany).not.toHaveBeenCalled();
    expect(auditRows("org.country_mapped")[0]).toMatchObject({ entityId: "DE", metadata: { scope: "project", placed: 0 } });
  });

  it("refuses an unknown country or organisation", async () => {
    await expect(setCountryMapping("FR", ORG_A)).resolves.toEqual({ ok: false, error: "bad-country" });
    db.organisation.count.mockResolvedValue(0);
    await expect(setCountryMapping("DE", "elsewhere")).resolves.toEqual({ ok: false, error: "unknown-org" });
    expect(changedAnything()).toBe(false);
  });

  it("with assignUnplaced, places only unplaced learners of that country who weren't released", async () => {
    db.projectProfile.findMany.mockResolvedValue([{ userId: "u1" }, { userId: "u2" }]);
    const res = await setCountryMapping("CY", "org-b", { assignUnplaced: true });
    expect(res).toMatchObject({ ok: true, placed: 2 });
    const where = (db.projectProfile.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ projectId: PROJECT, country: "CY", organisationId: null, profileCompletedAt: { not: null } });
    expect(JSON.stringify(where)).toContain('"released"');
    expect(JSON.stringify(where)).toContain('"not":"LEARNER"');
    for (const u of ["u1", "u2"]) {
      expect(setPersonOrganisation).toHaveBeenCalledWith(db, u, "org-b", {
        actorId: ADMIN_USER.id,
        source: "country",
        scope: "project",
      });
    }
    expect(auditRows("org.country_mapped")[0]).toMatchObject({ metadata: { placed: 2 } });
  });
});

/* --------------------------------------------------- setGuardianSharing --- */

describe("setGuardianSharing (SP19a)", () => {
  it("takes back the sharing permission and unshares the card", async () => {
    asPartnerAdmin();
    holds(["LEARNER"]);
    db.projectProfile.findUnique.mockResolvedValue({
      id: "profile-1",
      guardianConsentRecordedAt: new Date(),
      guardianSharingConsentAt: new Date(),
    });
    const res = await setGuardianSharing("learner-a", false);
    expect(res.ok).toBe(true);
    expect(db.projectProfile.update).toHaveBeenCalledWith({ where: { id: "profile-1" }, data: { guardianSharingConsentAt: null } });
    expect(db.compCard.updateMany).toHaveBeenCalledWith({
      where: { userId: "learner-a", projectId: PROJECT },
      data: { privacy: "SELF", sharedAt: null, sharedWithOrganisationId: null },
    });
    expect(auditRows("member.guardian_consent_recorded")[0]).toMatchObject({ metadata: { scope: ORG_A, sharing: false } });
  });

  it("only for a learner whose guardian's permission was recorded, in scope", async () => {
    asPartnerAdmin();
    holds(["LEARNER"]);
    db.projectProfile.findUnique.mockResolvedValue({ id: "profile-1", guardianConsentRecordedAt: null });
    await expect(setGuardianSharing("learner-a", true)).resolves.toEqual({ ok: false, error: "no-guardian-consent" });
    holds(["LEARNER", "FACILITATOR"]);
    await expect(setGuardianSharing("learner-a", true)).resolves.toEqual({ ok: false, error: "not-learner" });
    inScope.mockResolvedValue(false);
    await expect(setGuardianSharing("learner-b", true)).resolves.toEqual({ ok: false, error: "not-found" });
    expect(changedAnything()).toBe(false);
  });
});

/* ------------------------------------------------------ returned lists --- */

describe("the list an action returns (SP24)", () => {
  it("is read with the caller's scope", async () => {
    holds(["LEARNER"]);
    await removeMember("learner-1");
    expect(getAdminMembers).toHaveBeenCalledWith(PROJECT_SCOPE);
    asPartnerAdmin();
    await removeMember("learner-1");
    expect(getAdminMembers).toHaveBeenLastCalledWith(ORG_A_SCOPE);
  });

  it("is never read, and nothing changes, without a scope", async () => {
    getViewer.mockResolvedValue({ user: ADMIN_USER, roles: ["ADMIN"], profile: null, scope: { kind: "none" } });
    requireAdminProject.mockResolvedValue(null);
    await expect(removeMember("learner-1")).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(changedAnything()).toBe(false);
    expect(getAdminMembers).not.toHaveBeenCalled();
  });
});

/*
 * What is checked before a change is checked again inside its transaction,
 * so a change made meanwhile (an ADMIN granting a role, the person
 * finishing the profile step) never lets a partner admin do what it may
 * not.
 */
describe("checks that hold inside the transaction", () => {
  it("setMemberRoles: someone given a role meanwhile that the partner admin can't grant is left as they are", async () => {
    asPartnerAdmin();
    db.membership.findMany
      .mockResolvedValueOnce([{ id: "m-0", role: "LEARNER" }]) // the check
      .mockResolvedValueOnce([
        { id: "m-0", role: "LEARNER", cohortId: null },
        { id: "m-1", role: "PARTNER_ADMIN", cohortId: null },
      ]); // inside the transaction
    await expect(setMemberRoles("learner-a", ["LEARNER"])).resolves.toEqual({ ok: false, error: "not-grantable" });
    expect(db.membership.delete).not.toHaveBeenCalled();
    expect(auditedActions()).toEqual([]);
  });

  it("removeMember: a partner admin removes only the roles it may grant", async () => {
    asPartnerAdmin();
    holds(["LEARNER"]);
    await removeMember("learner-a");
    expect(db.membership.deleteMany).toHaveBeenCalledWith({
      where: { userId: "learner-a", projectId: PROJECT, role: { in: ["LEARNER", "FACILITATOR"] } },
    });
  });

  it("addMember: someone who got an organisation meanwhile keeps it", async () => {
    asPartnerAdmin();
    db.user.findFirst.mockResolvedValue({ id: "user-x", email: "x@example.org" });
    inScope.mockResolvedValue(false);
    db.user.count.mockResolvedValue(1); // claimable when checked
    holds([]);
    db.projectProfile.findUnique
      .mockResolvedValueOnce(null) // the check
      .mockResolvedValueOnce({ organisationId: "org-b", profileCompletedAt: new Date() }); // inside the transaction
    await expect(addMember("x@example.org", "LEARNER", "Kim")).resolves.toEqual({ ok: false, error: "changed" });
    expect(setPersonOrganisation).not.toHaveBeenCalled();
    expect(db.$queryRaw).toHaveBeenCalled();
  });

  it("addMember: the person's profile row exists before it is locked, so a profile step making it at the same moment is waited for and seen", async () => {
    asPartnerAdmin();
    db.user.findFirst.mockResolvedValue({ id: "user-x", email: "x@example.org" });
    inScope.mockResolvedValue(false);
    db.user.count.mockResolvedValue(1); // claimable when checked: no profile row yet
    holds([]);
    const steps: string[] = [];
    db.projectProfile.createMany.mockImplementation(async () => (steps.push("row"), { count: 0 }));
    db.$queryRaw.mockImplementation(async () => (steps.push("lock"), []));
    db.projectProfile.findUnique
      .mockResolvedValueOnce(null) // the check
      .mockResolvedValueOnce({ organisationId: "org-b", profileCompletedAt: new Date() }); // the profile step's row
    await expect(addMember("x@example.org", "LEARNER")).resolves.toEqual({ ok: false, error: "changed" });
    // An insert that does nothing when the row is there (and waits for one
    // being made), then the lock: the lock always has a row to hold.
    expect(db.projectProfile.createMany).toHaveBeenCalledWith({
      data: [{ userId: "user-x", projectId: PROJECT }],
      skipDuplicates: true,
    });
    expect(steps).toEqual(["row", "lock"]);
    expect(setPersonOrganisation).not.toHaveBeenCalled();
    expect(db.membership.upsert).not.toHaveBeenCalled();
  });
});
