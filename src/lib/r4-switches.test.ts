import { describe, it, expect, afterEach, vi } from "vitest";
import { furtherReadingOn, itemLanguageOn } from "./r4-switches";

// Release 4's switches (spec 7.1, U15): on by default, and off only for
// their exact word.

describe.each([
  ["R4_FURTHER_READING", furtherReadingOn],
  ["R4_ITEM_LANGUAGE", itemLanguageOn],
] as const)("%s", (variable, on) => {
  afterEach(() => vi.unstubAllEnvs());

  it("is on while unset, blank or anything but 'off'", () => {
    expect(on({})).toBe(true);
    for (const value of [undefined, "", " ", "on", "false", "0", "no", "of", "offf", "disabled"]) {
      expect(on({ [variable]: value }), String(value)).toBe(true);
    }
  });

  it("is off for 'off', in any case and with spaces around it", () => {
    for (const value of ["off", "OFF", " Off ", "\toff\n"]) expect(on({ [variable]: value }), value).toBe(false);
  });

  it("reads the process's environment on every call", () => {
    vi.stubEnv(variable, "off");
    expect(on()).toBe(false);
    vi.stubEnv(variable, "");
    expect(on()).toBe(true);
  });

  it("moves on its own variable only", () => {
    const other = variable === "R4_FURTHER_READING" ? "R4_ITEM_LANGUAGE" : "R4_FURTHER_READING";
    expect(on({ [other]: "off" })).toBe(true);
  });
});
