import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * U12 (spec 4.6): an in-video answer is kept under its cue's id, as before,
 * with the lesson it was given in when the player says so — for lessons of
 * the course's own too. A cue id longer than any cue has, a lesson id that
 * is no lesson's, a slug the platform wouldn't make or a "correct" that
 * isn't true or false isn't stored.
 *
 * D117: the cue must be a question one of the course's videos asks (an
 * editor's video on a lesson, or the one a built-in course ships), in a
 * course learners get; the lesson is kept only when its video asks it.
 * The call counts against the activity records' limit (120 in 10 minutes
 * per learner), and the learner's answer to a cue is written one call at a
 * time. What the rules refuse writes nothing and is answered as before.
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
/** "speaking-up": a course created in the CMS, published. */
const speakingUp = (over: Record<string, unknown> = {}) => ({
  slug: "speaking-up",
  meta: { en: { title: "Speaking up" } },
  outline: null,
  status: "published",
  publishedAt: new Date("2026-11-20T10:00:00Z"),
  ...over,
});
const video = (...ids: string[]) => ({
  provider: "file",
  src: "/v.mp4",
  cues: ids.map((id) => ({ id, atSeconds: 4, question: "?", options: [], correctOptionId: "a" })),
});
/** Its lessons' videos: cue-1 is asked in its own lesson s-abcdefgh. */
const LESSONS = [
  { stageKey: "context", video: null },
  { stageKey: "s-abcdefgh", video: video("cue-1") },
  { stageKey: "concept", video: video("cue-2") },
];
const nothingWritten = () => {
  expect(auditLog.findFirst).not.toHaveBeenCalled();
  expect(auditLog.create).not.toHaveBeenCalled();
  expect(auditLog.update).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue(USER);
  auditLog.findFirst.mockResolvedValue(null);
  projectProfile.findUnique.mockResolvedValue(completeProfile());
  course.findUnique.mockResolvedValue(speakingUp());
  lesson.findMany.mockResolvedValue(LESSONS);
  $executeRaw.mockResolvedValue(1);
  checkRateLimit.mockResolvedValue({ ok: true, count: 1, limit: 120 });
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

  it("leaves out a lesson whose video doesn't ask the question (D117)", async () => {
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true, lessonId: "concept" });
    expect(auditLog.create.mock.calls[0][0].data.metadata).toEqual({ courseSlug: "speaking-up", correct: true });
  });

  it("updates the answer already kept for the cue", async () => {
    auditLog.findFirst.mockResolvedValue({ id: "a1" });
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true, lessonId: "s-abcdefgh" });
    expect(auditLog.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { metadata: { courseSlug: "speaking-up", correct: true, lessonId: "s-abcdefgh" } },
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

describe("recordVideoCueAnswer: only the course's own questions (D117)", () => {
  it("reads the course in the project, and its lessons' videos", async () => {
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true });
    expect(course.findUnique.mock.calls[0][0].where).toEqual({ projectId_slug: { projectId: "seq-elevate", slug: "speaking-up" } });
    expect(lesson.findMany.mock.calls[0][0].where).toEqual({ projectId: "seq-elevate", courseSlug: "speaking-up" });
  });

  it.each([
    ["a cue id no video of the course asks", "cue-ps4-u1"],
    ["the built-in course's question, in a course created here", "concept-check"],
  ])("ignores %s", async (_name, cueId) => {
    await expect(recordVideoCueAnswer({ courseSlug: "speaking-up", cueId, correct: true })).resolves.toBeUndefined();
    nothingWritten();
  });

  it("keeps an answer to the question a built-in course ships, with its lesson", async () => {
    course.findUnique.mockResolvedValue(speakingUp({ slug: "workplace-conflict", meta: null }));
    lesson.findMany.mockResolvedValue([]);
    await recordVideoCueAnswer({ courseSlug: "workplace-conflict", cueId: "concept-check", correct: true, lessonId: "concept" });
    expect(auditLog.create.mock.calls[0][0].data).toMatchObject({
      entityId: "concept-check",
      metadata: { courseSlug: "workplace-conflict", correct: true, lessonId: "concept" },
    });
  });

  it.each([
    ["no row (a slug no course has)", null],
    ["nobody ever published it", speakingUp({ status: "draft", publishedAt: null })],
  ])("ignores an answer in a course with %s", async (_name, row) => {
    course.findUnique.mockResolvedValue(row);
    await expect(recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true })).resolves.toBeUndefined();
    nothingWritten();
  });

  it("keeps an answer in a course taken off after it was published (D62.f)", async () => {
    course.findUnique.mockResolvedValue(speakingUp({ status: "archived" }));
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true });
    expect(auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("counts the call against the learner's limit, and over it writes nothing and answers as before", async () => {
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true });
    expect(checkRateLimit).toHaveBeenCalledWith("activity:u1", { limit: 120, windowMs: 600_000 });
    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ ok: false, count: 121, limit: 120 });
    await expect(recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true })).resolves.toBeUndefined();
    expect(course.findUnique).not.toHaveBeenCalled();
    nothingWritten();
  });

  it("takes the learner's answer to the cue one call at a time: the lock comes before the row is read", async () => {
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect($executeRaw.mock.calls[0].slice(1)).toEqual(["video.cue_answered:u1:cue-1"]);
    expect($executeRaw.mock.invocationCallOrder[0]).toBeLessThan(auditLog.findFirst.mock.invocationCallOrder[0]);
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
      recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true, lessonId: "s-abcdefgh" })
    ).resolves.toBe("profile-incomplete");
    nothingWritten();
    // Nor is the call counted (D117's limit writes a counter).
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("reads the signed-in person's own profile, nobody else's", async () => {
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true });
    expect(projectProfile.findUnique.mock.calls.map((c) => c[0].where)).toEqual([
      { userId_projectId: { userId: "u1", projectId: "seq-elevate" } },
    ]);
    expect(auditLog.create).toHaveBeenCalledTimes(1);
  });
});
