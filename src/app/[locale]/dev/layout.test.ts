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

  it("render on previews and locally", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(DevLayout({ children: "page" })).toBe("page");
    vi.stubEnv("VERCEL_ENV", "");
    expect(DevLayout({ children: "page" })).toBe("page");
  });
});
