import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { currentTermsVersion } from "@/lib/profile";

/*
 * POST /api/progress/beacon (D37 as built, 24 October): a learner's course
 * or Comp Card save the page sends with fetch(keepalive) as it goes. It
 * saves through the save action's own code (saveCourseProgressPatch,
 * saveCompCard), and before that it takes only a POST from this site's own
 * pages (Sec-Fetch-Site, Origin), a JSON body of at most 64 KiB, a
 * signed-in person, and (D79) one whose profile step is done. Nothing is
 * read, saved or logged with personal data when it refuses.
 */

const LEARNER = { id: "user-ana", email: "ana@example.org", name: "Ana" };
const getCurrentUser = vi.fn();
const findProfile = vi.fn();
const saveCourseProgressPatch = vi.fn();
const saveCompCard = vi.fn();
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { projectProfile: { findUnique: findProfile } } }));
vi.mock("@/app/actions/learner", () => ({ saveCourseProgressPatch, saveCompCard }));
vi.mock("server-only", () => ({}));

const route = await import("./route");

const URL_ = "http://localhost:3304/api/progress/beacon";
const PATCH = { v: 2, answers: { "reflection/main": { type: "reflection", text: { p1: "X" } } } };
const BODY = JSON.stringify({ v: 1, slug: "workplace-conflict", forUser: LEARNER.id, patch: PATCH });
const complete = () => ({
  country: "DE",
  termsVersion: currentTermsVersion(),
  ageConfirmedAt: new Date("2026-11-01T00:00:00Z"),
  consentAt: null,
});

function post(
  opts: {
    origin?: string | null;
    site?: string | null;
    type?: string;
    body?: BodyInit;
    length?: string;
    method?: string;
  } = {}
) {
  const headers: Record<string, string> = { "content-type": opts.type ?? "application/json" };
  if (opts.origin !== null) headers.origin = opts.origin ?? "http://localhost:3304";
  if (opts.site !== null) headers["sec-fetch-site"] = opts.site ?? "same-origin";
  if (opts.length) headers["content-length"] = opts.length;
  return route.POST(
    new Request(URL_, {
      method: opts.method ?? "POST",
      headers,
      body: opts.body ?? BODY,
      ...(opts.body instanceof ReadableStream ? { duplex: "half" } : {}),
    } as RequestInit)
  );
}

beforeEach(() => {
  vi.stubEnv("AUTH_URL", "");
  getCurrentUser.mockResolvedValue(LEARNER);
  findProfile.mockResolvedValue(complete());
  saveCourseProgressPatch.mockResolvedValue({ ok: true, refused: [] });
  saveCompCard.mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("POST /api/progress/beacon", () => {
  it("saves through the save action's own code, with what the page sent, and answers what it answered; never cached", async () => {
    saveCourseProgressPatch.mockResolvedValue({ ok: true, refused: [{ key: "simulation/main", reason: "invalid" }] });
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, refused: [{ key: "simulation/main", reason: "invalid" }] });
    expect(saveCourseProgressPatch).toHaveBeenCalledTimes(1);
    expect(saveCourseProgressPatch).toHaveBeenCalledWith("workplace-conflict", PATCH, LEARNER.id);
  });

  it("reads the signed-in person's own profile, nobody else's", async () => {
    await post();
    expect(findProfile).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_projectId: { userId: LEARNER.id, projectId: "seq-elevate" } } })
    );
  });

  it.each([
    ["Sec-Fetch-Site same-origin, no Origin", { origin: null }],
    ["this site's Origin, no Sec-Fetch-Site", { site: null }],
  ])("takes a request from this site's own pages: %s", async (_, opts) => {
    expect((await post(opts)).status).toBe(200);
  });

  it("takes AUTH_URL's origin", async () => {
    vi.stubEnv("AUTH_URL", "https://seq-elevate.eu");
    expect((await post({ origin: "https://seq-elevate.eu", site: null })).status).toBe(200);
  });

  it.each([
    ["another site's Origin", { origin: "https://evil.example", site: null }],
    ["a look-alike Origin", { origin: "http://localhost:3304.evil.example", site: null }],
    ["Origin null", { origin: "null", site: null }],
    ["Sec-Fetch-Site cross-site, with this site's Origin", { site: "cross-site" }],
    ["Sec-Fetch-Site same-site", { site: "same-site" }],
    ["Sec-Fetch-Site none (typed or bookmarked)", { site: "none" }],
    ["neither Origin nor Sec-Fetch-Site", { origin: null, site: null }],
  ])("refuses %s (403), reading nothing", async (_, opts) => {
    expect((await post(opts)).status).toBe(403);
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(saveCourseProgressPatch).not.toHaveBeenCalled();
  });

  it.each([
    ["text/plain (a form)", "text/plain"],
    ["a form's encoding", "application/x-www-form-urlencoded"],
    ["none", ""],
  ])("refuses a body that isn't JSON by its type: %s (415)", async (_, type) => {
    expect((await post({ type })).status).toBe(415);
    expect(saveCourseProgressPatch).not.toHaveBeenCalled();
  });

  it("refuses a body over 64 KiB by its stated length (413), reading nothing", async () => {
    expect((await post({ length: String(64 * 1024 + 1) })).status).toBe(413);
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("refuses a body over 64 KiB as it is read, whatever its stated length (413)", async () => {
    const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 8) controller.enqueue(chunk);
        else controller.close();
      },
    });
    expect((await post({ body })).status).toBe(413);
    expect(sent, "read no further than the limit").toBeLessThanOrEqual(6);
    expect(saveCourseProgressPatch).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "{not json"],
    ["not a save", JSON.stringify({ v: 1, slug: "workplace-conflict" })],
    ["a list", JSON.stringify(["workplace-conflict", PATCH, LEARNER.id])],
  ])("refuses a body that is %s (400)", async (_, body) => {
    expect((await post({ body })).status).toBe(400);
    expect(saveCourseProgressPatch).not.toHaveBeenCalled();
  });

  it("refuses with no session (401)", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    expect(findProfile).not.toHaveBeenCalled();
    expect(saveCourseProgressPatch).not.toHaveBeenCalled();
  });

  it.each([
    ["no profile", null],
    ["no country", { ...complete(), country: null }],
    ["an older Terms version", { ...complete(), termsVersion: "1999-01-01" }],
    ["the age rule not confirmed", { ...complete(), ageConfirmedAt: null }],
  ])("refuses before the profile step is done (D79): %s (403), saving nothing", async (_, profile) => {
    findProfile.mockResolvedValue(profile);
    expect((await post()).status).toBe(403);
    expect(saveCourseProgressPatch).not.toHaveBeenCalled();
  });

  it("refuses a person without a name before the profile step is done (D79)", async () => {
    getCurrentUser.mockResolvedValue({ ...LEARNER, name: " " });
    expect((await post()).status).toBe(403);
    expect(saveCourseProgressPatch).not.toHaveBeenCalled();
  });

  it.each([
    ["other-account", 403],
    ["profile-incomplete", 403],
    ["unknown-course", 404],
    ["bad-input", 400],
    ["too-large", 413],
  ] as const)("answers the save action's refusal %s as %i", async (error, status) => {
    saveCourseProgressPatch.mockResolvedValue({ ok: false, error });
    const res = await post();
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, error });
  });

  it("answers 503 when the save fails (a session lookup or the database), logging no personal data", async () => {
    saveCourseProgressPatch.mockRejectedValue(new Error(`No signed-in learner for ${LEARNER.email}`));
    expect((await post()).status).toBe(503);
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toContain(LEARNER.email);
    expect(logged).not.toContain(LEARNER.id);
  });

  it("serves POST only (Next answers anything else 405)", () => {
    expect(Object.keys(route).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["POST"]);
  });
});

describe("POST /api/progress/beacon: the Comp Card's save", () => {
  const CARD = { wentWell: "W", confidence: 4 };
  const CARD_BODY = JSON.stringify({ v: 1, forUser: LEARNER.id, card: CARD });

  it("saves through the card's save action, with the fields the page sent, and answers what it answered; never a course save", async () => {
    const res = await post({ body: CARD_BODY });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
    expect(saveCompCard).toHaveBeenCalledTimes(1);
    expect(saveCompCard).toHaveBeenCalledWith(CARD, LEARNER.id);
    expect(saveCourseProgressPatch).not.toHaveBeenCalled();
    expect(findProfile).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_projectId: { userId: LEARNER.id, projectId: "seq-elevate" } } })
    );
  });

  it("hands the card's save action what was sent: it reads only the card's fields, and never shares (D80)", async () => {
    const card = { ...CARD, privacy: "facilitator", sharedAt: "2026-11-21T00:00:00Z" };
    await post({ body: JSON.stringify({ v: 1, forUser: LEARNER.id, card }) });
    expect(saveCompCard).toHaveBeenCalledWith(card, LEARNER.id);
  });

  it.each([
    ["a course and a card", JSON.stringify({ v: 1, slug: "workplace-conflict", forUser: LEARNER.id, patch: PATCH, card: CARD })],
    ["a card and a patch", JSON.stringify({ v: 1, forUser: LEARNER.id, patch: PATCH, card: CARD })],
    ["a card for no one", JSON.stringify({ v: 1, card: CARD })],
    ["a card in another version", JSON.stringify({ v: 2, forUser: LEARNER.id, card: CARD })],
  ])("refuses a body with %s (400), saving nothing", async (_, body) => {
    expect((await post({ body })).status).toBe(400);
    expect(saveCompCard).not.toHaveBeenCalled();
    expect(saveCourseProgressPatch).not.toHaveBeenCalled();
  });

  it("takes only this site's own pages, as for a course (403)", async () => {
    expect((await post({ body: CARD_BODY, origin: "https://evil.example", site: "cross-site" })).status).toBe(403);
    expect((await post({ body: CARD_BODY, origin: null, site: null })).status).toBe(403);
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(saveCompCard).not.toHaveBeenCalled();
  });

  it("refuses with no session (401), and before the profile step is done (D79, 403), saving nothing", async () => {
    getCurrentUser.mockResolvedValueOnce(null);
    expect((await post({ body: CARD_BODY })).status).toBe(401);
    findProfile.mockResolvedValueOnce({ ...complete(), termsVersion: "1999-01-01" });
    const res = await post({ body: CARD_BODY });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "profile-incomplete" });
    expect(saveCompCard).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: false, error: "other-account" }, 403],
    [{ ok: false, error: "profile-incomplete" }, 403],
    [{ ok: false, error: "too-long", field: "wentWell" }, 413],
    [{ ok: false, error: "bad-input", field: "difficult" }, 400],
    [{ ok: false, error: "bad-input" }, 400],
  ] as const)("answers the card's save action's refusal %o as %i", async (refusal, status) => {
    saveCompCard.mockResolvedValue(refusal);
    const res = await post({ body: CARD_BODY });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(refusal);
  });

  it("answers 503 when the save fails, logging no personal data", async () => {
    saveCompCard.mockRejectedValue(new Error(`No signed-in learner for ${LEARNER.email}`));
    expect((await post({ body: CARD_BODY })).status).toBe(503);
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toContain(LEARNER.email);
  });
});
