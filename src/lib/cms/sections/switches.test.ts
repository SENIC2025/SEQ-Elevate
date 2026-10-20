import { describe, it, expect } from "vitest";
import { learnerPlayerOff, publishGuardOn } from "./switches";

// The kill switches (spec 3.4): off by default, on only for the exact word.

describe("learnerPlayerOff", () => {
  it("is off by default and for anything but 'off'", () => {
    expect(learnerPlayerOff({})).toBe(false);
    expect(learnerPlayerOff({ R2_LEARNER_PLAYER: "" })).toBe(false);
    expect(learnerPlayerOff({ R2_LEARNER_PLAYER: "on" })).toBe(false);
    expect(learnerPlayerOff({ R2_LEARNER_PLAYER: "false" })).toBe(false);
  });

  it("switches the Release 2 player off with 'off'", () => {
    expect(learnerPlayerOff({ R2_LEARNER_PLAYER: "off" })).toBe(true);
    expect(learnerPlayerOff({ R2_LEARNER_PLAYER: " OFF " })).toBe(true);
  });
});

describe("publishGuardOn", () => {
  it("is off by default", () => {
    expect(publishGuardOn({})).toBe(false);
    expect(publishGuardOn({ R2_PUBLISH_GUARD: "off" })).toBe(false);
  });

  it("is on with 'on', and whenever the player is switched off", () => {
    expect(publishGuardOn({ R2_PUBLISH_GUARD: "on" })).toBe(true);
    expect(publishGuardOn({ R2_LEARNER_PLAYER: "off" })).toBe(true);
  });
});
