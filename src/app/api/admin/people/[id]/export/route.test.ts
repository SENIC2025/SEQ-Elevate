import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
 * SP30 (spec 13.4, D88): the admin export. Only an ADMIN with project
 * scope, only from the app's own pages (Origin), only with a request
 * reference in the register's format; never cached; logged with the admin,
 * the person and the reference. Nothing is read or logged when refused.
 */

const ADMIN = { id: "admin-1", email: "admin@example.org" };
const requireAdminProject = vi.fn();
const getCurrentUser = vi.fn();
const collectUserData = vi.fn();
const recordDataExport = vi.fn(async () => {});
vi.mock("@/lib/scope", () => ({ requireAdminProject }));
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser }));
vi.mock("@/lib/gdpr-export", () => ({ collectUserData }));
vi.mock("@/lib/account-data", async () => {
  const actual = await vi.importActual<typeof import("@/lib/account-data")>("@/lib/account-data");
  return { isRequestRef: actual.isRequestRef, recordDataExport };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));

const route = await import("./route");

const URL_ = "http://localhost:3304/api/admin/people/user-2/export";
const params = Promise.resolve({ id: "user-2" });
const post = (opts: { origin?: string | null; body?: string; type?: string } = {}) =>
  route.POST(
    new Request(URL_, {
      method: "POST",
      headers: {
        ...(opts.origin === null ? {} : { origin: opts.origin ?? "http://localhost:3304" }),
        "content-type": opts.type ?? "application/x-www-form-urlencoded",
      },
      body: opts.body ?? "requestRef=REQ-2026-004",
    }),
    { params }
  );

beforeEach(() => {
  vi.stubEnv("AUTH_URL", "");
  requireAdminProject.mockResolvedValue({ user: ADMIN, roles: ["ADMIN"], profile: null, scope: { kind: "project" } });
  getCurrentUser.mockResolvedValue(ADMIN);
  collectUserData.mockResolvedValue({ account: { id: "user-2" }, compCards: [{ wentWell: "private words" }] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/admin/people/[id]/export", () => {
  it("answers an ADMIN the person's whole file as a download, never cached, and logs it with the reference", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="seq-elevate-data-REQ-2026-004.json"');
    expect(await res.json()).toEqual({ account: { id: "user-2" }, compCards: [{ wentWell: "private words" }] });
    expect(collectUserData).toHaveBeenCalledWith("user-2");
    expect(recordDataExport).toHaveBeenCalledWith({ actorId: ADMIN.id, userId: "user-2", requestRef: "REQ-2026-004" });
  });

  it("takes the reference from a JSON body too", async () => {
    const res = await post({ type: "application/json", body: JSON.stringify({ requestRef: "REQ-2026-005" }) });
    expect(res.status).toBe(200);
  });

  it("accepts AUTH_URL's origin", async () => {
    vi.stubEnv("AUTH_URL", "https://seq-elevate.eu");
    expect((await post({ origin: "https://seq-elevate.eu" })).status).toBe(200);
  });

  it.each([
    ["no Origin", null],
    ["another site's Origin", "https://evil.example"],
    ["a look-alike Origin", "http://localhost:3304.evil.example"],
  ])("refuses %s (403)", async (_, origin) => {
    expect((await post({ origin })).status).toBe(403);
    expect(collectUserData).not.toHaveBeenCalled();
    expect(recordDataExport).not.toHaveBeenCalled();
  });

  it("refuses anyone but an ADMIN with project scope: 403, or 401 with no session", async () => {
    requireAdminProject.mockResolvedValue(null);
    expect((await post()).status).toBe(403);
    getCurrentUser.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    expect(collectUserData).not.toHaveBeenCalled();
    expect(recordDataExport).not.toHaveBeenCalled();
  });

  it.each([
    ["no reference", ""],
    ["free text", "requestRef=Ana%27s+request"],
    ["a near miss", "requestRef=REQ-2026-4"],
    ["the clean-up's reference", "requestRef=CLEANUP-abcdef12"],
  ])("refuses %s (400)", async (_, body) => {
    expect((await post({ body })).status).toBe(400);
    expect(collectUserData).not.toHaveBeenCalled();
    expect(recordDataExport).not.toHaveBeenCalled();
  });

  it("answers 404 for no such person, logging nothing", async () => {
    collectUserData.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect(recordDataExport).not.toHaveBeenCalled();
  });

  it("serves POST only", () => {
    expect(Object.keys(route).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["POST"]);
  });
});
