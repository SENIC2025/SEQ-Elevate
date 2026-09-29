import { describe, it, expect, afterEach, vi } from "vitest";
import DevLayout from "./layout";

describe("dev pages", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("are a 404 on the live site", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    // notFound() throws Next's 404 signal (message = its digest).
    expect(() => DevLayout({ children: "page" })).toThrow(/;404$/);
  });

  it("are a 404 wherever test sign-in is switched off (e.g. self-hosted)", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("DEMO_LOGIN_DISABLED", "true");
    expect(() => DevLayout({ children: "page" })).toThrow(/;404$/);
  });

  it("render on previews and locally", () => {
    vi.stubEnv("DEMO_LOGIN_DISABLED", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(DevLayout({ children: "page" })).toBe("page");
    vi.stubEnv("VERCEL_ENV", "");
    expect(DevLayout({ children: "page" })).toBe("page");
  });
});
