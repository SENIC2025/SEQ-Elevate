import { describe, it, expect } from "vitest";
import {
  dueCue,
  sortCues,
  formatTimecode,
  parseYouTubeId,
  detectProvider,
} from "./video";
import type { VideoCue } from "@/lib/cms/types";

const cue = (id: string, atSeconds: number): VideoCue => ({
  id,
  atSeconds,
  question: `Q ${id}`,
  options: [
    { id: "a", text: "A" },
    { id: "b", text: "B" },
  ],
  correctOptionId: "a",
});

const CUES = [cue("c1", 8), cue("c2", 20), cue("c3", 35)];

describe("dueCue", () => {
  it("returns null before any cue's time", () => {
    expect(dueCue(CUES, 3, [])).toBeNull();
  });

  it("fires a cue once its time is reached", () => {
    expect(dueCue(CUES, 8, [])?.id).toBe("c1");
    expect(dueCue(CUES, 12, [])?.id).toBe("c1");
  });

  it("does not refire an answered cue", () => {
    expect(dueCue(CUES, 12, ["c1"])).toBeNull();
    expect(dueCue(CUES, 21, ["c1"])?.id).toBe("c2");
  });

  it("asks the EARLIEST unanswered cue when several are passed at once (seek-forward)", () => {
    // Learner jumps to 40s without answering anything — c1 comes first.
    expect(dueCue(CUES, 40, [])?.id).toBe("c1");
    expect(dueCue(CUES, 40, ["c1"])?.id).toBe("c2");
    expect(dueCue(CUES, 40, ["c1", "c2"])?.id).toBe("c3");
    expect(dueCue(CUES, 40, ["c1", "c2", "c3"])).toBeNull();
  });

  it("treats the boundary inclusively", () => {
    expect(dueCue([cue("x", 10)], 10, [])?.id).toBe("x");
    expect(dueCue([cue("x", 10)], 9.9, [])).toBeNull();
  });
});

describe("sortCues", () => {
  it("orders by time without mutating the input", () => {
    const input = [cue("c", 30), cue("a", 5), cue("b", 12)];
    const out = sortCues(input);
    expect(out.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(input.map((c) => c.id)).toEqual(["c", "a", "b"]);
  });
});

describe("formatTimecode", () => {
  it("formats mm:ss with zero-padded seconds", () => {
    expect(formatTimecode(0)).toBe("0:00");
    expect(formatTimecode(8)).toBe("0:08");
    expect(formatTimecode(65)).toBe("1:05");
    expect(formatTimecode(125)).toBe("2:05");
  });
  it("guards bad input", () => {
    expect(formatTimecode(-3)).toBe("0:00");
    expect(formatTimecode(NaN)).toBe("0:00");
  });
});

describe("parseYouTubeId", () => {
  it("reads watch, share, embed, shorts and bare ids", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
    expect(parseYouTubeId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
    expect(parseYouTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("returns null for non-YouTube or malformed urls", () => {
    expect(parseYouTubeId("https://example.com/video.mp4")).toBeNull();
    expect(parseYouTubeId("not a url")).toBeNull();
    expect(parseYouTubeId("https://www.youtube.com/watch?v=tooShort")).toBeNull();
  });
});

describe("detectProvider", () => {
  it("maps YouTube urls to youtube, everything else to file", () => {
    expect(detectProvider("https://youtu.be/dQw4w9WgXcQ")).toBe("youtube");
    expect(detectProvider("https://cdn.example.com/lesson.mp4")).toBe("file");
    expect(detectProvider("/demo/sample-lesson.webm")).toBe("file");
  });
});
