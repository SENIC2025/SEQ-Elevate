import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, prisma, reset, row } from "./sections-test-db";
import { fingerprint } from "@/lib/cms/stored-json";

/*
 * Lesson text, video and documents for the lessons of a created course's
 * own (Release 1, G6): a text lesson's text is saved with today's narrative
 * actions, only while the lesson is in the course's lesson list and its main
 * content is text. The media actions no longer make a row for any key a
 * request names: a lesson of the course's own must be in the list.
 * Standard lessons keep exactly today's path.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/auth-helpers", () => ({
  getCurrentUser: async () => (db.signedIn ? { id: "editor-1" } : null),
  getProjectMemberships: async () => db.roles.map((role) => ({ role })),
}));

const {
  saveLessonNarrative,
  clearLessonNarrative,
  saveLessonVideo,
  clearLessonVideo,
  addLessonDocument,
  getLessonMedia,
} = await import("./lesson");

const SLUG = "my-course";
const OWN = "s-abcdefgh";
const QUIZ = "s-quiz0000";
const entry = { title: "Warm-up", blocks: [{ kind: "paragraph" as const, text: "Hello" }] };
const VIDEO = { provider: "youtube" as const, src: "https://www.youtube.com/watch?v=abc" };
const DOC = { name: "a.pdf", url: "https://blob.example/a.pdf", mimeType: "application/pdf", sizeBytes: 10 };

beforeEach(() => {
  reset();
  db.course!.outline = {
    v: 1,
    sections: [
      { id: "context", template: "context" },
      { id: OWN, template: "text" },
      { id: QUIZ, template: "quiz" },
    ],
  };
});

describe("saveLessonNarrative and clearLessonNarrative", () => {
  it("saves a text lesson of the course's own, the course locked before the lesson", async () => {
    const res = await saveLessonNarrative(SLUG, OWN, "en", entry, null);
    expect(res).toEqual({ ok: true, version: expect.any(String) });
    expect(db.lessons.find((l) => l.stageKey === OWN)?.narrative).toEqual({ en: entry });
    expect(db.log).toEqual([
      "lock Course share",
      `upsert Lesson:${OWN}`,
      `lock Lesson:${OWN} update`,
      `write Lesson:${OWN}`,
    ]);

    const clear = await clearLessonNarrative(SLUG, OWN, "en", fingerprint(entry));
    expect(clear).toEqual({ ok: true });
    expect(db.lessons.find((l) => l.stageKey === OWN)?.narrative).toBeNull();
  });

  it("refuses a lesson that isn't in the list, or whose main content isn't text", async () => {
    expect(await saveLessonNarrative(SLUG, "s-zzzzzzzz", "en", entry, null)).toEqual({
      ok: false,
      error: "not-a-section",
    });
    expect(await saveLessonNarrative(SLUG, QUIZ, "en", entry, null)).toEqual({
      ok: false,
      error: "kind-mismatch",
    });
    expect(await clearLessonNarrative(SLUG, "s-zzzzzzzz", "en", null)).toEqual({
      ok: false,
      error: "not-a-section",
    });
    expect(db.lessons).toEqual([]);
  });

  it("refuses an id that is no lesson at all", async () => {
    expect(await saveLessonNarrative(SLUG, "lesson-1", "en", entry, null)).toEqual({
      ok: false,
      error: "bad-stage",
    });
  });

  it("leaves a standard lesson's path as it was: no Course lock", async () => {
    expect(await saveLessonNarrative(SLUG, "context", "en", entry, null)).toMatchObject({ ok: true });
    expect(db.log).toEqual([
      "upsert Lesson:context",
      "lock Lesson:context update",
      "write Lesson:context",
    ]);
  });
});

describe("the media actions", () => {
  it("check the course and the lesson before writing anything", async () => {
    const bad = { ok: false, error: "bad-input" };
    expect(await saveLessonVideo("Bad Slug", "context", VIDEO)).toEqual(bad);
    expect(await saveLessonVideo(SLUG, "anything", VIDEO)).toEqual(bad);
    expect(await clearLessonVideo(SLUG, "anything")).toEqual(bad);
    expect(await addLessonDocument(SLUG, "anything", DOC)).toEqual(bad);
    expect(await saveLessonVideo(SLUG, "s-zzzzzzzz", VIDEO)).toEqual({ ok: false, error: "not-a-section" });
    expect(await addLessonDocument(SLUG, "s-zzzzzzzz", DOC)).toEqual({ ok: false, error: "not-a-section" });
    // No stray row is made for a key nobody listed.
    expect(db.lessons).toEqual([]);
  });

  it("attach a video and a document to a lesson of the course's own", async () => {
    expect(await saveLessonVideo(SLUG, OWN, VIDEO)).toEqual({ ok: true });
    expect(await addLessonDocument(SLUG, OWN, DOC)).toEqual({ ok: true, id: "doc-1" });
    const lesson = db.lessons.find((l) => l.stageKey === OWN);
    expect(lesson?.video).toEqual(VIDEO);
    expect(lesson?.documents).toEqual([{ id: "doc-1", url: DOC.url }]);
    expect(await clearLessonVideo(SLUG, OWN)).toEqual({ ok: true });
    expect(db.lessons.find((l) => l.stageKey === OWN)?.video).toBeNull();
  });

  it("keep working for standard lessons, built-in courses included", async () => {
    db.course = { ...db.course!, meta: null, outline: null };
    expect(await saveLessonVideo(SLUG, "scenario", VIDEO)).toEqual({ ok: true });
    expect(await saveLessonVideo(SLUG, OWN, VIDEO)).toEqual({ ok: false, error: "not-a-section" });
  });

  it("give the editor nothing for a lesson that isn't there", async () => {
    db.lessons = [row(OWN, { video: VIDEO })];
    expect(await getLessonMedia(SLUG, OWN)).toEqual({ video: VIDEO, documents: [] });
    db.course!.outline = null;
    expect(await getLessonMedia(SLUG, OWN)).toEqual({ video: null, documents: [] });
    expect(await getLessonMedia("../x", "context")).toEqual({ video: null, documents: [] });
  });
});
