import { describe, it, expect, vi, afterEach } from "vitest";
import { parseAdminEmails } from "./admin-bootstrap";

describe("parseAdminEmails", () => {
  it("splits on commas, semicolons, spaces and newlines", () => {
    expect(
      parseAdminEmails("a@x.eu, b@x.eu;c@x.eu\nd@x.eu  e@x.eu")
    ).toEqual(new Set(["a@x.eu", "b@x.eu", "c@x.eu", "d@x.eu", "e@x.eu"]));
  });

  it("lower-cases so a capitalised entry still matches", () => {
    expect(parseAdminEmails("Lead@Diesis.EU")).toEqual(
      new Set(["lead@diesis.eu"])
    );
  });

  it("drops blanks and anything that isn't an email", () => {
    expect(parseAdminEmails(" , ; admin  ,, x@y.eu ")).toEqual(
      new Set(["x@y.eu"])
    );
  });

  it("is empty when the variable is unset", () => {
    expect(parseAdminEmails(undefined).size).toBe(0);
    expect(parseAdminEmails("").size).toBe(0);
  });
});

describe("isBootstrapAdmin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // The list is read once at module load, so re-import after stubbing the env.
  async function load(adminEmails: string) {
    vi.stubEnv("ADMIN_EMAILS", adminEmails);
    vi.resetModules();
    return (await import("./admin-bootstrap")).isBootstrapAdmin;
  }

  it("recognises a listed address regardless of case or padding", async () => {
    const isBootstrapAdmin = await load("lead@diesis.eu");
    expect(isBootstrapAdmin("lead@diesis.eu")).toBe(true);
    expect(isBootstrapAdmin("  LEAD@diesis.eu ")).toBe(true);
  });

  it("rejects addresses that are not listed, and empty input", async () => {
    const isBootstrapAdmin = await load("lead@diesis.eu");
    expect(isBootstrapAdmin("learner@example.com")).toBe(false);
    expect(isBootstrapAdmin(null)).toBe(false);
    expect(isBootstrapAdmin(undefined)).toBe(false);
    expect(isBootstrapAdmin("")).toBe(false);
  });

  it("grants nobody when ADMIN_EMAILS is unset", async () => {
    const isBootstrapAdmin = await load("");
    expect(isBootstrapAdmin("lead@diesis.eu")).toBe(false);
  });
});
