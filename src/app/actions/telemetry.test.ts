import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * U12 (spec 4.6): time on a lesson is recorded by lesson id — a standard
 * key or a lesson of the course's own — for a course slug as the platform
 * makes them. Anything else from the browser is ignored, never stored.
 */

const getCurrentUser = vi.fn();
const auditLog = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog } }));

const { recordStageTime } = await import("./telemetry");

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1", lastProjectId: null });
  auditLog.findFirst.mockResolvedValue(null);
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
