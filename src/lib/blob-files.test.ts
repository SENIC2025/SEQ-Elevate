import { describe, it, expect, vi, afterEach } from "vitest";

/*
 * Release 3 (D92, spec 10.4, UE4): a course file whose record goes is
 * queued, in the editor's own transaction, for the admin run to delete a
 * week later; the editor's action never deletes anything itself. Release 2
 * left every file in the store for good.
 */

const del = vi.fn();
vi.mock("@vercel/blob", () => ({ del }));

const { queueFileDeletion, videoFileUrls } = await import("./blob-files");

const HOST = "store1.public.blob.vercel-storage.com";
const ENV = { BLOB_PUBLIC_HOST: HOST };

function txWith() {
  const rows = new Map<string, { url: string; reason: string; queuedAt?: Date }>();
  const upsert = vi.fn(async ({ where, create, update }) => {
    rows.set(where.url, { ...(rows.get(where.url) ?? create), ...(rows.has(where.url) ? update : {}) });
    return {};
  });
  // Only the queue's table is touched, so the caller's transaction stands in as that.
  return { tx: { pendingFileDeletion: { upsert } } as never, rows, upsert };
}

afterEach(() => vi.clearAllMocks());

describe("queueFileDeletion", () => {
  it("queues only our own store's files, exactly as the record held them, through the caller's transaction", async () => {
    const { tx, rows, upsert } = txWith();
    const ours = `https://${HOST}/Lesson%20One-x1Y2.mp4?download=1`;
    const queued = await queueFileDeletion(
      tx,
      [ours, "/demo/sample-lesson.webm", "https://cdn.example.org/v.mp4", null, 42, ours],
      "video.cleared",
      ENV
    );
    expect(queued).toEqual([ours]);
    expect(upsert).toHaveBeenCalledTimes(1);
    // The same string the record held, never a normalised one: the admin
    // run compares what records use with what is queued.
    expect([...rows.keys()]).toEqual([ours]);
    expect(rows.get(ours)).toMatchObject({ url: ours, reason: "video.cleared" });
    expect(del).not.toHaveBeenCalled();
  });

  it("starts the week again for a file queued before (pasted back, then removed again)", async () => {
    const { tx, upsert } = txWith();
    const url = `https://${HOST}/a.pdf`;
    await queueFileDeletion(tx, [url], "document.removed", ENV);
    const update = upsert.mock.calls[0][0].update;
    expect(update.reason).toBe("document.removed");
    expect(update.queuedAt).toBeInstanceOf(Date);
  });

  it("queues nothing while production doesn't know its store, and nothing for an empty list", async () => {
    const { tx, upsert } = txWith();
    expect(await queueFileDeletion(tx, [`https://${HOST}/a.pdf`], "section.deleted", { VERCEL_ENV: "production" })).toEqual([]);
    expect(await queueFileDeletion(tx, [], "section.deleted", ENV)).toEqual([]);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("videoFileUrls", () => {
  it("lists a stored video's source, poster and caption files as stored", () => {
    expect(
      videoFileUrls({
        provider: "file",
        src: "https://a/v.mp4",
        poster: "https://a/p.jpg",
        captions: [{ src: "https://a/en.vtt" }, { src: 3 }, null],
      })
    ).toEqual(["https://a/v.mp4", "https://a/p.jpg", "https://a/en.vtt"]);
    expect(videoFileUrls(null)).toEqual([]);
    expect(videoFileUrls({ provider: "youtube", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })).toEqual([
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ]);
  });
});
