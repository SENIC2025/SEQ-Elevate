import { describe, it, expect, afterEach, vi } from "vitest";
import DevLayout from "./layout";

/*
 * Developer pages exist only on test copies: where test sign-in is
 * switched on (Release 3, D98: DEMO_LOGIN_ENABLED and a private access
 * code), and never on Vercel's production environment.
 */
const TEST_COPY = { DEMO_LOGIN_ENABLED: "true", DEMO_ACCESS_CODE: "a-private-code-1" };
const stub = (env: Record<string, string>) => {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
};

describe("dev pages", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("are a 404 on the live site", () => {
    stub(TEST_COPY);
    vi.stubEnv("VERCEL_ENV", "production");
    // notFound() throws Next's 404 signal (message = its digest).
    expect(() => DevLayout({ children: "page" })).toThrow(/;404$/);
  });

  it("are a 404 wherever test sign-in isn't switched on (e.g. self-hosted)", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("DEMO_LOGIN_ENABLED", "");
    vi.stubEnv("DEMO_ACCESS_CODE", "");
    expect(() => DevLayout({ children: "page" })).toThrow(/;404$/);
    // Release 2's switch no longer turns them on.
    vi.stubEnv("DEMO_LOGIN_DISABLED", "");
    expect(() => DevLayout({ children: "page" })).toThrow(/;404$/);
  });

  it("render on test copies, previews and locally", () => {
    stub(TEST_COPY);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(DevLayout({ children: "page" })).toBe("page");
    vi.stubEnv("VERCEL_ENV", "");
    expect(DevLayout({ children: "page" })).toBe("page");
  });
});
