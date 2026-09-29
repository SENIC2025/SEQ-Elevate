import { describe, it, expect } from "vitest";
import {
  EDITOR_ROLES,
  canEditContent,
  includedVia,
  roleIncludes,
} from "./permissions";

describe("roleIncludes", () => {
  it("lets every role include itself", () => {
    for (const r of ["LEARNER", "FACILITATOR", "CONTENT_EDITOR", "ADMIN"] as const) {
      expect(roleIncludes(r, r)).toBe(true);
    }
  });

  it("makes Admin include Editor", () => {
    expect(roleIncludes("ADMIN", "CONTENT_EDITOR")).toBe(true);
  });

  it("never runs the other way — an editor is not an admin", () => {
    expect(roleIncludes("CONTENT_EDITOR", "ADMIN")).toBe(false);
  });

  it("gives facilitators and learners nothing extra", () => {
    expect(roleIncludes("FACILITATOR", "CONTENT_EDITOR")).toBe(false);
    expect(roleIncludes("LEARNER", "CONTENT_EDITOR")).toBe(false);
    expect(roleIncludes("LEARNER", "FACILITATOR")).toBe(false);
  });
});

describe("EDITOR_ROLES", () => {
  it("is exactly Admin and Editor (the old ADMIN || CONTENT_EDITOR gate)", () => {
    expect([...EDITOR_ROLES].sort()).toEqual(["ADMIN", "CONTENT_EDITOR"]);
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
