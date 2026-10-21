import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * Release 3 (D93, spec 11.2; SP36): saving the safeguarding contacts is an
 * ADMIN's with project scope only. A refused or invalid save writes
 * nothing; a save writes the setting and one audit row that names the
 * countries it changed, never the contacts; a save that changes nothing
 * writes nothing.
 */

const ADMIN = { id: "admin-1", email: "admin@example.org" };
const requireAdminProject = vi.fn();
const tx = {
  project: {
    findUnique: vi.fn<(args: unknown) => Promise<{ safeguarding: unknown } | null>>(),
    update: vi.fn<(args: unknown) => Promise<unknown>>(async () => ({})),
  },
  auditLog: { create: vi.fn<(args: unknown) => Promise<unknown>>(async () => ({})) },
};
const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };

vi.mock("@/lib/scope", () => ({ requireAdminProject }));
vi.mock("@/lib/prisma", () => ({ prisma }));

const { saveSafeguardingContacts } = await import("./safeguarding");

const ORG = { kind: "organisation", organisation: "Pro Arbeit", role: "Safeguarding lead", email: "schutz@example.org" };
const LINE = { kind: "helpline", organisation: "Nummer gegen Kummer", phone: "116 111" };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminProject.mockResolvedValue({ user: ADMIN, roles: ["ADMIN"], profile: null, scope: { kind: "project" } });
  tx.project.findUnique.mockResolvedValue({ safeguarding: null });
});

const wrote = () => tx.project.update.mock.calls.length + tx.auditLog.create.mock.calls.length + prisma.$transaction.mock.calls.length;

describe("saveSafeguardingContacts", () => {
  it("refuses anyone but an ADMIN with project scope, and writes nothing", async () => {
    requireAdminProject.mockResolvedValue(null);
    expect(await saveSafeguardingContacts({ DE: [ORG] })).toEqual({ ok: false, error: "forbidden" });
    expect(wrote()).toBe(0);
  });

  it("refuses contacts that aren't valid, with every reason, and writes nothing", async () => {
    expect(await saveSafeguardingContacts({ DE: [ORG, LINE, LINE, ORG] })).toEqual({
      ok: false,
      error: "invalid",
      errors: [{ country: "DE", index: null, field: null, problem: "too-many" }],
    });
    expect(await saveSafeguardingContacts({ CY: [{ kind: "helpline", organisation: "x", phone: "call" }] })).toMatchObject({
      ok: false,
      error: "invalid",
      errors: [{ country: "CY", index: 0, field: "phone", problem: "invalid" }],
    });
    expect(await saveSafeguardingContacts("everything")).toEqual({ ok: false, error: "bad-input" });
    expect(wrote()).toBe(0);
  });

  it("saves the contacts and logs the countries it changed, without the contacts", async () => {
    tx.project.findUnique.mockResolvedValue({ safeguarding: { v: 1, contacts: { CY: [LINE] }, updatedAt: null } });
    const result = await saveSafeguardingContacts({ DE: [LINE, ORG], CY: [LINE] });
    expect(result).toMatchObject({ ok: true, changed: ["DE"], setting: { v: 1, contacts: { DE: [LINE, ORG], CY: [LINE] } } });
    const saved = (tx.project.update.mock.calls[0][0] as { data: { safeguarding: { updatedAt: string } } }).data.safeguarding;
    expect(saved).toMatchObject({ v: 1, contacts: { DE: [LINE, ORG], CY: [LINE] } });
    expect(Date.parse(saved.updatedAt)).not.toBeNaN();
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    const row = (tx.auditLog.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(row).toEqual({
      projectId: "seq-elevate",
      actorId: "admin-1",
      action: "safeguarding.saved",
      entity: "Project",
      entityId: "seq-elevate",
      metadata: { countries: ["DE"] },
    });
    expect(JSON.stringify(row)).not.toMatch(/Pro Arbeit|schutz@|116/);
  });

  it("removes a country's contacts when the save leaves it out, and logs that country", async () => {
    tx.project.findUnique.mockResolvedValue({ safeguarding: { v: 1, contacts: { GR: [ORG] }, updatedAt: null } });
    expect(await saveSafeguardingContacts({})).toMatchObject({ ok: true, changed: ["GR"], setting: { contacts: {} } });
    expect((tx.auditLog.create.mock.calls[0][0] as { data: { metadata: unknown } }).data.metadata).toEqual({ countries: ["GR"] });
  });

  it("writes nothing when the save changes nothing", async () => {
    tx.project.findUnique.mockResolvedValue({ safeguarding: { v: 1, contacts: { DE: [ORG] }, updatedAt: "2026-11-20T09:00:00.000Z" } });
    expect(await saveSafeguardingContacts({ DE: [ORG] })).toEqual({
      ok: true,
      changed: [],
      setting: { v: 1, contacts: { DE: [ORG] }, updatedAt: "2026-11-20T09:00:00.000Z" },
    });
    expect(tx.project.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
