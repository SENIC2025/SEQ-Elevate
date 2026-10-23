import { describe, it, expect } from "vitest";
import { afterCardSave, cardAfterReread, cardChanges, guestCardOrBadgesChanged, savedCardOf } from "./card-save";
import type { CompCardData } from "./demo-state";

const blank: CompCardData = {
  wentWell: "",
  difficult: "",
  improve: "",
  behaviour: "",
  confidence: 3,
  sharing: "onlyMe",
  sharedAt: null,
  organisationName: null,
  updatedAt: null,
};

/** The guest's card, as "Add it to my account" put it in the account. */
const moved: CompCardData = {
  ...blank,
  wentWell: "Guest: I listened",
  difficult: "Guest: waiting my turn",
  confidence: 4,
  updatedAt: "2026-11-21T09:00:00.000Z",
};

describe("savedCardOf: what the server holds of the card", () => {
  it("is the card's texts and confidence, never who sees it", () => {
    expect(savedCardOf({ ...moved, sharing: "facilitators" } as CompCardData, blank)).toEqual({
      wentWell: moved.wentWell,
      difficult: moved.difficult,
      improve: "",
      behaviour: "",
      confidence: 4,
    });
  });

  it("is a blank card's when the account has none (a save makes one with the others blank)", () => {
    expect(savedCardOf(null, blank)).toEqual({ wentWell: "", difficult: "", improve: "", behaviour: "", confidence: 3 });
  });
});

describe("cardChanges: a save sends only what was changed here (N1)", () => {
  it("a card as it loaded sends nothing: it isn't saved back", () => {
    expect(cardChanges(moved, savedCardOf(moved, blank))).toEqual({});
    expect(cardChanges({ ...blank, updatedAt: "2026-11-21T09:00:00.000Z" }, savedCardOf(null, blank))).toEqual({});
  });

  it("a page that loaded the card blank, before the guest's card moved, sends only the field it changed", () => {
    // Loaded blank (no card); the learner writes one answer there.
    const here = { ...blank, improve: "Mine", updatedAt: "2026-11-21T10:00:00.000Z" };
    expect(cardChanges(here, savedCardOf(null, blank))).toEqual({ improve: "Mine" });
  });

  it("sends a field changed back to blank, and the confidence when it changed", () => {
    expect(cardChanges({ ...moved, wentWell: "", confidence: 2 }, savedCardOf(moved, blank))).toEqual({ wentWell: "", confidence: 2 });
  });

  it("never who sees it, nor a text over 2,000 characters", () => {
    const sent = cardChanges({ ...moved, sharing: "facilitators", improve: "x".repeat(2001), behaviour: "b" }, savedCardOf(moved, blank));
    expect(sent).toEqual({ behaviour: "b" });
  });

  it("a field not known on the server (its save wasn't confirmed) is sent", () => {
    const saved = savedCardOf(moved, blank);
    delete saved.wentWell;
    expect(cardChanges(moved, saved)).toEqual({ wentWell: moved.wentWell });
  });
});

describe("afterCardSave: what the server is known to hold once a save is answered", () => {
  const saved = savedCardOf(null, blank);
  it("confirmed: the fields sent", () => {
    expect(afterCardSave(saved, { improve: "Mine", confidence: 5 }, "ok")).toEqual({ ...saved, improve: "Mine", confidence: 5 });
  });

  it("refused: as before", () => {
    expect(afterCardSave(saved, { improve: "Mine" }, "refused")).toEqual(saved);
  });

  it("failed (it may have been written): the fields sent aren't known any more, and go with the next save", () => {
    const after = afterCardSave(saved, { improve: "Mine" }, "failed");
    expect(after).not.toHaveProperty("improve");
    expect(cardChanges({ ...blank, improve: "", updatedAt: "2026-11-21T10:00:00.000Z" }, after)).toEqual({ improve: "" });
  });
});

describe("cardAfterReread: the account's card read again in a tab that loaded it before", () => {
  it("shows what the account holds now when nothing was changed here", () => {
    const shown = cardAfterReread(blank, savedCardOf(null, blank), moved, blank);
    expect(shown).toEqual({ ...moved, sharing: "onlyMe", sharedAt: null, organisationName: null });
    // Nothing to save: it is what the server holds.
    expect(cardChanges(shown, savedCardOf(moved, blank))).toEqual({});
  });

  it("keeps a field changed here and not yet saved, and takes the others from the account", () => {
    const here = { ...blank, improve: "Mine", updatedAt: "2026-11-21T10:00:00.000Z" };
    const shown = cardAfterReread(here, savedCardOf(null, blank), moved, blank);
    expect(shown).toMatchObject({ wentWell: moved.wentWell, difficult: moved.difficult, improve: "Mine", confidence: 4, updatedAt: here.updatedAt });
    expect(cardChanges(shown, savedCardOf(moved, blank))).toEqual({ improve: "Mine" });
  });

  it("who sees it is the account's", () => {
    const shared = { ...moved, sharing: "facilitators" as const, sharedAt: "2026-11-21T11:00:00.000Z", organisationName: "Org" };
    expect(cardAfterReread(moved, savedCardOf(moved, blank), shared, blank)).toMatchObject({
      sharing: "facilitators",
      sharedAt: shared.sharedAt,
      organisationName: "Org",
    });
  });

  it("no card in the account: a blank one, with what was changed here", () => {
    const here = { ...blank, behaviour: "Mine", updatedAt: "2026-11-21T10:00:00.000Z" };
    expect(cardAfterReread(here, savedCardOf(null, blank), null, blank)).toMatchObject({ wentWell: "", behaviour: "Mine" });
  });
});

describe("guestCardOrBadgesChanged: when a signed-in tab reads the account's card again", () => {
  const store = (extra: Record<string, unknown>) => JSON.stringify({ projectId: "seq-elevate", badges: [], compCard: moved, ...extra });
  it("the guest store removed, or its card or badges changed", () => {
    expect(guestCardOrBadgesChanged(store({}), null)).toBe(true);
    expect(guestCardOrBadgesChanged(store({}), store({ compCard: blank }))).toBe(true);
    expect(guestCardOrBadgesChanged(store({}), store({ badges: ["b"] }))).toBe(true);
    expect(guestCardOrBadgesChanged(store({}), "{not json")).toBe(true);
  });

  it("not for a course step saved by a guest's page", () => {
    expect(guestCardOrBadgesChanged(store({}), store({ course: { courseSlug: "c" } }))).toBe(false);
    expect(guestCardOrBadgesChanged(null, null)).toBe(false);
  });
});
