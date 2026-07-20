import { describe, it, expect } from "vitest";
import { selectByStatus, normaliseStatus } from "./course-status";
import type { CourseSummary } from "./types";

function summary(slug: string, status: CourseSummary["status"]): CourseSummary {
  return {
    slug,
    cluster: "communication",
    title: slug,
    clusterLabel: "Communication",
    tagline: "",
    durationMinutes: 20,
    status,
  };
}

describe("normaliseStatus", () => {
  it("passes through the three known statuses", () => {
    expect(normaliseStatus("draft")).toBe("draft");
    expect(normaliseStatus("archived")).toBe("archived");
    expect(normaliseStatus("published")).toBe("published");
  });

  it("treats anything unrecognised as published", () => {
    // A stray value must never blank the catalogue for learners.
    expect(normaliseStatus("")).toBe("published");
    expect(normaliseStatus("live")).toBe("published");
  });
});

describe("selectByStatus", () => {
  const bundled = [
    summary("a", "published"),
    summary("b", "published"),
    summary("c", "published"),
  ];

  it("hides drafts and archives from learners", () => {
    const out = selectByStatus(
      bundled,
      new Map([
        ["b", "draft"],
        ["c", "archived"],
      ]),
      false
    );
    expect(out.map((c) => c.slug)).toEqual(["a"]);
  });

  it("keeps everything for staff, with the DB status applied", () => {
    const out = selectByStatus(bundled, new Map([["b", "draft"]]), true);
    expect(out.map((c) => c.slug)).toEqual(["a", "b", "c"]);
    expect(out.find((c) => c.slug === "b")?.status).toBe("draft");
  });

  it("keeps a course with no DB row (bundled but never seeded)", () => {
    const out = selectByStatus(bundled, new Map(), false);
    expect(out).toHaveLength(3);
  });

  it("preserves catalogue order", () => {
    const out = selectByStatus(bundled, new Map([["a", "draft"]]), true);
    expect(out.map((c) => c.slug)).toEqual(["a", "b", "c"]);
  });
});
