import { describe, it, expect, afterEach, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

// The page must decide BEFORE it loads anything: the grid lists drafts and
// enrolment counts, which only editors may see.
const viewerCanEditContent = vi.fn();
const getCourseGrid = vi.fn();
vi.mock("@/lib/editor-gate", () => ({ viewerCanEditContent }));
vi.mock("@/lib/cms/course-admin", () => ({ getCourseGrid }));
vi.mock("@/components/course-manager/CourseGrid", () => ({
  CourseGrid: () => null,
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async () => (key: string) => `courseManager.editorsOnly.${key}`,
}));

const { default: Page } = await import("./page");
const { AccessNotice } = await import("@/components/AccessNotice");
const { CourseGrid } = await import("@/components/course-manager/CourseGrid");

const visit = async (locale: string) =>
  (await Page({ params: Promise.resolve({ locale }) })) as ReactElement<
    Record<string, unknown>
  >;

describe("Manage courses page", () => {
  afterEach(() => vi.clearAllMocks());

  it("shows the editors-only notice to anyone else, and loads nothing", async () => {
    viewerCanEditContent.mockResolvedValue(false);
    const el = await visit("en");
    expect(isValidElement(el) && el.type).toBe(AccessNotice);
    expect(el.props.title).toBe("courseManager.editorsOnly.title");
    expect(getCourseGrid).not.toHaveBeenCalled();
  });

  it("loads the grid for an editor, in the page's language", async () => {
    viewerCanEditContent.mockResolvedValue(true);
    getCourseGrid.mockResolvedValue([]);
    const el = await visit("de");
    expect(getCourseGrid).toHaveBeenCalledWith("de");
    expect(el.type).toBe(CourseGrid);
    expect(el.props).toMatchObject({ entries: [], locale: "de" });
  });
});
