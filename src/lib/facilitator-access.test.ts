import { describe, it, expect } from "vitest";
import {
  canRecordForLearner,
  courseSkillCluster,
  facilitatorText,
  FACILITATOR_TEXT_MAX,
  isSkillCluster,
} from "./facilitator-access";

describe("canRecordForLearner", () => {
  it("lets a facilitator or an admin write about a learner", () => {
    expect(canRecordForLearner(["FACILITATOR"], ["LEARNER"])).toBe(true);
    expect(canRecordForLearner(["ADMIN"], ["LEARNER"])).toBe(true);
    expect(canRecordForLearner(["ADMIN", "CONTENT_EDITOR"], ["LEARNER"])).toBe(true);
  });

  it("refuses anyone else as the writer", () => {
    expect(canRecordForLearner([], ["LEARNER"])).toBe(false);
    expect(canRecordForLearner(["LEARNER"], ["LEARNER"])).toBe(false);
    expect(canRecordForLearner(["CONTENT_EDITOR"], ["LEARNER"])).toBe(false);
  });

  it("refuses a person who isn't a learner of the project", () => {
    expect(canRecordForLearner(["FACILITATOR"], [])).toBe(false);
    expect(canRecordForLearner(["FACILITATOR"], ["CONTENT_EDITOR"])).toBe(false);
    expect(canRecordForLearner(["ADMIN"], ["FACILITATOR", "ADMIN"])).toBe(false);
  });

  // Staff who opened a learner page before Release 0 still hold the LEARNER
  // role it gave everyone; that old row doesn't make them a learner.
  it("refuses staff who still hold an old LEARNER role", () => {
    expect(canRecordForLearner(["FACILITATOR"], ["LEARNER", "FACILITATOR"])).toBe(false);
    expect(canRecordForLearner(["FACILITATOR"], ["LEARNER", "ADMIN"])).toBe(false);
    expect(canRecordForLearner(["ADMIN"], ["LEARNER", "CONTENT_EDITOR"])).toBe(false);
  });
});

describe("facilitatorText", () => {
  it("trims text and keeps it up to the limit", () => {
    expect(facilitatorText("  Listened well ")).toBe("Listened well");
    expect(facilitatorText("a".repeat(FACILITATOR_TEXT_MAX))).toHaveLength(FACILITATOR_TEXT_MAX);
  });

  it("refuses text over the limit, and anything that isn't text", () => {
    expect(facilitatorText("a".repeat(FACILITATOR_TEXT_MAX + 1))).toBeNull();
    expect(facilitatorText(5)).toBeNull();
    expect(facilitatorText({})).toBeNull();
    expect(facilitatorText(undefined)).toBeNull();
  });
});

describe("isSkillCluster", () => {
  it("knows the skill clusters, and nothing else", () => {
    expect(isSkillCluster("communicationEi")).toBe(true);
    expect(isSkillCluster("leadership")).toBe(true);
    expect(isSkillCluster("<anything>")).toBe(false);
    expect(isSkillCluster("")).toBe(false);
    expect(isSkillCluster(3)).toBe(false);
  });
});

/*
 * A validation is recorded for a skill cluster. The facilitator's choice
 * starts on the one the learner's current course is about: a bundled
 * course carries the cluster's key, a course created in the platform the
 * key its free-text skill area made ("Problem solving" → "problem-solving").
 */
describe("courseSkillCluster", () => {
  it("takes a bundled course's cluster as it is", () => {
    expect(courseSkillCluster("communicationEi")).toBe("communicationEi");
    expect(courseSkillCluster("resilience")).toBe("resilience");
  });

  it("reads the skill area of a course created in the platform", () => {
    expect(courseSkillCluster("problem-solving")).toBe("problemSolving");
    expect(courseSkillCluster("teamwork")).toBe("teamwork");
    expect(courseSkillCluster("Leadership")).toBe("leadership");
    // "Communication", and what a course gets with no skill area at all.
    expect(courseSkillCluster("communication")).toBe("communicationEi");
  });

  it("knows no cluster for any other skill area, so the facilitator chooses", () => {
    expect(courseSkillCluster("digital-skills")).toBeNull();
    expect(courseSkillCluster("skill")).toBeNull();
    expect(courseSkillCluster("com")).toBeNull();
    expect(courseSkillCluster("")).toBeNull();
    expect(courseSkillCluster(null)).toBeNull();
    expect(courseSkillCluster(undefined)).toBeNull();
  });
});
