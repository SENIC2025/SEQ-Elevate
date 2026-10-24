import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * U12 (spec 4.6): time on a lesson is recorded by lesson id — a standard
 * key or a lesson of the course's own — for a course slug as the platform
 * makes them. Anything else from the browser is ignored, never stored.
 */

const getCurrentUser = vi.fn();
const auditLog = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
/** The signed-in person's profile, as the profile step reads it (complete by default). */
const projectProfile = { findUnique: vi.fn() };
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog, projectProfile } }));

const { recordCourseOpened, recordStageTime } = await import("./telemetry");
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

describe("recordStageTime", () => {
  it.each([["context"], ["assessment"], ["s-abcdefgh"]])("records time on lesson %s", async (stage) => {
    await recordStageTime({ courseSlug: "speaking-up", stage, seconds: 12 });
    expect(auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "stage.time",
        entityId: `speaking-up:${stage}`,
        metadata: { courseSlug: "speaking-up", stage, seconds: 12 },
      }),
    });
  });

  it.each([
    ["a made-up lesson", "speaking-up", "intro"],
    ["a lesson in capitals", "speaking-up", "CONTEXT"],
    ["the completion screen", "speaking-up", "complete"],
    ["a slug that isn't one", "Speaking Up!", "context"],
    ["a slug with a colon", "speaking-up:x", "context"],
    ["a slug that isn't text", 42, "context"],
  ])("ignores %s", async (_name, courseSlug, stage) => {
    await recordStageTime({ courseSlug: courseSlug as string, stage, seconds: 12 });
    expect(auditLog.findFirst).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
    expect(auditLog.update).not.toHaveBeenCalled();
  });

  it("adds to the time already recorded", async () => {
    auditLog.findFirst.mockResolvedValue({ id: "a1", metadata: { seconds: 30 } });
    await recordStageTime({ courseSlug: "speaking-up", stage: "s-abcdefgh", seconds: 5 });
    expect(auditLog.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { metadata: { courseSlug: "speaking-up", stage: "s-abcdefgh", seconds: 35 } },
    });
  });
});

describe("recordCourseOpened", () => {
  it("records a course opened, by its slug", async () => {
    await recordCourseOpened("speaking-up");
    expect(auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "course.opened",
        entityId: "speaking-up",
        metadata: { courseSlug: "speaking-up" },
      }),
    });
  });

  // Found at integration review: its two siblings were hardened (spec 4.6),
  // this one stored whatever the browser sent, as the row's key and in its
  // metadata, at any length.
  it.each([
    ["a slug that isn't one", "Speaking Up!"],
    ["a slug with a colon", "speaking-up:x"],
    ["a slug of 5,000 characters", "x".repeat(5000)],
    ["a slug that isn't text", 42],
    ["an object", { courseSlug: "speaking-up" }],
  ])("ignores %s", async (_name, courseSlug) => {
    await recordCourseOpened(courseSlug as string);
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it("does nothing for a guest", async () => {
    getCurrentUser.mockResolvedValue(null);
    await recordCourseOpened("speaking-up");
    expect(auditLog.create).not.toHaveBeenCalled();
  });
});

/*
 * D79 (the integrator's decision (c), 24 October): before the profile step is
 * done nothing of the person's learning is saved, the activity records that
 * facilitators are shown included, whatever R3_PROFILE_GATE says. A page
 * loaded before the Terms changed or before Release 3, and a hand-made call,
 * write nothing and are answered "profile-incomplete", never thrown.
 */
describe("before the profile step is done (D79)", () => {
  it.each([
    ["no profile at all", null, USER],
    ["no country", completeProfile({ country: null }), USER],
    ["Terms of an older version", completeProfile({ termsVersion: "1999-01-01" }), USER],
    ["no age rule confirmed", completeProfile({ ageConfirmedAt: null }), USER],
    ["a blank name", completeProfile(), { ...USER, name: "  " }],
  ])("records neither time on a lesson nor a course opened for %s, and answers profile-incomplete", async (_, profile, user) => {
    getCurrentUser.mockResolvedValue(user);
    projectProfile.findUnique.mockResolvedValue(profile);
    await expect(recordStageTime({ courseSlug: "speaking-up", stage: "context", seconds: 12 })).resolves.toBe(
      "profile-incomplete"
    );
    await expect(recordCourseOpened("speaking-up")).resolves.toBe("profile-incomplete");
    expect(auditLog.findFirst).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
    expect(auditLog.update).not.toHaveBeenCalled();
  });

  it("reads the signed-in person's own profile, nobody else's", async () => {
    await recordStageTime({ courseSlug: "speaking-up", stage: "context", seconds: 12 });
    await recordCourseOpened("speaking-up");
    const own = { userId_projectId: { userId: "u1", projectId: "seq-elevate" } };
    expect(projectProfile.findUnique.mock.calls.map((c) => c[0].where)).toEqual([own, own]);
    expect(auditLog.create).toHaveBeenCalledTimes(2);
  });

  it("reads no profile for a guest, and records nothing", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(recordStageTime({ courseSlug: "speaking-up", stage: "context", seconds: 12 })).resolves.toBeUndefined();
    await expect(recordCourseOpened("speaking-up")).resolves.toBeUndefined();
    expect(projectProfile.findUnique).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });
});
