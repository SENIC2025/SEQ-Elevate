import { describe, it, expect, afterEach, vi } from "vitest";

// The page must 404 BEFORE it reads anything: Next renders a page alongside
// its layout, so a layout-only 404 would still build this data into the
// response (it lists unpublished draft courses).
const listCourses = vi.fn();
const getCourse = vi.fn();
const probeDbCourses = vi.fn();
const probeSectionData = vi.fn();
const hasRole = vi.fn();
vi.mock("@/lib/cms", () => ({ listCourses, getCourse }));
vi.mock("@/lib/cms/sections/probe.server", () => ({ probeSectionData }));
vi.mock("@/lib/auth-helpers", () => ({ hasRole }));
vi.mock("@/app/actions/sections", () => ({ repairOutline: vi.fn() }));
vi.mock("@/lib/cms/provider", () => ({ getCMSSource: () => "local" }));
vi.mock("@/lib/cms/db-course", () => ({ probeDbCourses }));
vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));

describe("dev CMS check page", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("is a 404 on the live site and loads nothing", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const { default: Page } = await import("./page");
    await expect(
      Page({ params: Promise.resolve({ locale: "en" }) })
    ).rejects.toThrow(/;404$/);
    expect(listCourses).not.toHaveBeenCalled();
    expect(getCourse).not.toHaveBeenCalled();
    expect(probeDbCourses).not.toHaveBeenCalled();
    expect(probeSectionData).not.toHaveBeenCalled();
    expect(hasRole).not.toHaveBeenCalled();
  });

  it("is a 404 wherever test sign-in is switched off", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("DEMO_LOGIN_DISABLED", "true");
    const { default: Page } = await import("./page");
    await expect(
      Page({ params: Promise.resolve({ locale: "en" }) })
    ).rejects.toThrow(/;404$/);
    expect(listCourses).not.toHaveBeenCalled();
  });
});
