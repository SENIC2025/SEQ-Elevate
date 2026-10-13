import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import {
  STAFF_ROLES,
  isProjectLearner,
  learnerMembershipWhere,
  learnerUserWhere,
} from "./learner-scope";

/*
 * Who counts as a learner of a project: a LEARNER membership there and no
 * staff membership there. Staff who opened a learner page before Release 0
 * still hold the LEARNER role that page used to give everyone, and none of
 * those rows is deleted, so every roster, count and statistic reads people
 * through this rule instead.
 */

const STAFF = { in: ["FACILITATOR", "ADMIN", "CONTENT_EDITOR"] };

describe("STAFF_ROLES", () => {
  it("is every role other than LEARNER", () => {
    expect([...STAFF_ROLES].sort()).toEqual(["ADMIN", "CONTENT_EDITOR", "FACILITATOR"]);
  });
});

describe("isProjectLearner", () => {
  it("is true for someone who only holds LEARNER", () => {
    expect(isProjectLearner(["LEARNER"])).toBe(true);
  });

  it.each<[Role[]]>([
    [["LEARNER", "FACILITATOR"]],
    [["LEARNER", "ADMIN"]],
    [["LEARNER", "CONTENT_EDITOR"]],
    [["ADMIN", "CONTENT_EDITOR", "FACILITATOR", "LEARNER"]],
  ])("is false for staff who still hold an old LEARNER role: %j", (roles) => {
    expect(isProjectLearner(roles)).toBe(false);
  });

  it.each<[Role[]]>([[[]], [["FACILITATOR"]], [["CONTENT_EDITOR", "ADMIN"]]])(
    "is false for someone without the LEARNER role: %j",
    (roles) => {
      expect(isProjectLearner(roles)).toBe(false);
    }
  );
});

describe("learnerMembershipWhere", () => {
  it("selects LEARNER memberships of people with no staff role in the project", () => {
    expect(learnerMembershipWhere("seq-elevate")).toEqual({
      projectId: "seq-elevate",
      role: "LEARNER",
      user: {
        memberships: { none: { projectId: "seq-elevate", role: STAFF } },
      },
    });
  });

  it("looks for staff roles in the same project only", () => {
    const where = learnerMembershipWhere("other");
    expect(where.user).toEqual({
      memberships: { none: { projectId: "other", role: STAFF } },
    });
  });
});

describe("learnerUserWhere", () => {
  it("selects people with a LEARNER membership and no staff role in the project", () => {
    expect(learnerUserWhere("seq-elevate")).toEqual({
      memberships: {
        some: { projectId: "seq-elevate", role: "LEARNER" },
        none: { projectId: "seq-elevate", role: STAFF },
      },
    });
  });
});
