import { describe, it, expect, vi } from "vitest";
import { hasEditorLessons } from "../../prisma/seed-demo-guard.mjs";

/*
 * G7: the build's demo seed rewrites "demo-speaking-up" on every deploy. Once
 * an editor has given that course a lesson list of its own, extra content or
 * a lesson of its own, the seed must leave it alone — republishing it would
 * publish past the guard, and its lesson upserts would undo their work.
 */

function client(course: { outline: unknown } | null, lessons: { stageKey: string; parts: unknown }[]) {
  return {
    course: { findFirst: vi.fn(async () => course) },
    lesson: { findMany: vi.fn(async () => lessons) },
  };
}

describe("hasEditorLessons", () => {
  it("is false for the seeded course as the seed leaves it, or no course yet", async () => {
    const seeded = client({ outline: null }, [
      { stageKey: "context", parts: null },
      { stageKey: "simulation", parts: null },
    ]);
    await expect(hasEditorLessons(seeded, "seq-elevate", "demo-speaking-up")).resolves.toBe(false);
    expect(seeded.course.findFirst).toHaveBeenCalledWith({
      where: { projectId: "seq-elevate", slug: "demo-speaking-up" },
      select: { outline: true },
    });
    expect(seeded.lesson.findMany).toHaveBeenCalledWith({
      where: { projectId: "seq-elevate", courseSlug: "demo-speaking-up" },
      select: { stageKey: true, parts: true },
    });
    await expect(hasEditorLessons(client(null, []), "seq-elevate", "demo-speaking-up")).resolves.toBe(false);
  });

  it("is true once an editor stored a lesson list, extra content or a lesson of the course's own", async () => {
    const outline = { v: 1, sections: [{ id: "context", template: "context", label: { en: "Start" } }] };
    await expect(hasEditorLessons(client({ outline }, []), "p", "s")).resolves.toBe(true);
    const parts = { v: 1, items: [{ id: "main", type: "main" }, { id: "p-12345678", type: "text", blocks: {} }] };
    await expect(
      hasEditorLessons(client({ outline: null }, [{ stageKey: "concept", parts }]), "p", "s")
    ).resolves.toBe(true);
    await expect(
      hasEditorLessons(client({ outline: null }, [{ stageKey: "s-abcdefgh", parts: null }]), "p", "s")
    ).resolves.toBe(true);
  });
});
