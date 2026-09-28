import { describe, it, expect } from "vitest";
import { workspacesFor, workspaceForPath } from "./workspaces";

const ids = (roles: Parameters<typeof workspacesFor>[0]) =>
  workspacesFor(roles).map((w) => w.id);

describe("workspacesFor", () => {
  it("gives a learner only their learning space (so the hub can skip itself)", () => {
    expect(ids(["LEARNER"])).toEqual(["learner"]);
  });

  it("gives a brand-new account with no roles yet the learning space", () => {
    expect(ids([])).toEqual(["learner"]);
  });

  it("lets a content editor create courses", () => {
    expect(ids(["CONTENT_EDITOR"])).toEqual(["content", "learner"]);
  });

  it("gives a facilitator their learners and the statistics", () => {
    expect(ids(["FACILITATOR"])).toEqual([
      "facilitator",
      "analytics",
      "learner",
    ]);
  });

  it("gives an admin every workspace, course creation first", () => {
    expect(ids(["ADMIN"])).toEqual([
      "content",
      "admin",
      "facilitator",
      "analytics",
      "learner",
    ]);
  });

  it("never duplicates a workspace when roles overlap", () => {
    expect(ids(["ADMIN", "CONTENT_EDITOR", "FACILITATOR", "LEARNER"])).toEqual(
      ["content", "admin", "facilitator", "analytics", "learner"]
    );
  });

  it("pairs every workspace with its route", () => {
    expect(workspacesFor(["ADMIN"]).map((w) => w.href)).toEqual([
      "/content",
      "/admin",
      "/facilitator",
      "/analytics",
      "/learner",
    ]);
  });
});

describe("workspaceForPath", () => {
  it("matches a workspace root and anything beneath it", () => {
    expect(workspaceForPath("/content")).toBe("content");
    expect(workspaceForPath("/content/preview")).toBe("content");
    expect(workspaceForPath("/admin/people")).toBe("admin");
    expect(workspaceForPath("/learner/course/workplace-conflict")).toBe(
      "learner"
    );
  });

  it("does not match a path that merely starts with the same letters", () => {
    expect(workspaceForPath("/contentful")).toBeNull();
  });

  it("returns null outside any workspace", () => {
    expect(workspaceForPath("/")).toBeNull();
    expect(workspaceForPath("/account")).toBeNull();
  });
});
