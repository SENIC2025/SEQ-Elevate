import { describe, it, expect, afterEach, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type { CourseContent } from "@/lib/cms/types";
import type { SectionedCourseContent } from "@/lib/cms/sections/contract";

/**
 * The course route (Release 1, spec 10): an editor's preview of a draft
 * built with lessons or content learners don't get yet plays in the
 * sectioned preview player; everything else renders the learner player
 * exactly as before — and a learner never reaches the preview loader.
 */

const getCourse = vi.fn();
const getCourseStatus = vi.fn();
const getViewerRoles = vi.fn();
const getPreviewCourse = vi.fn();
vi.mock("@/lib/cms", () => ({ getCourse }));
vi.mock("@/lib/cms/course-overlay", () => ({ getCourseStatus }));
vi.mock("@/lib/server-queries", () => ({ getViewerRoles }));
vi.mock("@/lib/cms/preview-course", () => ({ getPreviewCourse }));
vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/course/CoursePlayer", () => ({ CoursePlayer: () => null }));
vi.mock("@/components/course/sectioned/SectionedPreviewPlayer", () => ({
  SectionedPreviewPlayer: () => null,
}));
vi.mock("@/store/demo-state", () => ({
  PreviewStateProvider: ({ children }: { children: unknown }) => children,
}));

const { default: Page } = await import("./page");
const { CoursePlayer } = await import("@/components/course/CoursePlayer");
const { SectionedPreviewPlayer } = await import(
  "@/components/course/sectioned/SectionedPreviewPlayer"
);
const { PreviewStateProvider } = await import("@/store/demo-state");

const learnerView = { slug: "speak-up", title: "Speak up", stages: [] } as unknown as CourseContent;
const sectioned = {
  ...learnerView,
  sectioned: true,
  stages: [
    { key: "s-abcd1234", label: "Warm-up", title: "Warm-up", parts: [], skipped: 0 },
    { key: "concept", label: "The idea", title: "The idea", parts: [], skipped: 0 },
  ],
} as unknown as SectionedCourseContent;

type El = ReactElement<Record<string, unknown>>;

async function visit(
  { locale = "en", ...sp }: { locale?: string; lesson?: string; preview?: string; ui?: string } = {}
) {
  return (await Page({
    params: Promise.resolve({ locale, courseId: "speak-up" }),
    searchParams: Promise.resolve(sp),
  })) as El;
}

function setup(o: { status: "draft" | "published"; editor: boolean; preview?: CourseContent | SectionedCourseContent }) {
  getCourse.mockResolvedValue(learnerView);
  getCourseStatus.mockResolvedValue(o.status);
  getViewerRoles.mockResolvedValue(o.editor ? ["CONTENT_EDITOR"] : ["LEARNER"]);
  getPreviewCourse.mockImplementation(async (_p: string, _s: string, _l: string, learner: CourseContent) =>
    o.preview ?? learner
  );
}

/** The player inside the preview's in-memory store, or the bare player. */
function player(el: El): El {
  if (el.type === PreviewStateProvider) return (el.props.children as El);
  return el;
}

describe("course route", () => {
  afterEach(() => vi.clearAllMocks());

  it("gives a learner the learner player, as before, without ever loading a preview", async () => {
    setup({ status: "published", editor: false, preview: sectioned });
    const el = await visit({ preview: "1", lesson: "s-abcd1234" });
    expect(el.type).toBe(CoursePlayer);
    expect(el.props).toEqual({
      course: learnerView,
      draftPreview: false,
      preview: false,
      canEdit: false,
      initialStage: undefined,
      editLocale: undefined,
    });
    expect(getPreviewCourse).not.toHaveBeenCalled();
  });

  it("an editor on a live course, not previewing, gets the learner player and no preview load", async () => {
    setup({ status: "published", editor: true, preview: sectioned });
    const el = await visit();
    expect(el.type).toBe(CoursePlayer);
    expect(getPreviewCourse).not.toHaveBeenCalled();
  });

  it("plays a standard course's preview in the learner player, as before", async () => {
    setup({ status: "draft", editor: true });
    const el = await visit({ lesson: "concept", ui: "de" });
    expect(getPreviewCourse).toHaveBeenCalledWith("seq-elevate", "speak-up", "en", learnerView);
    expect(el.type).toBe(PreviewStateProvider);
    const p = player(el);
    expect(p.type).toBe(CoursePlayer);
    expect(p.props).toMatchObject({
      course: learnerView,
      draftPreview: true,
      preview: true,
      initialStage: "concept",
      editLocale: "de",
    });
  });

  it("plays a draft with the course's own layout in the sectioned preview, from the lesson asked for", async () => {
    setup({ status: "draft", editor: true, preview: sectioned });
    const el = await visit({ locale: "de", lesson: "s-abcd1234", ui: "en" });
    expect(getPreviewCourse).toHaveBeenCalledWith("seq-elevate", "speak-up", "de", learnerView);
    expect(el.type).toBe(PreviewStateProvider);
    const p = player(el);
    expect(isValidElement(p) && p.type).toBe(SectionedPreviewPlayer);
    expect(p.props).toEqual({
      course: sectioned,
      draftPreview: true,
      canEdit: true,
      initialSection: "s-abcd1234",
      editLocale: "en",
    });
  });

  it("starts at the beginning for a lesson the preview hasn't got (hidden, unknown or not an id)", async () => {
    setup({ status: "draft", editor: true, preview: sectioned });
    for (const lesson of ["context", "s-zzzz9999", "../x"]) {
      const p = player(await visit({ lesson }));
      expect(p.type).toBe(SectionedPreviewPlayer);
      expect(p.props.initialSection).toBeUndefined();
    }
  });

  it("is a 404 for a learner on a draft, as before", async () => {
    setup({ status: "draft", editor: false, preview: sectioned });
    await expect(visit()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getPreviewCourse).not.toHaveBeenCalled();
  });
});
