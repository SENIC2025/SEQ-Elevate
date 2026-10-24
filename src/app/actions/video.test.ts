import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * U12 (spec 4.6): an in-video answer is kept under its cue's id, as before,
 * with the lesson it was given in when the player says so — for lessons of
 * the course's own too. A cue id longer than any cue has, a lesson id that
 * is no lesson's, a slug the platform wouldn't make or a "correct" that
 * isn't true or false isn't stored.
 */

const getCurrentUser = vi.fn();
const auditLog = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
/** The signed-in person's profile, as the profile step reads it (complete by default). */
const projectProfile = { findUnique: vi.fn() };
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog, projectProfile } }));

const { recordVideoCueAnswer } = await import("./video");
const { currentTermsVersion } = await import("@/lib/profile");

const USER = { id: "u1", name: "Ana", lastProjectId: null };
/** A profile the profile step left complete. */
const completeProfile = (over: Record<string, unknown> = {}) => ({
  country: "DE",
  termsVersion: currentTermsVersion(),
  ageConfirmedAt: new Date("2026-11-20T10:00:00Z"),
  consentAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue(USER);
  auditLog.findFirst.mockResolvedValue(null);
  projectProfile.findUnique.mockResolvedValue(completeProfile());
});

describe("recordVideoCueAnswer", () => {
  it("keeps the lesson the answer was given in", async () => {
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true, lessonId: "s-abcdefgh" });
    expect(auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "video.cue_answered",
        entityId: "cue-1",
        metadata: { courseSlug: "speaking-up", correct: true, lessonId: "s-abcdefgh" },
      }),
    });
  });

  it("records an answer from a page that doesn't say the lesson, as before", async () => {
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: false });
    expect(auditLog.create.mock.calls[0][0].data.metadata).toEqual({ courseSlug: "speaking-up", correct: false });
  });

  it("leaves out a lesson id that is no lesson's", async () => {
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true, lessonId: "intro" });
    expect(auditLog.create.mock.calls[0][0].data.metadata).toEqual({ courseSlug: "speaking-up", correct: true });
  });

  it("updates the answer already kept for the cue", async () => {
    auditLog.findFirst.mockResolvedValue({ id: "a1" });
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true, lessonId: "context" });
    expect(auditLog.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { metadata: { courseSlug: "speaking-up", correct: true, lessonId: "context" } },
    });
  });

  it.each([
    ["an empty cue id", ""],
    ["a cue id over 100 characters", "c".repeat(101)],
    ["a cue id that isn't text", 7],
  ])("ignores %s", async (_name, cueId) => {
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: cueId as string, correct: true });
    expect(auditLog.findFirst).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it("ignores a courseSlug that isn't a slug and a correct that isn't a boolean (no auditLog write)", async () => {
    // AuditLog rows outlive account erasure (D62.g): nothing the browser
    // makes up is kept in one.
    for (const input of [
      { courseSlug: "Free text, as long as the request allows", cueId: "cue-1", correct: true },
      { courseSlug: { nested: "object" }, cueId: "cue-1", correct: true },
      { courseSlug: "speaking-up", cueId: "cue-1", correct: "a note" },
      { courseSlug: "speaking-up", cueId: "cue-1", correct: { nested: true } },
    ]) {
      await recordVideoCueAnswer(input as unknown as Parameters<typeof recordVideoCueAnswer>[0]);
    }
    expect(auditLog.findFirst).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
    expect(auditLog.update).not.toHaveBeenCalled();
  });

  it("does nothing for a guest", async () => {
    getCurrentUser.mockResolvedValue(null);
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true });
    expect(auditLog.create).not.toHaveBeenCalled();
  });
});

/*
 * D79 (the integrator's decision (c), 24 October): before the profile step is
 * done nothing of the person's learning is saved, an in-video answer
 * (shown to facilitators) included, whatever R3_PROFILE_GATE says: answered
 * "profile-incomplete", never thrown, and nothing written.
 */
describe("recordVideoCueAnswer before the profile step is done (D79)", () => {
  it.each([
    ["no profile at all", null, USER],
    ["no country", completeProfile({ country: null }), USER],
    ["Terms of an older version", completeProfile({ termsVersion: "1999-01-01" }), USER],
    ["no age rule confirmed", completeProfile({ ageConfirmedAt: null }), USER],
    ["a blank name", completeProfile(), { ...USER, name: "  " }],
  ])("keeps no answer for %s, and answers profile-incomplete", async (_, profile, user) => {
    getCurrentUser.mockResolvedValue(user);
    projectProfile.findUnique.mockResolvedValue(profile);
    await expect(
      recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true, lessonId: "context" })
    ).resolves.toBe("profile-incomplete");
    expect(auditLog.findFirst).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
    expect(auditLog.update).not.toHaveBeenCalled();
  });

  it("reads the signed-in person's own profile, nobody else's", async () => {
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true });
    expect(projectProfile.findUnique.mock.calls.map((c) => c[0].where)).toEqual([
      { userId_projectId: { userId: "u1", projectId: "seq-elevate" } },
    ]);
    expect(auditLog.create).toHaveBeenCalledTimes(1);
  });
});
