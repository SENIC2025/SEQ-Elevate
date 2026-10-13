import { describe, it, expect } from "vitest";
import { canRecordForLearner } from "./facilitator-access";

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
