import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
 * U12 (spec 4.6): time on a lesson is recorded by lesson id — a standard
 * key or a lesson of the course's own — for a course slug as the platform
 * makes them. Anything else from the browser is ignored, never stored.
 *
 * D117: only for a course of the project learners get and one of its
 * lessons; a course opened at most once per learner, course and clock
 * hour; time added to a lesson never more than the time since it was last
 * added to (the first write at most an hour, as before); at most 120 calls
 * in 10 minutes per learner; one call at a time per record. What the rules
 * refuse writes nothing and is answered as before.
 */

const getCurrentUser = vi.fn();
const auditLog = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
/** The signed-in person's profile, as the profile step reads it (complete by default). */
const projectProfile = { findUnique: vi.fn() };
const course = { findUnique: vi.fn() };
const lesson = { findUnique: vi.fn(), findMany: vi.fn() };
/** The transaction client: the audit log, and the advisory lock (raw SQL). */
const $executeRaw = vi.fn();
const tx = { auditLog, $executeRaw };
const $transaction = vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
const checkRateLimit = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog, projectProfile, course, lesson, $transaction } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));

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
/** "speaking-up": a course created in the CMS, published, with a lesson of its own. */
const speakingUp = (over: Record<string, unknown> = {}) => ({
  slug: "speaking-up",
  meta: { en: { title: "Speaking up" } },
  outline: {
    v: 1,
    sections: ["context", "concept", "behaviour", "s-abcdefgh", "reflection", "assessment"].map((id) => ({
      id,
      ...(id.startsWith("s-") ? { template: "text" } : {}),
    })),
  },
  status: "published",
  publishedAt: new Date("2026-11-20T10:00:00Z"),
  ...over,
});
const NOW = new Date("2026-12-01T10:15:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
/** Nothing was read or written in the audit log. */
const nothingWritten = () => {
  expect(auditLog.findFirst).not.toHaveBeenCalled();
  expect(auditLog.create).not.toHaveBeenCalled();
  expect(auditLog.update).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  getCurrentUser.mockResolvedValue(USER);
  auditLog.findFirst.mockResolvedValue(null);
  projectProfile.findUnique.mockResolvedValue(completeProfile());
  course.findUnique.mockResolvedValue(speakingUp());
  lesson.findUnique.mockResolvedValue(null);
  lesson.findMany.mockResolvedValue([]);
  $executeRaw.mockResolvedValue(1);
  checkRateLimit.mockResolvedValue({ ok: true, count: 1, limit: 120 });
});
afterEach(() => vi.useRealTimers());

describe("recordStageTime", () => {
  it.each([["context"], ["assessment"], ["s-abcdefgh"]])("records time on lesson %s", async (stage) => {
    await recordStageTime({ courseSlug: "speaking-up", stage, seconds: 12 });
    expect(auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "stage.time",
        entityId: `speaking-up:${stage}`,
        metadata: { courseSlug: "speaking-up", stage, seconds: 12, lastAddedAt: NOW.toISOString() },
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
    nothingWritten();
  });

  it("adds to the time already recorded (a row from before D117 kept no time: up to an hour, as a first write)", async () => {
    auditLog.findFirst.mockResolvedValue({ id: "a1", metadata: { seconds: 30 } });
    await recordStageTime({ courseSlug: "speaking-up", stage: "s-abcdefgh", seconds: 5 });
    expect(auditLog.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { metadata: { courseSlug: "speaking-up", stage: "s-abcdefgh", seconds: 35, lastAddedAt: NOW.toISOString() } },
    });
  });

  it("adds at most an hour in a first write, as before", async () => {
    await recordStageTime({ courseSlug: "speaking-up", stage: "context", seconds: 99_999 });
    expect(auditLog.create.mock.calls[0][0].data.metadata.seconds).toBe(3600);
  });

  it("adds no more than the time since the row was last added to", async () => {
    auditLog.findFirst.mockResolvedValue({
      id: "a1",
      metadata: { courseSlug: "speaking-up", stage: "context", seconds: 30, lastAddedAt: ago(20_000) },
    });
    await recordStageTime({ courseSlug: "speaking-up", stage: "context", seconds: 600 });
    expect(auditLog.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { metadata: { courseSlug: "speaking-up", stage: "context", seconds: 50, lastAddedAt: NOW.toISOString() } },
    });
  });

  it("adds all the player sent when it is within that time", async () => {
    auditLog.findFirst.mockResolvedValue({ id: "a1", metadata: { seconds: 30, lastAddedAt: ago(300_000) } });
    await recordStageTime({ courseSlug: "speaking-up", stage: "context", seconds: 120 });
    expect(auditLog.update.mock.calls[0][0].data.metadata.seconds).toBe(150);
  });

  it("adds nothing, and writes nothing, when no time has passed since the row was last added to", async () => {
    auditLog.findFirst.mockResolvedValue({ id: "a1", metadata: { seconds: 30, lastAddedAt: NOW.toISOString() } });
    await expect(recordStageTime({ courseSlug: "speaking-up", stage: "context", seconds: 30 })).resolves.toBeUndefined();
    expect(auditLog.update).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it("takes the row one call at a time: the lock comes before the row is read", async () => {
    await recordStageTime({ courseSlug: "speaking-up", stage: "context", seconds: 12 });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect($executeRaw.mock.calls[0].slice(1)).toEqual(["stage.time:u1:speaking-up:context"]);
    expect($executeRaw.mock.invocationCallOrder[0]).toBeLessThan(auditLog.findFirst.mock.invocationCallOrder[0]);
  });

  it.each([
    ["a lesson of its own the course doesn't have", speakingUp(), "s-zzzzzzzz"],
    ["a standard exercise the course doesn't have", speakingUp({ outline: null }), "simulation"],
    ["a lesson of its own in a built-in course", speakingUp({ meta: null, outline: null }), "s-abcdefgh"],
    ["a course nobody ever published", speakingUp({ status: "draft", publishedAt: null }), "context"],
  ])("ignores time on %s", async (_name, row, stage) => {
    course.findUnique.mockResolvedValue(row);
    await expect(recordStageTime({ courseSlug: "speaking-up", stage, seconds: 12 })).resolves.toBeUndefined();
    nothingWritten();
  });

  it("ignores time in a course no row has (a slug no course has), looked up in the project", async () => {
    course.findUnique.mockResolvedValue(null);
    await expect(recordStageTime({ courseSlug: "made-up", stage: "context", seconds: 12 })).resolves.toBeUndefined();
    expect(course.findUnique.mock.calls[0][0].where).toEqual({ projectId_slug: { projectId: "seq-elevate", slug: "made-up" } });
    nothingWritten();
  });

  it("keeps recording in a course taken off after it was published (D62.f), and in a built-in course's standard lessons", async () => {
    course.findUnique.mockResolvedValue(speakingUp({ status: "archived" }));
    await recordStageTime({ courseSlug: "speaking-up", stage: "context", seconds: 12 });
    course.findUnique.mockResolvedValue(speakingUp({ meta: null, outline: null }));
    await recordStageTime({ courseSlug: "speaking-up", stage: "simulation", seconds: 12 });
    expect(auditLog.create).toHaveBeenCalledTimes(2);
  });

  it("counts the call against the learner's limit, and over it writes nothing and answers as before", async () => {
    await recordStageTime({ courseSlug: "speaking-up", stage: "context", seconds: 12 });
    expect(checkRateLimit).toHaveBeenCalledWith("activity:u1", { limit: 120, windowMs: 600_000 });
    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ ok: false, count: 121, limit: 120 });
    await expect(recordStageTime({ courseSlug: "speaking-up", stage: "context", seconds: 12 })).resolves.toBeUndefined();
    expect(course.findUnique).not.toHaveBeenCalled();
    nothingWritten();
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
        // By the clock its hour is read by (D117).
        createdAt: NOW,
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

  it("records at most one per learner, course and clock hour", async () => {
    await recordCourseOpened("speaking-up");
    expect(auditLog.findFirst).toHaveBeenCalledWith({
      where: {
        actorId: "u1",
        action: "course.opened",
        entityId: "speaking-up",
        createdAt: { gte: new Date("2026-12-01T10:00:00.000Z") },
      },
      select: { id: true },
    });
    expect(auditLog.create).toHaveBeenCalledTimes(1);

    auditLog.findFirst.mockResolvedValue({ id: "o1" });
    await expect(recordCourseOpened("speaking-up")).resolves.toBeUndefined();
    expect(auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("takes the learner's record of the course one call at a time", async () => {
    await recordCourseOpened("speaking-up");
    expect($executeRaw.mock.calls[0].slice(1)).toEqual(["course.opened:u1:speaking-up"]);
    expect($executeRaw.mock.invocationCallOrder[0]).toBeLessThan(auditLog.findFirst.mock.invocationCallOrder[0]);
  });

  it.each([
    ["no row (a slug no course has)", null],
    ["a draft", speakingUp({ status: "draft", publishedAt: null })],
    ["a course taken off the shelf (learners can't open it)", speakingUp({ status: "archived" })],
  ])("ignores a course with %s", async (_name, row) => {
    course.findUnique.mockResolvedValue(row);
    await expect(recordCourseOpened("speaking-up")).resolves.toBeUndefined();
    nothingWritten();
  });

  it("over the learner's limit writes nothing and answers as before", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, count: 121, limit: 120 });
    await expect(recordCourseOpened("speaking-up")).resolves.toBeUndefined();
    expect(checkRateLimit).toHaveBeenCalledWith("activity:u1", { limit: 120, windowMs: 600_000 });
    nothingWritten();
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
    nothingWritten();
    // Nor is the call counted (D117's limit writes a counter).
    expect(checkRateLimit).not.toHaveBeenCalled();
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
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });
});
