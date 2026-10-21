import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * Release 3 (D93, spec 11.2; UF2): the contacts as saved, read leniently;
 * a failed read gives none (the box then shows 112 and the fallback line),
 * and the log says so without the contacts.
 */

const findUnique = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findUnique } } }));

const { loadSafeguarding, readSafeguarding } = await import("./safeguarding.server");
const { EMPTY_SAFEGUARDING } = await import("./safeguarding");

const ORG = { kind: "organisation", organisation: "Pro Arbeit", email: "schutz@example.org" };

beforeEach(() => {
  findUnique.mockReset();
});

describe("loadSafeguarding", () => {
  it("reads the project's setting", async () => {
    findUnique.mockResolvedValue({ safeguarding: { v: 1, contacts: { DE: [ORG] }, updatedAt: null } });
    expect(await loadSafeguarding()).toEqual({ v: 1, contacts: { DE: [ORG] }, updatedAt: null });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "seq-elevate" }, select: { safeguarding: true } });
  });

  it("gives no contacts when nothing is saved, or the project is missing", async () => {
    findUnique.mockResolvedValue({ safeguarding: null });
    expect(await loadSafeguarding()).toEqual(EMPTY_SAFEGUARDING);
    findUnique.mockResolvedValue(null);
    expect(await loadSafeguarding()).toEqual(EMPTY_SAFEGUARDING);
  });

  it("gives no contacts when the database can't be read, and logs it without the contacts", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    findUnique.mockImplementation(async () => {
      throw new TypeError("connection refused to schutz@example.org");
    });
    expect(await loadSafeguarding()).toEqual(EMPTY_SAFEGUARDING);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("TypeError");
    expect(String(error.mock.calls[0][0])).not.toContain("schutz@");
    error.mockRestore();
  });

  it("tells the admin screen a failed read apart from no contacts", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    findUnique.mockImplementation(async () => {
      throw new Error("down");
    });
    expect(await readSafeguarding()).toBeNull();
    findUnique.mockResolvedValue({ safeguarding: null });
    expect(await readSafeguarding()).toEqual(EMPTY_SAFEGUARDING);
    error.mockRestore();
  });
});
