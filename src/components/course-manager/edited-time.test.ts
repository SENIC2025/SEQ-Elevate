import { describe, it, expect } from "vitest";
import { editedAgo, editedAt } from "./edited-time";

const NOW = Date.parse("2026-09-29T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("editedAgo", () => {
  it("says now for the last minute, and for a stamp slightly in the future", () => {
    expect(editedAgo(ago(30_000), "en", NOW)).toBe("now");
    expect(editedAgo(ago(-5_000), "en", NOW)).toBe("now");
  });

  it("picks the largest whole unit, rounding down", () => {
    expect(editedAgo(ago(1 * MIN), "en", NOW)).toBe("1 minute ago");
    expect(editedAgo(ago(59 * MIN + 59_000), "en", NOW)).toBe("59 minutes ago");
    expect(editedAgo(ago(1 * HOUR), "en", NOW)).toBe("1 hour ago");
    expect(editedAgo(ago(23 * HOUR + 59 * MIN), "en", NOW)).toBe("23 hours ago");
    expect(editedAgo(ago(1 * DAY), "en", NOW)).toBe("1 day ago");
    expect(editedAgo(ago(6 * DAY), "en", NOW)).toBe("6 days ago");
    expect(editedAgo(ago(7 * DAY), "en", NOW)).toBe("1 week ago");
    expect(editedAgo(ago(29 * DAY), "en", NOW)).toBe("4 weeks ago");
    expect(editedAgo(ago(30 * DAY), "en", NOW)).toBe("1 month ago");
    expect(editedAgo(ago(364 * DAY), "en", NOW)).toBe("12 months ago");
    expect(editedAgo(ago(365 * DAY), "en", NOW)).toBe("1 year ago");
    expect(editedAgo(ago(800 * DAY), "en", NOW)).toBe("2 years ago");
  });

  it("stays numeric, so it reads after “Edited” in every language", () => {
    expect(editedAgo(ago(1 * DAY), "de", NOW)).toBe("vor 1 Tag");
    expect(editedAgo(ago(40 * DAY), "el", NOW)).toBe("πριν από 1 μήνα");
    expect(editedAgo(ago(0), "el", NOW)).toBe("τώρα");
  });

  it("is null for a stamp that doesn't parse", () => {
    expect(editedAgo("not a date", "en", NOW)).toBeNull();
  });
});

describe("editedAt", () => {
  it("gives the exact time in UTC, labelled", () => {
    // Day/month order is the locale's own business; check the parts.
    const text = editedAt("2026-09-29T11:23:00.000Z", "en");
    expect(text).toMatch(/September/);
    expect(text).toMatch(/\b29\b/);
    expect(text).toMatch(/2026/);
    expect(text).toMatch(/11:23/);
    expect(text).toMatch(/UTC/);
    expect(editedAt("2026-09-29T11:23:00.000Z", "de")).toMatch(
      /29\. September 2026.*11:23.*UTC/
    );
  });

  it("is null for a stamp that doesn't parse", () => {
    expect(editedAt("", "en")).toBeNull();
  });
});
