import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@prisma/client";

/*
 * The one writer of a person's organisation (D101, spec 3.2). FD-U18: a
 * change resets Comp Card sharing, clears other organisations' cohorts,
 * records who set it and audits; no change writes nothing; an admin can't
 * set their own.
 */

vi.mock("server-only", () => ({}));

import { releaseIfCountryElsewhere, setPersonOrganisation } from "./person-organisation";

function fakeTx(
  current: Record<string, unknown> | null,
  organisations = ["org-a", "org-b"],
  mapping: Record<string, string> = { DE: "org-a", CY: "org-b" }
) {
  const calls: { op: string; args: unknown }[] = [];
  const log = (op: string, answer?: unknown) =>
    vi.fn(async (args?: unknown) => {
      calls.push({ op, args });
      return typeof answer === "function" ? (answer as (a: unknown) => unknown)(args) : answer;
    });
  const tx = {
    organisation: {
      count: log("organisation.count", (a: { where: { id: string } }) => (organisations.includes(a.where.id) ? 1 : 0)),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ op: "$queryRaw", args: { sql: strings.join("?"), values } });
      return [];
    }),
    projectProfile: {
      findUnique: log("projectProfile.findUnique", current),
      upsert: log("projectProfile.upsert", { id: current?.id ?? "pp-new" }),
    },
    countryMapping: {
      findUnique: log("countryMapping.findUnique", (a: { where: { projectId_country: { country: string } } }) => {
        const id = mapping[a.where.projectId_country.country];
        return id ? { organisationId: id } : null;
      }),
    },
    compCard: { updateMany: log("compCard.updateMany", { count: 1 }) },
    membership: { updateMany: log("membership.updateMany", { count: 1 }) },
    auditLog: { create: log("auditLog.create", {}) },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, calls, ops: () => calls.map((c) => c.op) };
}

const writes = (ops: string[]) => ops.filter((op) => !/count|findUnique|\$queryRaw/.test(op));
const argsOf = (calls: { op: string; args: unknown }[], op: string) => calls.find((c) => c.op === op)?.args;

describe("setPersonOrganisation", () => {
  it("on a change: sets it with its source, unshares the card, clears other cohorts, audits", async () => {
    const { tx, calls, ops } = fakeTx({ id: "pp-1", organisationId: "org-a" });
    expect(await setPersonOrganisation(tx, "u1", "org-b", { actorId: "admin-1", source: "admin", scope: "project" })).toEqual({
      changed: true,
    });
    expect(writes(ops())).toEqual([
      "projectProfile.upsert",
      "compCard.updateMany",
      "membership.updateMany",
      "auditLog.create",
    ]);
    const args = (op: string) => calls.find((c) => c.op === op)!.args;
    expect(args("projectProfile.upsert")).toEqual({
      where: { userId_projectId: { userId: "u1", projectId: "seq-elevate" } },
      create: { userId: "u1", projectId: "seq-elevate", organisationId: "org-b", organisationSource: "admin" },
      // Leaving A takes A's record of a guardian's permission with it (spec 5.6).
      update: {
        organisationId: "org-b",
        organisationSource: "admin",
        guardianConsentRecordedAt: null,
        guardianSharingConsentAt: null,
      },
      select: { id: true },
    });
    expect(args("compCard.updateMany")).toEqual({
      where: { userId: "u1", projectId: "seq-elevate" },
      data: { privacy: "SELF", sharedAt: null, sharedWithOrganisationId: null },
    });
    expect(args("membership.updateMany")).toEqual({
      where: {
        userId: "u1",
        projectId: "seq-elevate",
        cohortId: { not: null },
        cohort: { is: { organisationId: { not: "org-b" } } },
      },
      data: { cohortId: null },
    });
    expect(args("auditLog.create")).toEqual({
      data: {
        projectId: "seq-elevate",
        actorId: "admin-1",
        action: "person.organisation_changed",
        entity: "ProjectProfile",
        entityId: "pp-1",
        metadata: { scope: "project" },
      },
    });
  });

  it("locks the profile row before reading it", async () => {
    const { tx, ops, calls } = fakeTx({ id: "pp-1", organisationId: "org-a" });
    await setPersonOrganisation(tx, "u1", "org-b", { actorId: "a", source: "admin" });
    expect(ops().indexOf("$queryRaw")).toBeLessThan(ops().indexOf("projectProfile.findUnique"));
    expect(JSON.stringify(calls.find((c) => c.op === "$queryRaw")!.args)).toMatch(/FOR UPDATE/);
  });

  it("writes nothing when the organisation doesn't change", async () => {
    for (const [current, next] of [
      [{ id: "pp-1", organisationId: "org-a" }, "org-a"],
      [{ id: "pp-1", organisationId: null }, null],
      [null, null],
    ] as const) {
      const { tx, ops } = fakeTx(current);
      expect(await setPersonOrganisation(tx, "u1", next, { actorId: "a", source: "admin" })).toEqual({ changed: false });
      expect(writes(ops()), JSON.stringify([current, next])).toEqual([]);
    }
  });

  it("creates the profile for a person who has none", async () => {
    const { tx, calls } = fakeTx(null);
    expect(await setPersonOrganisation(tx, "u1", "org-a", { actorId: "pa-1", source: "partner-admin", scope: "org-a" })).toEqual({
      changed: true,
    });
    expect(calls.find((c) => c.op === "auditLog.create")!.args).toMatchObject({ data: { entityId: "pp-new", metadata: { scope: "org-a" } } });
  });

  it("releases to none, clearing every cohort", async () => {
    const { tx, calls } = fakeTx({ id: "pp-1", organisationId: "org-a" });
    await setPersonOrganisation(tx, "u1", null, { actorId: null, source: "released" });
    expect(calls.find((c) => c.op === "membership.updateMany")!.args).toEqual({
      where: { userId: "u1", projectId: "seq-elevate", cohortId: { not: null } },
      data: { cohortId: null },
    });
    const audit = calls.find((c) => c.op === "auditLog.create")!.args as { data: Record<string, unknown> };
    expect(audit.data.actorId).toBeNull();
    expect("metadata" in audit.data).toBe(false);
    expect((calls.find((c) => c.op === "projectProfile.upsert")!.args as { update: unknown }).update).toEqual({
      organisationId: null,
      organisationSource: "released",
      guardianConsentRecordedAt: null,
      guardianSharingConsentAt: null,
    });
  });

  it("refuses an admin setting their own organisation, before any write", async () => {
    const { tx, ops } = fakeTx({ id: "pp-1", organisationId: null });
    await expect(setPersonOrganisation(tx, "admin-1", "org-a", { actorId: "admin-1", source: "admin" })).rejects.toThrow(
      /own organisation/
    );
    expect(ops()).toEqual([]);
  });

  it("refuses an organisation the project doesn't have, before any write", async () => {
    const { tx, ops } = fakeTx({ id: "pp-1", organisationId: "org-a" });
    await expect(setPersonOrganisation(tx, "u1", "org-zzz", { actorId: "a", source: "admin" })).rejects.toThrow(
      /not an organisation/
    );
    expect(writes(ops())).toEqual([]);
  });

  it("a guardian's permission goes with the organisation that recorded it: a move clears it and what it covered", async () => {
    const { tx, calls } = fakeTx({ id: "pp-1", organisationId: "org-a" });
    await setPersonOrganisation(tx, "u1", "org-b", { actorId: "admin-1", source: "admin", scope: "project" });
    expect((argsOf(calls, "projectProfile.upsert") as { update: Record<string, unknown> }).update).toMatchObject({
      guardianConsentRecordedAt: null,
      guardianSharingConsentAt: null,
    });
  });

  it("a first organisation (from none) keeps a guardian's permission an ADMIN recorded while they had none", async () => {
    const { tx, calls } = fakeTx({ id: "pp-1", organisationId: null });
    await setPersonOrganisation(tx, "u1", "org-a", { actorId: null, source: "country" });
    expect((argsOf(calls, "projectProfile.upsert") as { update: unknown }).update).toEqual({
      organisationId: "org-a",
      organisationSource: "country",
    });
  });
});

/*
 * Spec 5.4 (c), D101, risk 26, for someone who becomes a learner after the
 * profile step (their staff roles changed to LEARNER, or LEARNER given back
 * after "Remove"): a partner admin's organisation is released when the
 * country they gave maps elsewhere.
 */
describe("releaseIfCountryElsewhere", () => {
  const completed = { id: "pp-1", profileCompletedAt: new Date(), organisationSource: "partner-admin" };

  it("releases a partner admin's organisation when the country is another organisation's, and audits it", async () => {
    const profile = { ...completed, organisationId: "org-a", country: "CY" };
    let stored: Record<string, unknown> = profile;
    const { tx, calls, ops } = fakeTx(null);
    // The helper reads the full profile; setPersonOrganisation then reads id and organisation.
    (tx.projectProfile.findUnique as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (a: unknown) => {
      calls.push({ op: "projectProfile.findUnique", args: a });
      return stored;
    });
    (tx.projectProfile.upsert as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (a: unknown) => {
      calls.push({ op: "projectProfile.upsert", args: a });
      stored = { ...stored, organisationId: null, organisationSource: "released" };
      return { id: "pp-1" };
    });
    expect(await releaseIfCountryElsewhere(tx, "u1", { actorId: "paa-1", scope: "org-a" })).toEqual({ released: true });
    expect(ops().indexOf("$queryRaw")).toBe(0);
    expect((argsOf(calls, "projectProfile.upsert") as { update: Record<string, unknown> }).update).toMatchObject({
      organisationId: null,
      organisationSource: "released",
    });
    const audits = calls.filter((c) => c.op === "auditLog.create").map((c) => (c.args as { data: Record<string, unknown> }).data);
    expect(audits.map((a) => a.action)).toEqual(["person.organisation_changed", "profile.organisation_released"]);
    expect(audits[1]).toEqual({
      projectId: "seq-elevate",
      actorId: "paa-1",
      action: "profile.organisation_released",
      entity: "ProjectProfile",
      entityId: "pp-1",
      metadata: { scope: "org-a" },
    });
  });

  it("releases when the country is mapped to no organisation", async () => {
    const { tx } = fakeTx({ ...completed, organisationId: "org-a", country: "GR" });
    expect(await releaseIfCountryElsewhere(tx, "u1", { actorId: "u1" })).toEqual({ released: true });
  });

  it("keeps an organisation the country maps to, one set by an ADMIN, the country or the backfill, and an unfinished profile's", async () => {
    for (const profile of [
      { ...completed, organisationId: "org-a", country: "DE" },
      { ...completed, organisationSource: "admin", organisationId: "org-a", country: "CY" },
      { ...completed, organisationSource: "country", organisationId: "org-a", country: "CY" },
      { ...completed, organisationSource: "backfill", organisationId: "org-a", country: "CY" },
      { ...completed, profileCompletedAt: null, organisationId: "org-a", country: "CY" },
      { ...completed, organisationId: null, country: "CY" },
      { ...completed, organisationId: "org-a", country: null },
    ]) {
      const { tx, ops } = fakeTx(profile);
      expect(await releaseIfCountryElsewhere(tx, "u1", { actorId: "u1" }), JSON.stringify(profile)).toEqual({ released: false });
      expect(writes(ops()), JSON.stringify(profile)).toEqual([]);
    }
    const { tx, ops } = fakeTx(null);
    expect(await releaseIfCountryElsewhere(tx, "u1", { actorId: "u1" })).toEqual({ released: false });
    expect(writes(ops())).toEqual([]);
  });
});
