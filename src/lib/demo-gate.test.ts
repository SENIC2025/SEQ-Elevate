import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEMO_CODE_MIN, demoCodeMatches, demoLoginAllowed } from "./demo-gate";
import { DEMO_PROFILES } from "./demo-profiles";
import { demoSeedAllowed } from "../../prisma/seed-demo-guard.mjs";

/*
 * Demo sign-in is opt-in and never runs on production (D98, spec 13.8).
 */

const CODE = "a-private-code-1";
const ON = { DEMO_LOGIN_ENABLED: "true", DEMO_ACCESS_CODE: CODE };

describe("demoLoginAllowed", () => {
  it("is on only when enabled, off production, with a code of at least 12 characters", () => {
    expect(DEMO_CODE_MIN).toBe(12);
    expect(demoLoginAllowed(ON)).toBe(true);
    expect(demoLoginAllowed({ ...ON, VERCEL_ENV: "preview" })).toBe(true);
    expect(demoLoginAllowed({ ...ON, VERCEL_ENV: "development" })).toBe(true);
    expect(demoLoginAllowed({ ...ON, DEMO_ACCESS_CODE: "exactly-12ch" })).toBe(true);
  });

  it("is never on production, whatever the other variables say", () => {
    expect(demoLoginAllowed({ ...ON, VERCEL_ENV: "production" })).toBe(false);
    expect(demoLoginAllowed({ ...ON, VERCEL_ENV: " production " })).toBe(false);
    expect(demoLoginAllowed({ ...ON, VERCEL_ENV: "production", DEMO_LOGIN_DISABLED: "false" })).toBe(false);
  });

  it("is off on a preview that hasn't opted in", () => {
    expect(demoLoginAllowed({ VERCEL_ENV: "preview", DEMO_ACCESS_CODE: CODE })).toBe(false);
    for (const value of ["", "1", "yes", "TRUE ", "on"]) {
      expect(demoLoginAllowed({ ...ON, DEMO_LOGIN_ENABLED: value }), value).toBe(false);
    }
    // Release 2's switch is no longer read: unset is not "on".
    expect(demoLoginAllowed({ DEMO_LOGIN_DISABLED: "false", DEMO_ACCESS_CODE: CODE })).toBe(false);
  });

  it("is off when enabled without a code, or with one under 12 characters", () => {
    expect(demoLoginAllowed({ DEMO_LOGIN_ENABLED: "true" })).toBe(false);
    expect(demoLoginAllowed({ ...ON, DEMO_ACCESS_CODE: "" })).toBe(false);
    expect(demoLoginAllowed({ ...ON, DEMO_ACCESS_CODE: "short-code1" })).toBe(false);
    expect(demoLoginAllowed({ ...ON, DEMO_ACCESS_CODE: "   eleven-ch   " })).toBe(false);
  });
});

describe("demoCodeMatches", () => {
  it("accepts the configured code, spaces around it ignored", () => {
    expect(demoCodeMatches(CODE, ON)).toBe(true);
    expect(demoCodeMatches(` ${CODE} `, ON)).toBe(true);
  });

  it("refuses anything else", () => {
    for (const code of ["", "a-private-code", `${CODE}x`, "A-PRIVATE-CODE-1", null, undefined, 42, ["a"]]) {
      expect(demoCodeMatches(code, ON), String(code)).toBe(false);
    }
  });

  it("refuses even the right code when demo sign-in isn't allowed", () => {
    expect(demoCodeMatches(CODE, { ...ON, VERCEL_ENV: "production" })).toBe(false);
    expect(demoCodeMatches(CODE, { DEMO_ACCESS_CODE: CODE })).toBe(false);
  });
});

describe("the code holds no demo default", () => {
  const src = fileURLToPath(new URL("../", import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = `${dir}${name}`;
      if (statSync(path).isDirectory()) return files(`${path}/`);
      return /\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });

  it("has no access code written into any source file", () => {
    const withDefault = files(src).filter((f) => /["'`]elevate-demo["'`]/.test(readFileSync(f, "utf8")));
    expect(withDefault).toEqual([]);
  });

  it("gives every demo profile an address of our own demo domain, never a person's", () => {
    for (const p of DEMO_PROFILES) expect(p.email, p.id).toMatch(/^[a-z0-9-]+@seq-elevate\.eu$/);
    expect(DEMO_PROFILES.find((p) => p.roles.includes("ADMIN"))?.email).toBe("demo-admin@seq-elevate.eu");
  });
});

/*
 * Every place that asks whether this is a demo deployment asks the same
 * question (spec 13.8): the demo and sign-in pages, the front door, the
 * statistics' sample, the developer pages and the build's demo seed. The
 * switch Release 2 read is read nowhere.
 */
describe("one demo switch everywhere", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const sources = (dir: string): string[] =>
    readdirSync(`${root}${dir}`).flatMap((name) => {
      const path = `${dir}${name}`;
      if (statSync(`${root}${path}`).isDirectory()) return sources(`${path}/`);
      return /\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

  it("never reads DEMO_LOGIN_DISABLED", () => {
    const readers = [...sources("src/"), ...sources("prisma/")].filter((f) =>
      /env\.DEMO_LOGIN_DISABLED|env\[["']DEMO_LOGIN_DISABLED["']\]/.test(read(f))
    );
    expect(readers).toEqual([]);
  });

  it.each([
    "src/app/[locale]/page.tsx",
    "src/app/[locale]/demo/page.tsx",
    "src/app/[locale]/signin/page.tsx",
    "src/app/[locale]/analytics/page.tsx",
    "src/lib/dev-pages.ts",
    "src/app/actions/demo.ts",
    "src/auth.ts",
  ])("%s asks demoLoginAllowed", (file) => {
    expect(read(file)).toMatch(/demoLoginAllowed\(\)/);
  });

  it("seeds the demo course exactly where demo sign-in is allowed", () => {
    expect(read("prisma/seed-demo.mjs")).toMatch(/demoSeedAllowed\(process\.env\)/);
    const envs = [
      ON,
      { ...ON, VERCEL_ENV: "preview" },
      { ...ON, VERCEL_ENV: "production" },
      { ...ON, VERCEL_ENV: " production " },
      { ...ON, DEMO_LOGIN_ENABLED: "1" },
      { ...ON, DEMO_LOGIN_ENABLED: "" },
      { ...ON, DEMO_ACCESS_CODE: "short-code1" },
      { ...ON, DEMO_ACCESS_CODE: "   eleven-ch   " },
      { ...ON, DEMO_ACCESS_CODE: "exactly-12ch" },
      { DEMO_LOGIN_ENABLED: "true" },
      { DEMO_LOGIN_DISABLED: "false", DEMO_ACCESS_CODE: CODE },
      {},
    ];
    for (const env of envs) expect(demoSeedAllowed(env), JSON.stringify(env)).toBe(demoLoginAllowed(env));
  });
});
