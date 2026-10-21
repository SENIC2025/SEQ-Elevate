import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import {
  EDITOR_ROLES,
  canEditContent,
  canManagePeople,
  canSignOffLanguage,
  canSupportLearners,
  grantableRoles,
  includedVia,
  roleIncludes,
  seesWholeProject,
} from "./permissions";

const ALL_ROLES: Role[] = ["LEARNER", "FACILITATOR", "ADMIN", "CONTENT_EDITOR", "PARTNER_ADMIN"];

describe("roleIncludes", () => {
  it("lets every role include itself", () => {
    for (const r of ALL_ROLES) {
      expect(roleIncludes(r, r)).toBe(true);
    }
  });

  it("makes Admin include Editor", () => {
    expect(roleIncludes("ADMIN", "CONTENT_EDITOR")).toBe(true);
  });

  it("never runs the other way — an editor is not an admin", () => {
    expect(roleIncludes("CONTENT_EDITOR", "ADMIN")).toBe(false);
  });

  it("gives a role this code doesn't know nothing extra, and doesn't throw", () => {
    const unknown = "MENTOR" as Role;
    expect(roleIncludes(unknown, "FACILITATOR")).toBe(false);
    expect(canSupportLearners([unknown])).toBe(false);
    expect(canManagePeople([unknown])).toBe(false);
    expect(canEditContent([unknown])).toBe(false);
    expect(grantableRoles([unknown])).toEqual([]);
  });

  it("gives facilitators and learners nothing extra", () => {
    expect(roleIncludes("FACILITATOR", "CONTENT_EDITOR")).toBe(false);
    expect(roleIncludes("LEARNER", "CONTENT_EDITOR")).toBe(false);
    expect(roleIncludes("LEARNER", "FACILITATOR")).toBe(false);
  });
});

describe("the partner admin (Release 3, D76)", () => {
  it("includes Editor and Facilitator, one level only", () => {
    expect(roleIncludes("PARTNER_ADMIN", "CONTENT_EDITOR")).toBe(true);
    expect(roleIncludes("PARTNER_ADMIN", "FACILITATOR")).toBe(true);
    expect(roleIncludes("PARTNER_ADMIN", "ADMIN")).toBe(false);
    expect(roleIncludes("PARTNER_ADMIN", "LEARNER")).toBe(false);
  });

  it("is included by nothing, not even Admin", () => {
    for (const r of ALL_ROLES.filter((r) => r !== "PARTNER_ADMIN")) {
      expect(roleIncludes(r, "PARTNER_ADMIN"), r).toBe(false);
    }
  });

  it("is named as what grants Editor and Facilitator to a partner admin", () => {
    expect(includedVia(["PARTNER_ADMIN"], "CONTENT_EDITOR")).toBe("PARTNER_ADMIN");
    expect(includedVia(["PARTNER_ADMIN"], "FACILITATOR")).toBe("PARTNER_ADMIN");
  });
});

describe("EDITOR_ROLES", () => {
  it("is exactly Admin, Editor and Partner admin (the old ADMIN || CONTENT_EDITOR gate, plus D76)", () => {
    expect([...EDITOR_ROLES].sort()).toEqual(["ADMIN", "CONTENT_EDITOR", "PARTNER_ADMIN"]);
  });

  it("lets a partner admin edit content", () => {
    expect(canEditContent(["PARTNER_ADMIN"])).toBe(true);
  });
});

describe("canSupportLearners", () => {
  it.each<[Role[], boolean]>([
    [["FACILITATOR"], true],
    [["PARTNER_ADMIN"], true],
    [["ADMIN"], true],
    [["LEARNER", "FACILITATOR"], true],
    [["CONTENT_EDITOR"], false],
    [["LEARNER"], false],
    [[], false],
  ])("%j → %s", (roles, expected) => {
    expect(canSupportLearners(roles)).toBe(expected);
  });
});

describe("canManagePeople", () => {
  it.each<[Role[], boolean]>([
    [["ADMIN"], true],
    [["PARTNER_ADMIN"], true],
    [["FACILITATOR"], false],
    [["CONTENT_EDITOR", "FACILITATOR"], false],
    [["LEARNER"], false],
    [[], false],
  ])("%j → %s", (roles, expected) => {
    expect(canManagePeople(roles)).toBe(expected);
  });
});

describe("seesWholeProject", () => {
  it("is Admin only", () => {
    expect(seesWholeProject(["ADMIN"])).toBe(true);
    expect(seesWholeProject(["LEARNER", "ADMIN"])).toBe(true);
    for (const r of ALL_ROLES.filter((r) => r !== "ADMIN")) {
      expect(seesWholeProject([r]), r).toBe(false);
    }
    expect(seesWholeProject(["PARTNER_ADMIN", "FACILITATOR", "CONTENT_EDITOR", "LEARNER"])).toBe(false);
  });
});

describe("grantableRoles", () => {
  it("lets an Admin grant every role", () => {
    expect([...grantableRoles(["ADMIN"])].sort()).toEqual([...ALL_ROLES].sort());
  });

  it("lets a partner admin grant Learner and Facilitator only", () => {
    expect([...grantableRoles(["PARTNER_ADMIN"])].sort()).toEqual(["FACILITATOR", "LEARNER"]);
    expect([...grantableRoles(["PARTNER_ADMIN", "CONTENT_EDITOR", "FACILITATOR"])].sort()).toEqual([
      "FACILITATOR",
      "LEARNER",
    ]);
  });

  it("lets nobody else grant anything", () => {
    for (const roles of [["FACILITATOR"], ["CONTENT_EDITOR"], ["LEARNER"], []] as Role[][]) {
      expect(grantableRoles(roles), JSON.stringify(roles)).toEqual([]);
    }
  });

  it("takes the widest set when someone holds both", () => {
    expect([...grantableRoles(["PARTNER_ADMIN", "ADMIN"])].sort()).toEqual([...ALL_ROLES].sort());
  });
});

describe("canSignOffLanguage", () => {
  it("is a partner admin or an Admin (D90)", () => {
    expect(canSignOffLanguage(["PARTNER_ADMIN"])).toBe(true);
    expect(canSignOffLanguage(["ADMIN"])).toBe(true);
    expect(canSignOffLanguage(["CONTENT_EDITOR"])).toBe(false);
    expect(canSignOffLanguage(["FACILITATOR"])).toBe(false);
    expect(canSignOffLanguage(["LEARNER"])).toBe(false);
    expect(canSignOffLanguage([])).toBe(false);
  });
});

describe("canEditContent", () => {
  it("allows an editor", () => {
    expect(canEditContent(["CONTENT_EDITOR"])).toBe(true);
  });

  it("allows an admin without a separate Editor membership", () => {
    expect(canEditContent(["ADMIN"])).toBe(true);
  });

  it("allows mixed role sets that contain either", () => {
    expect(canEditContent(["LEARNER", "ADMIN"])).toBe(true);
    expect(canEditContent(["FACILITATOR", "CONTENT_EDITOR"])).toBe(true);
  });

  it("refuses facilitators, learners and people with no roles", () => {
    expect(canEditContent(["FACILITATOR"])).toBe(false);
    expect(canEditContent(["LEARNER", "FACILITATOR"])).toBe(false);
    expect(canEditContent([])).toBe(false);
  });
});

describe("includedVia", () => {
  it("names Admin as what grants Editor to an admin", () => {
    expect(includedVia(["ADMIN"], "CONTENT_EDITOR")).toBe("ADMIN");
    expect(includedVia(["CONTENT_EDITOR", "ADMIN"], "CONTENT_EDITOR")).toBe(
      "ADMIN"
    );
  });

  it("is null when only the role itself is held", () => {
    expect(includedVia(["CONTENT_EDITOR"], "CONTENT_EDITOR")).toBeNull();
  });

  it("is null when nothing grants it", () => {
    expect(includedVia(["FACILITATOR"], "CONTENT_EDITOR")).toBeNull();
    expect(includedVia(["ADMIN"], "FACILITATOR")).toBeNull();
  });
});
