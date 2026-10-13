import { describe, it, expect, vi } from "vitest";
import type { CourseContent } from "./types";

vi.mock("server-only", () => ({}));

const { getPreviewCourse } = await import("./preview-course");

const learner: CourseContent = {
  slug: "asking-for-help",
  locale: "en",
  title: "Asking for help",
  tagline: "Short and real",
  cluster: "communicationEi",
  clusterLabel: "Communication",
  durationMinutes: 15,
  badge: { slug: "asking-for-help", name: "Asking for help", meaning: "Short and real" },
  stages: [],
  completion: { title: "Done", body: "Short and real" },
};

describe("getPreviewCourse", () => {
  it("previews a standard course exactly as learners get it (the same object)", async () => {
    await expect(getPreviewCourse("seq-elevate", "asking-for-help", "en", learner)).resolves.toBe(
      learner
    );
  });
});
