import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import { needsLearnerMembership } from "./learner-membership";

const plain = { bootstrapAdmin: false };

describe("needsLearnerMembership", () => {
  it("makes a person with no role in the project a learner", () => {
    expect(needsLearnerMembership([], plain)).toBe(true);
  });

  it.each<Role[]>([
    ["ADMIN"],
    ["CONTENT_EDITOR"],
    ["FACILITATOR"],
    ["ADMIN", "CONTENT_EDITOR"],
  ])("leaves staff (%s) as they are", (...roles) => {
    expect(needsLearnerMembership(roles, plain)).toBe(false);
  });

  it("has nothing to add for a learner", () => {
    expect(needsLearnerMembership(["LEARNER"], plain)).toBe(false);
    expect(needsLearnerMembership(["LEARNER", "FACILITATOR"], plain)).toBe(false);
  });

  it("never makes an ADMIN_EMAILS address a learner, even before its roles arrive", () => {
    expect(needsLearnerMembership([], { bootstrapAdmin: true })).toBe(false);
  });
});
