import { describe, it, expect, vi } from "vitest";
import { followNativeVideo } from "./InteractiveVideoPlayer";

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
