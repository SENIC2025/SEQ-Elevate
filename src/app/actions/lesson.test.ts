import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
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
  setLessonDocumentPublished,
  removeLessonDocument,
} = await import("./lesson");

const SLUG = "my-course";
const OWN = "s-abcdefgh";
const QUIZ = "s-quiz0000";
const entry = { title: "Warm-up", blocks: [{ kind: "paragraph" as const, text: "Hello" }] };
// Our own store (D91): only its files, and YouTube, can be attached.
const STORE = "store1.public.blob.vercel-storage.com";
const VIDEO = { provider: "youtube" as const, src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", cues: [] };
const DOC = { name: "a.pdf", url: `https://${STORE}/a.pdf`, mimeType: "application/pdf", sizeBytes: 10 };

beforeEach(() => {
  reset();
  vi.unstubAllEnvs();
  vi.stubEnv("BLOB_PUBLIC_HOST", STORE);
  db.course!.outline = {
    v: 1,
    sections: [
      { id: "context", template: "context" },
      { id: OWN, template: "text" },
      { id: QUIZ, template: "quiz" },
    ],
  };
});

afterAll(() => vi.unstubAllEnvs());

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

/*
 * Release 3 (SP33, D76): a lesson document is published or withdrawn by
 * the course's editors only (editors, partner admins, ADMINs). Before,
 * a facilitator of any organisation could withdraw a document every
 * organisation's learners use. Each change is audited.
 */
describe("setLessonDocumentPublished", () => {
  const withDocument = () => {
    db.lessons = [row("context", { documents: [{ id: "doc-1", url: "https://blob.example/a.pdf", published: true }] })];
  };
  const published = () => db.lessons[0].documents[0].published;

  it.each([["FACILITATOR"], ["LEARNER"]])("refuses a %s: nothing changes, nothing is logged", async (role) => {
    withDocument();
    db.roles = [role];
    expect(await setLessonDocumentPublished("doc-1", false)).toEqual({ ok: false, error: "forbidden" });
    expect(published()).toBe(true);
    expect(db.audit).toEqual([]);
  });

  it.each([["CONTENT_EDITOR"], ["PARTNER_ADMIN"], ["ADMIN"]])("lets a %s withdraw and publish it, each audited", async (role) => {
    withDocument();
    db.roles = [role];
    expect(await setLessonDocumentPublished("doc-1", false)).toEqual({ ok: true });
    expect(published()).toBe(false);
    expect(await setLessonDocumentPublished("doc-1", true)).toEqual({ ok: true });
    expect(published()).toBe(true);
    expect(db.audit.map((a) => [a.action, a.entity, a.entityId])).toEqual([
      ["document.unpublished", "LessonDocument", "doc-1"],
      ["document.published", "LessonDocument", "doc-1"],
    ]);
  });

  it("refuses what no form sends, and logs nothing for a document that isn't there", async () => {
    withDocument();
    expect(await setLessonDocumentPublished("doc-1", "no" as unknown as boolean)).toEqual({
      ok: false,
      error: "bad-input",
    });
    expect(await setLessonDocumentPublished("doc-9", false)).toEqual({ ok: true });
    expect(db.audit).toEqual([]);
  });
});

/*
 * Release 3 (D91, spec 10.3): the server works out what a video is and
 * where it may come from. Release 2 stored the browser's object whole,
 * under the provider the browser named, from any host.
 */
describe("the media actions: our own files and YouTube only", () => {
  it("stores a YouTube link sent as a file as YouTube, with only the fields the player reads", async () => {
    const sent = { provider: "file", src: "https://youtu.be/dQw4w9WgXcQ", title: "Talk", onerror: "x" };
    expect(await saveLessonVideo(SLUG, "context", sent as never)).toEqual({ ok: true });
    expect(db.lessons.find((l) => l.stageKey === "context")?.video).toEqual({
      provider: "youtube",
      src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Talk",
      cues: [],
    });
  });

  it("refuses a video, poster, caption or document on another host, and stores nothing", async () => {
    const refused = { ok: false, error: "host-refused", message: "This link can't be used. Upload the file, or paste a YouTube link." };
    expect(await saveLessonVideo(SLUG, "context", { provider: "file", src: "https://cdn.example.org/v.mp4" })).toEqual(refused);
    expect(
      await saveLessonVideo(SLUG, "context", {
        provider: "file",
        src: `https://${STORE}/v.mp4`,
        captions: [{ src: "https://cdn.example.org/a.vtt", label: "English", lang: "en" }],
      })
    ).toEqual(refused);
    expect(await addLessonDocument(SLUG, "context", { ...DOC, url: "https://cdn.example.org/a.pdf" })).toEqual(refused);
    expect(await addLessonDocument(SLUG, "context", { ...DOC, url: "//cdn.example.org/a.pdf" })).toEqual(refused);
    expect(db.lessons).toEqual([]);
  });

  it("accepts our own store's files and the bundled samples", async () => {
    expect(await saveLessonVideo(SLUG, "context", { provider: "file", src: "/demo/sample-lesson.webm" })).toEqual({ ok: true });
    expect(await addLessonDocument(SLUG, "context", DOC)).toEqual({ ok: true, id: "doc-1" });
  });

  it("on production, refuses every Blob file while the store's address isn't set", async () => {
    vi.stubEnv("BLOB_PUBLIC_HOST", "");
    vi.stubEnv("VERCEL_ENV", "production");
    const unconfigured = {
      ok: false,
      error: "host-unconfigured",
      message: "Uploads can't be attached until the site's storage address is set. Tell SENIC.",
    };
    expect(await saveLessonVideo(SLUG, "context", { provider: "file", src: `https://${STORE}/v.mp4` })).toEqual(unconfigured);
    expect(await addLessonDocument(SLUG, "context", DOC)).toEqual(unconfigured);
    expect(db.lessons).toEqual([]);
  });
});

/*
 * Release 3 (D92, spec 10.4): a file whose record goes is queued in the
 * editor's own transaction, for the admin run to delete a week later;
 * the action itself deletes nothing. Release 2 kept every file for good,
 * with nothing to say which were no longer used.
 */
describe("the media actions queue the files they drop", () => {
  const file = (name: string) => `https://${STORE}/${name}`;
  const FILE_VIDEO = {
    provider: "file" as const,
    src: file("v.mp4"),
    poster: file("p.jpg"),
    captions: [{ src: file("en.vtt"), label: "English", lang: "en" }],
    cues: [],
  };
  const queued = () => db.pending.map((p) => [p.url, p.reason]);

  it("removing a document queues its file, in the same transaction, and audits it", async () => {
    db.lessons = [row("context", { documents: [{ id: "doc-1", url: file("a.pdf") }, { id: "doc-2", url: "/demo/sample.pdf" }] })];
    expect(await removeLessonDocument("doc-1")).toEqual({ ok: true });
    expect(await removeLessonDocument("doc-2")).toEqual({ ok: true });
    expect(db.lessons[0].documents).toEqual([]);
    // The bundled sample isn't ours to delete.
    expect(queued()).toEqual([[file("a.pdf"), "document.removed"]]);
    expect(db.queuedOutside).toEqual([]);
    expect(db.audit.map((a) => [a.action, a.entity, a.entityId])).toEqual([
      ["document.removed", "LessonDocument", "doc-1"],
      ["document.removed", "LessonDocument", "doc-2"],
    ]);
    // A document already gone: nothing more.
    expect(await removeLessonDocument("doc-1")).toEqual({ ok: true });
    expect(db.audit).toHaveLength(2);
  });

  it("removing a video queues its source, poster and captions", async () => {
    db.lessons = [row("context", { video: FILE_VIDEO })];
    expect(await clearLessonVideo(SLUG, "context")).toEqual({ ok: true });
    expect(db.lessons[0].video).toBeNull();
    expect(queued()).toEqual([
      [file("v.mp4"), "video.cleared"],
      [file("p.jpg"), "video.cleared"],
      [file("en.vtt"), "video.cleared"],
    ]);
    expect(db.queuedOutside).toEqual([]);
  });

  it("replacing a video queues the files the new one no longer uses", async () => {
    db.lessons = [row("context", { video: FILE_VIDEO })];
    expect(await saveLessonVideo(SLUG, "context", { ...FILE_VIDEO, src: file("v2.mp4") })).toEqual({ ok: true });
    expect(queued()).toEqual([[file("v.mp4"), "video.replaced"]]);
    expect(db.queuedOutside).toEqual([]);
    // A first video replaces nothing.
    db.pending = [];
    expect(await saveLessonVideo(SLUG, "concept", VIDEO)).toEqual({ ok: true });
    expect(db.pending).toEqual([]);
  });

  it("adding a document is audited", async () => {
    expect(await addLessonDocument(SLUG, "context", DOC)).toEqual({ ok: true, id: "doc-1" });
    expect(db.audit).toEqual([
      expect.objectContaining({
        action: "document.added",
        entity: "LessonDocument",
        entityId: "doc-1",
        metadata: { courseSlug: SLUG, stageKey: "context" },
      }),
    ]);
  });
});
