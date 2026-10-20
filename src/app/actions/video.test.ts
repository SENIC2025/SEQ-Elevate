import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * U12 (spec 4.6): an in-video answer is kept under its cue's id, as before,
 * with the lesson it was given in when the player says so — for lessons of
 * the course's own too. A cue id longer than any cue has, or a lesson id
 * that is no lesson's, isn't stored.
 */

const getCurrentUser = vi.fn();
const auditLog = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog } }));

const { recordVideoCueAnswer } = await import("./video");

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1", lastProjectId: null });
  auditLog.findFirst.mockResolvedValue(null);
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

  it("does nothing for a guest", async () => {
    getCurrentUser.mockResolvedValue(null);
    await recordVideoCueAnswer({ courseSlug: "speaking-up", cueId: "cue-1", correct: true });
    expect(auditLog.create).not.toHaveBeenCalled();
  });
});
