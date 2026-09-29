import { describe, it, expect } from "vitest";
import {
  workspacesFor,
  workspaceForPath,
  featuredWorkspaces,
  primaryRole,
} from "./workspaces";

const ids = (roles: Parameters<typeof workspacesFor>[0]) =>
  workspacesFor(roles).map((w) => w.id);

describe("workspacesFor", () => {
  it("gives a learner only their learning space (so the hub can skip itself)", () => {
    expect(ids(["LEARNER"])).toEqual(["learner"]);
  });

  it("gives a brand-new account with no roles yet the learning space", () => {
    expect(ids([])).toEqual(["learner"]);
  });

  it("lets a content editor create and manage courses", () => {
    expect(ids(["CONTENT_EDITOR"])).toEqual(["content", "courses", "learner"]);
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
      "courses",
      "admin",
      "facilitator",
      "analytics",
      "learner",
    ]);
  });

  it("never duplicates a workspace when roles overlap", () => {
    expect(ids(["ADMIN", "CONTENT_EDITOR", "FACILITATOR", "LEARNER"])).toEqual(
      ["content", "courses", "admin", "facilitator", "analytics", "learner"]
    );
  });

  it("pairs every workspace with its route", () => {
    expect(workspacesFor(["ADMIN"]).map((w) => w.href)).toEqual([
      "/content",
      "/content/courses",
      "/admin",
      "/facilitator",
      "/analytics",
      "/learner",
    ]);
  });
});

describe("featuredWorkspaces", () => {
  it("leaves out My learning when the person has staff workspaces", () => {
    expect(featuredWorkspaces(["FACILITATOR"]).map((w) => w.id)).toEqual([
      "facilitator",
      "analytics",
    ]);
  });

  it("advertises both course workspaces to a content editor", () => {
    expect(featuredWorkspaces(["CONTENT_EDITOR"]).map((w) => w.id)).toEqual([
      "content",
      "courses",
    ]);
  });

  it("keeps My learning when it is all a learner has", () => {
    expect(featuredWorkspaces(["LEARNER"]).map((w) => w.id)).toEqual([
      "learner",
    ]);
  });
});

describe("primaryRole", () => {
  it("picks the most senior role held", () => {
    expect(primaryRole(["LEARNER", "FACILITATOR"])).toBe("FACILITATOR");
    expect(primaryRole(["FACILITATOR", "CONTENT_EDITOR"])).toBe(
      "CONTENT_EDITOR"
    );
    expect(primaryRole(["CONTENT_EDITOR", "ADMIN"])).toBe("ADMIN");
  });

  it("falls back to learner", () => {
    expect(primaryRole(["LEARNER"])).toBe("LEARNER");
    expect(primaryRole([])).toBe("LEARNER");
  });
});

describe("workspaceForPath", () => {
  it("matches a workspace root and anything beneath it", () => {
    expect(workspaceForPath("/content")).toBe("content");
    expect(workspaceForPath("/content/anything")).toBe("content");
    expect(workspaceForPath("/admin/people")).toBe("admin");
    expect(workspaceForPath("/learner/course/workplace-conflict")).toBe(
      "learner"
    );
  });

  it("prefers the longest matching route", () => {
    expect(workspaceForPath("/content/courses")).toBe("courses");
    expect(workspaceForPath("/content/courses/workplace-conflict")).toBe(
      "courses"
    );
    // Only a whole path segment counts.
    expect(workspaceForPath("/content/coursesx")).toBe("content");
  });

  it("does not match a path that merely starts with the same letters", () => {
    expect(workspaceForPath("/contentful")).toBeNull();
  });

  it("returns null outside any workspace", () => {
    expect(workspaceForPath("/")).toBeNull();
    expect(workspaceForPath("/account")).toBeNull();
  });
});
