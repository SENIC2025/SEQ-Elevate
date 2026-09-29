import { describe, it, expect } from "vitest";
import {
  isStorableMediaUrl,
  mediaUrlProblem,
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
