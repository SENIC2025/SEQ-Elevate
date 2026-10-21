import { describe, it, expect, vi } from "vitest";
import {
  hostProblemMessage,
  isFirstPartyMediaUrl,
  isOwnStoreUrl,
  isStorableMediaUrl,
  markExternalMedia,
  previewMediaIsOurs,
  mediaHostProblem,
  mediaUrlProblem,
  serverAppOrigin,
  storableVideo,
  unstorableVideoMessage,
} from "./media-url";
import type { VideoContent } from "@/lib/cms/types";

const STORED =
  "https://abc123.public.blob.vercel-storage.com/lesson-x1Y2z3.mp4";
const STORED_VTT =
  "https://abc123.public.blob.vercel-storage.com/lesson.en-x1Y2z3.vtt";
const LOCAL = "blob:https://seq-elevate.eu/6f1c2a4e-9b1d-4c1e-8f3a";

describe("mediaUrlProblem", () => {
  it("accepts http and https links", () => {
    expect(mediaUrlProblem(STORED)).toBeNull();
    expect(mediaUrlProblem("http://media.example.org/talk.webm")).toBeNull();
    expect(mediaUrlProblem("HTTPS://Example.org/Captions.VTT")).toBeNull();
  });

  it("calls a blob: URL local — it only exists in the author's browser", () => {
    expect(mediaUrlProblem(LOCAL)).toBe("local");
    expect(mediaUrlProblem("BLOB:https://seq-elevate.eu/abc")).toBe("local");
  });

  it.each([
    ["data:", "data:text/vtt;base64,V0VCVlRUCg=="],
    ["javascript:", "javascript:alert(1)"],
    ["a relative path", "/media/sample-lesson.en.vtt"],
    ["a protocol-relative link", "//cdn.example.org/a.vtt"],
    ["ftp:", "ftp://files.example.org/a.mp4"],
    ["an empty string", ""],
    ["an unfinished link", "https://"],
    ["plain text", "not a link"],
  ])("refuses %s as not a web link", (_label, url) => {
    expect(mediaUrlProblem(url)).toBe("not-web");
  });

  it("refuses anything that isn't a string", () => {
    expect(mediaUrlProblem(undefined)).toBe("not-web");
    expect(mediaUrlProblem(null)).toBe("not-web");
    expect(mediaUrlProblem([STORED])).toBe("not-web");
    expect(mediaUrlProblem({ href: STORED })).toBe("not-web");
  });
});

describe("isStorableMediaUrl", () => {
  it("is true only for web links", () => {
    expect(isStorableMediaUrl(STORED_VTT)).toBe(true);
    expect(isStorableMediaUrl(LOCAL)).toBe(false);
    expect(isStorableMediaUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("unstorableVideoMessage", () => {
  const video = (patch: Partial<VideoContent> = {}): VideoContent => ({
    provider: "file",
    src: STORED,
    captions: [{ src: STORED_VTT, label: "English", lang: "en", default: true }],
    ...patch,
  });
  const track = (src: string) => [{ src, label: "English", lang: "en" }];

  it("checks a poster like the video itself, and allows none", () => {
    expect(unstorableVideoMessage(video({ poster: "" }))).toBeNull();
    expect(unstorableVideoMessage(video({ poster: STORED }))).toBeNull();
    expect(unstorableVideoMessage(video({ poster: "javascript:alert(1)" }))).toMatch(
      /^This video link/
    );
    expect(unstorableVideoMessage(video({ poster: LOCAL }))).toMatch(
      /only on your computer/
    );
  });

  it("lets a stored video with stored captions through", () => {
    expect(unstorableVideoMessage(video())).toBeNull();
    expect(unstorableVideoMessage(video({ captions: undefined }))).toBeNull();
    expect(unstorableVideoMessage(video({ captions: [] }))).toBeNull();
  });

  it("asks to save the upload first when the video is still local", () => {
    expect(unstorableVideoMessage(video({ src: LOCAL }))).toBe(
      "Save the upload first — this video is only on your computer."
    );
  });

  it("asks to save the upload first when the captions are still local", () => {
    expect(unstorableVideoMessage(video({ captions: track(LOCAL) }))).toBe(
      "Save the upload first — this caption file is only on your computer."
    );
  });

  it("checks every caption track, not just the first", () => {
    const captions = [...track(STORED_VTT), ...track(LOCAL)];
    expect(unstorableVideoMessage(video({ captions }))).toMatch(
      /caption file is only on your computer/
    );
  });

  it("names the part that isn't a web link", () => {
    expect(
      unstorableVideoMessage(video({ src: "javascript:alert(1)" }))
    ).toMatch(/^This video link can't be used/);
    expect(
      unstorableVideoMessage(video({ captions: track("data:text/vtt,x") }))
    ).toMatch(/^This caption link can't be used/);
  });

  it("reports the video before its captions", () => {
    expect(
      unstorableVideoMessage(video({ src: LOCAL, captions: track(LOCAL) }))
    ).toMatch(/this video is only on your computer/);
  });

  it("accepts YouTube links and bare ids for a YouTube source", () => {
    for (const src of [
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "dQw4w9WgXcQ",
    ]) {
      expect(
        unstorableVideoMessage(video({ provider: "youtube", src }))
      ).toBeNull();
    }
    // A bare id is only a source for the YouTube player.
    expect(unstorableVideoMessage(video({ src: "dQw4w9WgXcQ" }))).toMatch(
      /^This video link can't be used/
    );
    expect(
      unstorableVideoMessage(
        video({ provider: "youtube", src: "javascript:alert(1)" })
      )
    ).toMatch(/^This video link can't be used/);
  });

  it("refuses a non-web link even when it reads as a YouTube link", () => {
    // parseYouTubeId finds an id in these, but only https/http may be saved.
    for (const src of [
      "javascript://youtube.com/watch?v=dQw4w9WgXcQ&x=%0Aalert(1)",
      "javascript://youtu.be/dQw4w9WgXcQ/%0Aalert(1)",
      "ftp://www.youtube.com/embed/dQw4w9WgXcQ",
    ]) {
      expect(
        unstorableVideoMessage(video({ provider: "youtube", src }))
      ).toMatch(/^This video link can't be used/);
    }
  });

  it("refuses a missing video from a crafted request", () => {
    expect(
      unstorableVideoMessage(null as unknown as VideoContent)
    ).toMatch(/^This video link can't be used/);
  });

  it("refuses malformed caption lists from a crafted request", () => {
    const bad = (captions: unknown) =>
      unstorableVideoMessage(
        video({ captions: captions as VideoContent["captions"] })
      );
    expect(bad({ src: STORED_VTT })).toMatch(/^This caption link/);
    expect(bad([null])).toMatch(/^This caption link/);
    expect(bad([{ label: "English" }])).toMatch(/^This caption link/);
  });
});

/*
 * Release 3 (D91, spec 10.3): a lesson's media come from our own store
 * only. Release 2 stored any web link the browser sent, under whatever
 * provider it named, so a learner's page loaded files from any host.
 */
describe("mediaHostProblem: our own files only", () => {
  const APP = "https://seq-elevate.eu";
  const HOST = "abc123.public.blob.vercel-storage.com";
  const SET = { BLOB_PUBLIC_HOST: HOST };

  it("accepts the bundled samples on our own origin and our own store's exact host", () => {
    expect(mediaHostProblem("/demo/sample-lesson.webm", APP, SET)).toBeNull();
    expect(mediaHostProblem("https://seq-elevate.eu/demo/sample-lesson.en.vtt", APP, SET)).toBeNull();
    expect(mediaHostProblem(`https://${HOST}/lesson-x1Y2z3.mp4`, APP, SET)).toBeNull();
    expect(mediaHostProblem(`https://${HOST.toUpperCase()}/a.pdf`, APP, { BLOB_PUBLIC_HOST: ` ${HOST} ` })).toBeNull();
    expect(isFirstPartyMediaUrl("/demo/sample.pdf", APP, SET)).toBe(true);
  });

  it.each([
    ["another host", "https://cdn.example.org/v.mp4"],
    ["a protocol-relative link", "//other.host/v.mp4"],
    ["a backslash", "/\\other.host/v.mp4"],
    ["encoded slashes", "%2F%2Fother.host/v.mp4"],
    ["our own pages outside /demo/", "/api/me/export"],
    ["a way out of /demo/", "/demo/../api/x"],
    ["an encoded way out of /demo/", "/demo/%2e%2e/api/x"],
    ["a look-alike host", `https://${HOST}.evil.example/v.mp4`],
    ["another store", "https://zzz999.public.blob.vercel-storage.com/v.mp4"],
    ["our store over http", `http://${HOST}/v.mp4`],
    ["our store on another port", `https://${HOST}:8443/v.mp4`],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:video/mp4;base64,AAAA"],
    ["an empty string", " "],
    ["no string", 42],
  ])("refuses %s", (_label, url) => {
    expect(mediaHostProblem(url, APP, SET)).toBe("host-refused");
  });

  it("without BLOB_PUBLIC_HOST: any Vercel Blob store outside production, said once; none on production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(mediaHostProblem(`https://${HOST}/v.mp4`, APP, {})).toBeNull();
    expect(mediaHostProblem("https://zzz999.public.blob.vercel-storage.com/v.mp4", APP, { VERCEL_ENV: "preview" })).toBeNull();
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    expect(mediaHostProblem(`https://${HOST}/v.mp4`, APP, { VERCEL_ENV: "production" })).toBe("host-unconfigured");
    expect(mediaHostProblem("https://cdn.example.org/v.mp4", APP, { VERCEL_ENV: "production" })).toBe("host-refused");
    // The samples don't need the store.
    expect(mediaHostProblem("/demo/sample-lesson.webm", APP, { VERCEL_ENV: "production" })).toBeNull();
    warn.mockRestore();
  });

  it("knows our own store apart from the samples (what the admin run may delete)", () => {
    expect(isOwnStoreUrl(`https://${HOST}/a.pdf`, SET)).toBe(true);
    expect(isOwnStoreUrl("/demo/sample.pdf", SET)).toBe(false);
    expect(isOwnStoreUrl("https://cdn.example.org/a.pdf", SET)).toBe(false);
    expect(isOwnStoreUrl(`https://${HOST}/a.pdf`, { VERCEL_ENV: "production" })).toBe(false);
  });

  it("takes the server's origin from AUTH_URL, and without it one no address has", () => {
    expect(serverAppOrigin({ AUTH_URL: "https://seq-elevate.eu/api/auth" })).toBe("https://seq-elevate.eu");
    expect(serverAppOrigin({})).toBe("https://app.invalid");
    expect(serverAppOrigin({ AUTH_URL: "not a url" })).toBe("https://app.invalid");
    expect(mediaHostProblem("/demo/x.webm", serverAppOrigin({}), SET)).toBeNull();
  });

  it("says what to do, in the editor's English", () => {
    expect(hostProblemMessage("host-refused")).toBe(
      "This link can't be used. Upload the file, or paste a YouTube link."
    );
    expect(hostProblemMessage("host-unconfigured")).toBe(
      "Uploads can't be attached until the site's storage address is set. Tell SENIC."
    );
  });
});

describe("storableVideo: worked out on the server", () => {
  const APP = "https://seq-elevate.eu";
  const SET = { BLOB_PUBLIC_HOST: "abc123.public.blob.vercel-storage.com" };
  const check = (v: unknown, env: Record<string, string> = SET) => storableVideo(v, APP, env);

  it("stores a YouTube link as YouTube, whatever provider the browser named", () => {
    expect(check({ provider: "file", src: "https://youtu.be/dQw4w9WgXcQ", title: "Talk", cues: [] })).toEqual({
      ok: true,
      video: { provider: "youtube", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Talk", cues: [] },
    });
    // No poster or caption files for YouTube: it has its own.
    const yt = check({
      provider: "youtube",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      poster: "https://i.ytimg.com/vi/dQw4w9WgXcQ/0.jpg",
      captions: [{ src: "https://cdn.example.org/a.vtt", label: "English", lang: "en" }],
    });
    expect(yt).toEqual({
      ok: true,
      video: { provider: "youtube", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", cues: [] },
    });
  });

  it("refuses a file, poster or caption track that isn't ours, saying why", () => {
    expect(check({ provider: "file", src: "https://cdn.example.org/v.mp4" })).toEqual({
      ok: false,
      error: "host-refused",
      message: "This link can't be used. Upload the file, or paste a YouTube link.",
    });
    expect(check({ provider: "file", src: STORED, poster: "https://cdn.example.org/p.jpg" })).toMatchObject({
      ok: false,
      error: "host-refused",
    });
    expect(
      check({ provider: "file", src: STORED, captions: [{ src: "//other.host/a.vtt", label: "E", lang: "en" }] })
    ).toMatchObject({ ok: false, error: "host-refused" });
    expect(check({ provider: "file", src: STORED, captions: "nope" })).toMatchObject({ ok: false, error: "host-refused" });
    expect(check({ provider: "file", src: STORED }, { VERCEL_ENV: "production" })).toMatchObject({
      ok: false,
      error: "host-unconfigured",
    });
  });

  it("still says a file only in the author's browser must be saved first", () => {
    expect(check({ provider: "file", src: LOCAL })).toEqual({
      ok: false,
      error: "unstorable-media",
      message: "Save the upload first — this video is only on your computer.",
    });
    expect(check({ provider: "file", src: STORED, captions: [{ src: LOCAL, label: "E", lang: "en" }] })).toMatchObject({
      error: "unstorable-media",
    });
    expect(check(null)).toMatchObject({ ok: false, error: "unstorable-media" });
  });

  it("keeps only the fields the player reads", () => {
    const res = check({
      provider: "file",
      src: ` ${STORED} `,
      poster: "/demo/poster.png",
      title: "Talk",
      caption: "",
      captions: [{ src: STORED_VTT, label: "English", lang: "en", default: true, onload: "x" }],
      cues: [
        { id: "c1", atSeconds: 5, question: "Q?", options: [{ id: "a", text: "A", x: 1 }], correctOptionId: "a", explanation: "E", extra: 1 },
        { id: "c2", atSeconds: "soon", question: "Q?", options: [], correctOptionId: "a" },
      ],
      script: "<script>",
    });
    expect(res).toEqual({
      ok: true,
      video: {
        provider: "file",
        src: STORED,
        poster: "/demo/poster.png",
        title: "Talk",
        captions: [{ src: STORED_VTT, label: "English", lang: "en", default: true }],
        cues: [{ id: "c1", atSeconds: 5, question: "Q?", options: [{ id: "a", text: "A" }], correctOptionId: "a", explanation: "E" }],
      },
    });
  });
});

describe("markExternalMedia: rows stored before Release 3", () => {
  const ours = (url: string) => url.startsWith("/demo/") || url.startsWith("https://abc123.");
  const doc = (url: string) => ({ id: url, name: "d", url, mimeType: "application/pdf", sizeBytes: 1, published: true });

  it("marks another host's video and documents, never ours or YouTube", () => {
    const course = {
      title: "T",
      lessons: [
        {
          kind: "stage" as const,
          stage: {
            video: { provider: "file" as const, src: "https://cdn.example.org/v.mp4" },
            documents: [doc("/demo/a.pdf"), doc("https://cdn.example.org/b.pdf")],
          },
        },
        {
          kind: "section" as const,
          section: { video: { provider: "youtube" as const, src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } },
        },
        {
          kind: "section" as const,
          section: {
            video: { provider: "file" as const, src: "/demo/v.webm", captions: [{ src: "https://cdn.example.org/a.vtt", label: "E", lang: "en" }] },
          },
        },
      ],
    };
    const marked = markExternalMedia(course, ours);
    expect(marked.lessons[0]).toMatchObject({
      stage: {
        video: { external: true },
        documents: [{ url: "/demo/a.pdf" }, { url: "https://cdn.example.org/b.pdf", external: true }],
      },
    });
    expect((marked.lessons[0] as { stage: { documents: object[] } }).stage.documents[0]).not.toHaveProperty("external");
    expect(marked.lessons[1]).toEqual(course.lessons[1]);
    expect(marked.lessons[2]).toMatchObject({ section: { video: { external: true } } });
    // The input is left as it was.
    expect(course.lessons[0].stage?.video).not.toHaveProperty("external");
  });
});

describe("previewMediaIsOurs: the editor's preview in the browser", () => {
  it("plays our samples and any Blob store, and shows any other link as a link out", () => {
    const APP = "http://localhost:3000";
    expect(previewMediaIsOurs("/demo/sample-lesson.webm", APP)).toBe(true);
    expect(previewMediaIsOurs("https://abc123.public.blob.vercel-storage.com/v.mp4", APP)).toBe(true);
    expect(previewMediaIsOurs("https://cdn.example.org/v.mp4", APP)).toBe(false);
    expect(previewMediaIsOurs("//cdn.example.org/v.mp4", APP)).toBe(false);
    expect(previewMediaIsOurs("http://localhost:3000/api/x", APP)).toBe(false);
  });
});
