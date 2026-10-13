import { describe, it, expect } from "vitest";
import {
  canRecordForLearner,
  facilitatorText,
  FACILITATOR_TEXT_MAX,
  isSkillCluster,
} from "./facilitator-access";

describe("canRecordForLearner", () => {
  it("lets a facilitator or an admin write about a learner", () => {
    expect(canRecordForLearner(["FACILITATOR"], ["LEARNER"])).toBe(true);
    expect(canRecordForLearner(["ADMIN"], ["LEARNER"])).toBe(true);
    expect(canRecordForLearner(["ADMIN", "CONTENT_EDITOR"], ["LEARNER", "FACILITATOR"])).toBe(true);
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
