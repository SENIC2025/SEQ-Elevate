import { describe, it, expect } from "vitest";
import type { LearnerCourse } from "@/lib/cms/learner-course";
import { completionCourse } from "./completion-course";
import { sectionStage } from "./test-fixtures";

const course: LearnerCourse = {
  slug: "speaking-up",
  locale: "de",
  cluster: "communication",
  title: "Sprich es an",
  clusterLabel: "Kommunikation",
  tagline: "Klar und ruhig",
  durationMinutes: 20,
  badge: { slug: "speaking-up", name: "Klare Stimme", meaning: "Sagt, was zählt" },
  lessons: [{ kind: "section", id: sectionStage.key, label: "Warm-up", section: sectionStage }],
  unseen: ["concept"],
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

  it("carries none of the course's lessons", () => {
    const got = completionCourse(course);
    expect(got.stages).toEqual([]);
    expect("lessons" in got).toBe(false);
    expect("unseen" in got).toBe(false);
    // The learner course itself is left as it was.
    expect(course.lessons).toHaveLength(1);
  });
});
