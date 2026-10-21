import { describe, it, expect, vi } from "vitest";
import { DEFAULT_STATS_FROM, statsFrom } from "./stats-from";

/*
 * Statistics count from STATS_FROM (D83, spec 7.3): an ISO date or "off";
 * unset or unreadable means 1 December 2026, midnight in Brussels, and an
 * unreadable value is logged once, without the value.
 */

describe("statsFrom", () => {
  it("defaults to 1 December 2026, midnight in Brussels", () => {
    expect(DEFAULT_STATS_FROM).toBe("2026-12-01T00:00:00+01:00");
    const log = vi.fn();
    expect(statsFrom({}, log)?.toISOString()).toBe("2026-11-30T23:00:00.000Z");
    expect(statsFrom({ STATS_FROM: "" }, log)?.toISOString()).toBe("2026-11-30T23:00:00.000Z");
    expect(statsFrom({ STATS_FROM: "   " }, log)?.toISOString()).toBe("2026-11-30T23:00:00.000Z");
    expect(log).not.toHaveBeenCalled();
  });

  it("takes an ISO date or date and time from the variable", () => {
    const log = vi.fn();
    expect(statsFrom({ STATS_FROM: "2020-01-01T00:00:00Z" }, log)?.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(statsFrom({ STATS_FROM: "2026-11-20" }, log)?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(statsFrom({ STATS_FROM: " 2026-11-20T09:30+01:00 " }, log)?.toISOString()).toBe(
      "2026-11-20T08:30:00.000Z"
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('is switched off by "off", in any case', () => {
    for (const value of ["off", "OFF", " Off "]) expect(statsFrom({ STATS_FROM: value })).toBeNull();
  });

  it("uses the default for a value it can't read, saying so once in the log", () => {
    const log = vi.fn();
    for (const value of ["tomorrow", "1 December", "2026-13-01", "2026-12-01T25:00:00Z", "1764543600000", "on"]) {
      expect(statsFrom({ STATS_FROM: value }, log)?.toISOString(), value).toBe("2026-11-30T23:00:00.000Z");
      // Read on every call; logged only the first time for that value.
      statsFrom({ STATS_FROM: value }, log);
    }
    expect(log).toHaveBeenCalledTimes(6);
    expect(log.mock.calls[0][0]).toMatch(/STATS_FROM/);
    expect(log.mock.calls[0][0]).toMatch(/2026-12-01T00:00:00\+01:00/);
    expect(log.mock.calls.some(([line]) => String(line).includes("tomorrow"))).toBe(false);
  });

  it("is read on every call, not once", () => {
    const env: Record<string, string | undefined> = {};
    expect(statsFrom(env)?.toISOString()).toBe("2026-11-30T23:00:00.000Z");
    env.STATS_FROM = "off";
    expect(statsFrom(env)).toBeNull();
  });
});
