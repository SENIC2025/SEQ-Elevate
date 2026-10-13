import { describe, it, expect } from "vitest";
import type { SectionedCourseContent } from "@/lib/cms/sections/contract";
import { completionCourse } from "./completion-course";
import { sectionStage } from "./test-fixtures";

const course: SectionedCourseContent = {
  sectioned: true,
  slug: "speaking-up",
  locale: "de",
  cluster: "communication",
  title: "Sprich es an",
  clusterLabel: "Kommunikation",
  tagline: "Klar und ruhig",
  durationMinutes: 20,
  badge: { slug: "speaking-up", name: "Klare Stimme", meaning: "Sagt, was zählt" },
  stages: [sectionStage],
  completion: { title: "Geschafft", body: "Gut gemacht." },
};

describe("completionCourse", () => {
  it("hands the completion screen the course's own title, badge and text", () => {
    const got = completionCourse(course);
    expect(got.slug).toBe("speaking-up");
    expect(got.title).toBe("Sprich es an");
    expect(got.locale).toBe("de");
    expect(got.badge).toEqual(course.badge);
    expect(got.completion).toEqual(course.completion);
  });

  it("carries none of the editor's lessons and no sectioned flag", () => {
    const got = completionCourse(course);
    expect(got.stages).toEqual([]);
    expect("sectioned" in got).toBe(false);
    // The preview's course itself is left as it was.
    expect(course.stages).toHaveLength(1);
    expect(course.sectioned).toBe(true);
  });
});
