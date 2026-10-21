import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * Invitations (UA2; D27, D76, spec 6.2, 6.3): the copy says the invitee's
 * role and what they will find, in their language. A partner admin is
 * named as one ("Partner admin", ranked after an ADMIN) and is told about
 * every workspace it opens: creating and managing courses, managing
 * people, supporting learners and statistics. The footer links the privacy
 * notice in the invitee's language.
 *
 * Auth.js's sign-in is stood in for: it hands the intent's copy back, as
 * the email provider in auth.ts receives it.
 */

const sent: { copy?: Record<string, unknown> } = {};
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "seq-elevate.eu" }) }));
vi.mock("@/auth", () => ({ signIn: vi.fn(async () => "http://localhost/api/auth/verify-request?provider=invite") }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true, count: 1, limit: 5 })),
  hashKey: (prefix: string, value: string) => `${prefix}:${value}`,
}));
vi.mock("@/lib/invite-context", () => ({
  INVITE_PROVIDER: "invite",
  INVITE_VALID_DAYS: 7,
  withInviteIntent: async (intent: { copy: Record<string, unknown> }, run: () => Promise<unknown>) => {
    sent.copy = intent.copy;
    return run();
  },
}));
vi.mock("@/lib/signin-result", () => ({ wasVerificationSent: () => true, signInErrorType: () => null }));

const { sendInvitation } = await import("./invitations");

const invite = async (roles: string[], locale: "en" | "de" | "el" = "en") => {
  sent.copy = undefined;
  const res = await sendInvitation({
    email: "new@example.org",
    name: "Noa",
    roles: roles as never,
    locale,
    inviter: { id: "admin-1", name: "Ada", email: "ada@example.org" },
  });
  expect(res).toEqual({ ok: true });
  return sent.copy as unknown as { role: string; capabilities: { title: string }[]; legalLinks: { label: string; path: string }[] };
};

beforeEach(() => vi.unstubAllEnvs());

describe("an invitation's copy", () => {
  it("names a partner admin's role, in the invitee's language", async () => {
    expect((await invite(["PARTNER_ADMIN"])).role).toBe("Your role: Partner admin");
    expect((await invite(["PARTNER_ADMIN"], "de")).role).toBe("Deine Rolle: Partner-Admin");
    expect((await invite(["PARTNER_ADMIN", "ADMIN"])).role).toBe("Your role: Admin");
  });

  it("lists every workspace a partner admin opens", async () => {
    expect((await invite(["PARTNER_ADMIN"])).capabilities.map((c) => c.title)).toEqual([
      "Create courses",
      "Manage courses",
      "Manage people",
      "Support learners",
      "Statistics",
    ]);
  });

  it("tells a partner admin what Manage people holds for it: no organisations, which only an ADMIN manages", async () => {
    for (const locale of ["en", "de", "el"] as const) {
      const copy = (await invite(["PARTNER_ADMIN"], locale)) as unknown as { capabilities: { desc: string }[] };
      const people = copy.capabilities[2].desc;
      expect(people, locale).not.toMatch(/Organisations|Organisationen|Οργανισμοί/);
    }
    const copy = (await invite(["PARTNER_ADMIN"])) as unknown as { capabilities: { desc: string }[] };
    expect(copy.capabilities[2].desc).toBe("People, their roles and cohorts.");
  });

  it("links the privacy notice in the invitee's language", async () => {
    expect((await invite(["LEARNER"], "el")).legalLinks).toEqual([
      { label: "Ενημέρωση για το απόρρητο", path: "/el/legal/privacy" },
    ]);
  });
});
