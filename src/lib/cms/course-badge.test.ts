import { describe, it, expect } from "vitest";
import { courseBadgeCopy, courseBadgeSlug } from "./course-badge";

describe("courseBadgeSlug", () => {
  it("is the slug the player awards for a created course", () => {
    expect(courseBadgeSlug("speaking-up")).toBe("speaking-up-complete");
  });

  it("never takes a slug another badge already has", () => {
    expect(courseBadgeSlug("speaking-up", new Set(["speaking-up-complete"]))).toBe(
      "speaking-up-complete-2"
    );
    expect(
      courseBadgeSlug(
        "speaking-up",
        new Set(["speaking-up-complete", "speaking-up-complete-2"])
      )
    ).toBe("speaking-up-complete-3");
    expect(courseBadgeSlug("speaking-up", new Set(["other-complete"]))).toBe(
      "speaking-up-complete"
    );
  });
});

describe("courseBadgeCopy", () => {
  it("names the badge after the course, and explains it with the subtitle", () => {
    expect(
      courseBadgeCopy({ title: "Speaking up", tagline: "Say what you need" }, "speaking-up")
    ).toEqual({ name: "Speaking up", meaning: "Say what you need" });
  });

  it("says plainly what it's for when there is no subtitle", () => {
    expect(courseBadgeCopy({ title: " Speaking up ", tagline: "  " }, "s")).toEqual({
      name: "Speaking up",
      meaning: "Completed the course “Speaking up”.",
    });
  });

  it("falls back to the slug only when there is no copy at all", () => {
    expect(courseBadgeCopy(null, "speaking-up")).toEqual({
      name: "speaking-up",
      meaning: "Completed the course “speaking-up”.",
    });
  });
});
