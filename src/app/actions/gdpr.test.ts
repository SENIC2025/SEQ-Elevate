import { describe, it, expect, vi, afterEach } from "vitest";

/*
 * Spec 13.2, SP28, SP29: "Delete my account" erases the signed-in person's
 * own account through eraseAccount, in one transaction, after they typed
 * their own address; and the file exports nothing but that action (the
 * export record is written by the export route on the server).
 */

const ME = { id: "user-1", email: "Ana@Example.org" };
const getCurrentUser = vi.fn();
const eraseAccount = vi.fn(async () => ({}));
const tx = { marker: "the transaction" };
const $transaction = vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
const jar = { delete: vi.fn() };
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser }));
vi.mock("@/lib/account-data", () => ({ eraseAccount }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction } }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));

const gdpr = await import("./gdpr");

afterEach(() => vi.clearAllMocks());

describe("deleteMyAccount", () => {
  it("erases the signed-in person's own account in one transaction, then signs them out", async () => {
    getCurrentUser.mockResolvedValue(ME);
    await expect(gdpr.deleteMyAccount(" ana@example.org ")).resolves.toEqual({ ok: true });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(eraseAccount).toHaveBeenCalledWith(tx, ME.id, { by: "self" });
    expect(jar.delete).toHaveBeenCalledWith("authjs.session-token");
    expect(jar.delete).toHaveBeenCalledWith("__Secure-authjs.session-token");
  });

  it("erases nothing without a session or with another address", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(gdpr.deleteMyAccount(ME.email)).resolves.toEqual({ ok: false, error: "not-authenticated" });
    getCurrentUser.mockResolvedValue(ME);
    await expect(gdpr.deleteMyAccount("someone@example.org")).resolves.toEqual({
      ok: false,
      error: "confirmation-mismatch",
    });
    await expect(gdpr.deleteMyAccount(undefined as unknown as string)).resolves.toEqual({
      ok: false,
      error: "confirmation-mismatch",
    });
    expect(eraseAccount).not.toHaveBeenCalled();
  });
});

describe("the file's actions", () => {
  it("are deleteMyAccount only: no one records an export through an action", () => {
    expect(Object.keys(gdpr)).toEqual(["deleteMyAccount"]);
  });
});
