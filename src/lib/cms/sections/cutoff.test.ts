import { describe, it, expect, vi } from "vitest";
import { DEFAULT_RESTRUCTURE_CLOSED_FROM, restructureClosedFrom } from "./cutoff";

/*
 * The 1 December rule's date (D67, spec 4.7): RESTRUCTURE_CLOSED_FROM, an
 * ISO date or "off"; unset or unreadable means the default, and an
 * unreadable value is logged once. The clock is passed in.
 */

const DEFAULT_MS = Date.parse("2026-12-01T00:00:00+01:00");
const at = (iso: string) => new Date(iso);

describe("restructureClosedFrom", () => {
  it("defaults to 1 December 2026, midnight in Brussels", () => {
    expect(DEFAULT_RESTRUCTURE_CLOSED_FROM).toBe("2026-12-01T00:00:00+01:00");
    const log = vi.fn();
    const before = restructureClosedFrom({}, at("2026-11-30T23:59:59+01:00"), log);
    expect(before).toEqual({ from: new Date(DEFAULT_MS).toISOString(), closed: false });
    expect(restructureClosedFrom({}, at("2026-12-01T00:00:00+01:00"), log).closed).toBe(true);
    expect(restructureClosedFrom({}, at("2027-03-01T12:00:00Z"), log).closed).toBe(true);
    // Unset, empty and blank are all "not set", never a mistake to report.
    expect(restructureClosedFrom({ RESTRUCTURE_CLOSED_FROM: "" }, at("2026-12-02T00:00:00Z"), log).closed).toBe(true);
    expect(restructureClosedFrom({ RESTRUCTURE_CLOSED_FROM: "  " }, at("2026-11-02T00:00:00Z"), log).closed).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("takes an ISO date or date and time from the variable", () => {
    const log = vi.fn();
    const env = { RESTRUCTURE_CLOSED_FROM: "2020-01-01T00:00:00Z" };
    expect(restructureClosedFrom(env, at("2019-12-31T23:59:59Z"), log)).toEqual({
      from: "2020-01-01T00:00:00.000Z",
      closed: false,
    });
    expect(restructureClosedFrom(env, at("2020-01-01T00:00:00Z"), log).closed).toBe(true);
    const dateOnly = restructureClosedFrom({ RESTRUCTURE_CLOSED_FROM: "2026-11-20" }, at("2026-11-20T00:00:00Z"), log);
    expect(dateOnly).toEqual({ from: "2026-11-20T00:00:00.000Z", closed: true });
    const offset = restructureClosedFrom(
      { RESTRUCTURE_CLOSED_FROM: " 2026-11-20T09:30+01:00 " },
      at("2026-11-20T08:29:00Z"),
      log
    );
    expect(offset).toEqual({ from: "2026-11-20T08:30:00.000Z", closed: false });
    expect(log).not.toHaveBeenCalled();
  });

  it("is switched off by \"off\", in any case", () => {
    const log = vi.fn();
    for (const value of ["off", "OFF", " Off "]) {
      expect(restructureClosedFrom({ RESTRUCTURE_CLOSED_FROM: value }, at("2030-01-01T00:00:00Z"), log)).toEqual({
        from: null,
        closed: false,
      });
    }
    expect(log).not.toHaveBeenCalled();
  });

  it("uses the default for a value it can't read, saying so once in the log", () => {
    const log = vi.fn();
    for (const value of ["tomorrow", "1 December", "2026-13-01", "2026-12-01T25:00:00Z", "1764543600000", "on"]) {
      const env = { RESTRUCTURE_CLOSED_FROM: value };
      const r = restructureClosedFrom(env, at("2026-12-01T00:00:00+01:00"), log);
      expect(r, value).toEqual({ from: new Date(DEFAULT_MS).toISOString(), closed: true });
      // Read on every call; logged only the first time for that value.
      restructureClosedFrom(env, at("2026-11-01T00:00:00Z"), log);
    }
    expect(log).toHaveBeenCalledTimes(6);
    // The line names the variable and the default, never the value itself.
    expect(log.mock.calls[0][0]).toMatch(/RESTRUCTURE_CLOSED_FROM/);
    expect(log.mock.calls[0][0]).toMatch(/2026-12-01T00:00:00\+01:00/);
    expect(log.mock.calls.some(([line]) => String(line).includes("tomorrow"))).toBe(false);
  });
});
