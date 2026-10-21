import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";

vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: ({ href, ...rest }: { href: string }) => h("a", { href: `/en${href}`, ...rest }),
  };
});

import {
  ExternalVideo,
  InteractiveVideoPlayer,
  NARROW_PLAYER_PX,
  VideoStatus,
  YouTubeGate,
  followNativeVideo,
  gateFits,
  gateStateFor,
  youTubePlayerOptions,
} from "./InteractiveVideoPlayer";
import { elements, renderIn, textOf } from "./sectioned/render.test-helpers";
import type { VideoContent } from "@/lib/cms/types";

/**
 * Found by the final verification's load run (the recorded walk's video
 * lesson): a lesson video the page arrives with starts loading before the
 * page's scripts run. When its length was known before the player listened
 * — "loadedmetadata" already past — the player never learned it, so the
 * questions' place on the timeline and "This video pauses to ask you a
 * quick question." never showed. e2e: r2-player.spec.ts, "a lesson video
 * that has its length before the page's scripts run…".
 */

/** A <video> as the engine sees it, with its events fired by hand. */
function fakeVideo(state: { readyState: number; duration: number }) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    currentTime: 0,
    ...state,
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn);
    }),
    fire(type: string) {
      for (const fn of listeners.get(type) ?? []) fn();
    },
    listening: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

describe("followNativeVideo", () => {
  it("reads the length at once when the video already has it (loaded before the player listened)", () => {
    const video = fakeVideo({ readyState: 4, duration: 12 });
    const onDuration = vi.fn();
    followNativeVideo(video as unknown as HTMLVideoElement, () => {}, onDuration);
    expect(onDuration).toHaveBeenCalledWith(12);
  });

  it("waits for the length when the video doesn't have it yet", () => {
    const video = fakeVideo({ readyState: 0, duration: NaN });
    const onDuration = vi.fn();
    followNativeVideo(video as unknown as HTMLVideoElement, () => {}, onDuration);
    expect(onDuration).not.toHaveBeenCalled();
    video.duration = 9;
    video.fire("loadedmetadata");
    expect(onDuration).toHaveBeenCalledWith(9);
  });

  it("reports the time as it plays and when it is moved, and stops listening when told", () => {
    const video = fakeVideo({ readyState: 0, duration: NaN });
    const onTime = vi.fn();
    const stop = followNativeVideo(video as unknown as HTMLVideoElement, onTime, () => {});
    video.currentTime = 3;
    video.fire("timeupdate");
    video.currentTime = 6;
    video.fire("seeked");
    expect(onTime.mock.calls).toEqual([[3], [6]]);
    stop();
    expect(video.listening()).toBe(0);
  });
});

/*
 * Release 3 (D91, spec 10.2, UE2): nothing from YouTube loads until the
 * viewer asks. Release 2 mounted YouTube's player script and frame as the
 * lesson rendered, from www.youtube.com, with no click.
 */
const YT: VideoContent = {
  provider: "youtube",
  src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "A talk",
  cues: [{ id: "c1", atSeconds: 5, question: "Q?", options: [{ id: "a", text: "A" }], correctOptionId: "a" }],
};

describe("the YouTube gate", () => {
  it("renders no frame, script or thumbnail before the press: the gate, the privacy notice and the watch link", () => {
    const html = renderIn(createElement(InteractiveVideoPlayer, { video: YT }));
    expect(html).not.toMatch(/<iframe|<script|ytimg|youtube-nocookie|iframe_api/);
    const text = textOf(html);
    expect(text).toContain(
      "This video is on YouTube. When you play it, YouTube (Google) receives your IP address and browser details and may set cookies."
    );
    expect(text).toContain("Play video (loads YouTube)");
    expect(html).toContain('href="/en/legal/privacy"');
    expect(html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
    expect(html).toContain('target="_blank"');
    // The status line focus will move to is there from the start, empty.
    const status = elements(html, "p").find((p) => p.attrs.includes('role="status"'));
    expect(status).toMatchObject({ inner: "" });
    expect(status?.attrs).toContain('tabindex="-1"');
  });

  it("puts the gate below the 16:9 box until the player is measured wide enough, never inside it", () => {
    const html = renderIn(createElement(InteractiveVideoPlayer, { video: YT }), "de");
    const box = html.indexOf("aspect-video");
    const gate = html.indexOf('data-testid="youtube-gate"');
    const boxEnd = html.indexOf("</div></div>", box);
    expect(gate).toBeGreaterThan(boxEnd);
    expect(textOf(html)).toContain("Video abspielen (lädt YouTube)");
  });

  it("fits inside the box only at 480 px or more, with the default text size", () => {
    expect(gateFits(null, null)).toBe(false);
    expect(gateFits(NARROW_PLAYER_PX - 1, null)).toBe(false);
    expect(gateFits(320, "xl")).toBe(false);
    expect(gateFits(800, "lg")).toBe(false);
    expect(gateFits(800, "xl")).toBe(false);
    expect(gateFits(NARROW_PLAYER_PX, null)).toBe(true);
    expect(gateFits(800, "normal")).toBe(true);
  });

  it("renders the gate's own text and buttons wherever it is placed", () => {
    for (const inside of [true, false]) {
      const html = renderIn(createElement(YouTubeGate, { videoId: "dQw4w9WgXcQ", onPlay: () => {}, inside }), "el");
      expect(textOf(html)).toContain("Αναπαραγωγή βίντεο (φορτώνει το YouTube)");
      expect(html).toContain("<button");
      expect(html).toContain("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }
  });

  it("loads the player from youtube-nocookie.com, starting at once, after the press", () => {
    const onReady = () => {};
    expect(youTubePlayerOptions("dQw4w9WgXcQ", { onReady })).toEqual({
      host: "https://www.youtube-nocookie.com",
      videoId: "dQw4w9WgXcQ",
      playerVars: { rel: 0, playsinline: 1, autoplay: 1 },
      events: { onReady },
    });
  });

  it("asks again for another video: a press plays only the video it was for", () => {
    // The editor's live preview keeps one player while its link changes.
    const pressed = { videoId: "dQw4w9WgXcQ", state: "loading" as const };
    expect(gateStateFor(pressed, "dQw4w9WgXcQ")).toBe("loading");
    expect(gateStateFor({ ...pressed, state: "failed" }, "dQw4w9WgXcQ")).toBe("failed");
    expect(gateStateFor(pressed, "e2eVideo002")).toBe("gate");
    expect(gateStateFor({ ...pressed, state: "failed" }, "e2eVideo002")).toBe("gate");
    expect(gateStateFor(pressed, null)).toBe("gate");
    expect(gateStateFor({ videoId: null, state: "gate" }, "dQw4w9WgXcQ")).toBe("gate");
  });

  it("says on the status line that it is loading, or that it can't be played here with the watch link", () => {
    const loading = renderIn(createElement(VideoStatus, { state: "loading", videoId: "dQw4w9WgXcQ" }));
    expect(textOf(loading)).toBe("Loading the video… If it doesn't start, press play.");
    const failed = renderIn(createElement(VideoStatus, { state: "failed", videoId: "dQw4w9WgXcQ" }));
    expect(textOf(failed)).toContain("This video can't be played here.");
    expect(failed).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
    expect(failed).toMatch(/role="status"/);
  });
});

describe("a video on another host (stored before Release 3)", () => {
  it("is a link out: no video element, nothing loaded from that host", () => {
    for (const video of [
      { provider: "file" as const, src: "https://cdn.example.org/v.mp4", external: true },
      // A YouTube row whose link can't be read.
      { provider: "youtube" as const, src: "https://vimeo.com/123" },
    ]) {
      const html = renderIn(createElement(InteractiveVideoPlayer, { video }));
      expect(html).not.toMatch(/<video|<iframe|<track/);
      expect(textOf(html)).toContain("This video is on another website.");
      expect(html).toContain(`href="${video.src}"`);
      expect(textOf(html)).toContain("Open the video (new tab)");
    }
    expect(textOf(renderIn(createElement(ExternalVideo, { src: "https://x/v.mp4", inside: true }), "de"))).toContain(
      "Video öffnen (neuer Tab)"
    );
  });

  it("a YouTube link stored as a file goes behind the gate, never into the native player", () => {
    const html = renderIn(
      createElement(InteractiveVideoPlayer, {
        video: { provider: "file", src: "https://youtu.be/dQw4w9WgXcQ", external: true },
      })
    );
    expect(html).not.toMatch(/<video|<iframe/);
    expect(textOf(html)).toContain("Play video (loads YouTube)");
  });

  it("our own file still plays in the page", () => {
    const html = renderIn(createElement(InteractiveVideoPlayer, { video: { provider: "file", src: "/demo/sample-lesson.webm" } }));
    expect(html).toMatch(/<video[^>]*src="\/demo\/sample-lesson.webm"/);
    expect(html).not.toContain('data-testid="youtube-gate"');
  });
});
