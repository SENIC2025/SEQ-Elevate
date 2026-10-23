import { describe, it, expect, vi } from "vitest";
import type { CompCardInput, SaveCompCardResult } from "@/app/actions/learner";
import {
  afterCardSave,
  cardAfterReread,
  cardChanges,
  guestCardOrBadgesChanged,
  saveCard,
  savedCardOf,
  type CardSavedRef,
} from "./card-save";
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

describe("saveCard: a save, and another once it is confirmed if the page still differs (V3)", () => {
  const X = { ...moved, wentWell: "X", updatedAt: "2026-11-21T10:00:00.000Z" };
  const Y = { ...X, wentWell: "Y", updatedAt: "2026-11-21T10:00:01.000Z" };
  const backToX = { ...X, updatedAt: "2026-11-21T10:00:02.000Z" };

  /** A page signed in as "u", whose card loaded as X; each save's answer is held until `answer` is called. */
  function page() {
    const saved: CardSavedRef = { current: { forUser: "u", card: savedCardOf(X, blank) } };
    const sent: CompCardInput[] = [];
    const answers: ((result: SaveCompCardResult) => void)[] = [];
    let latest: typeof X | null = X;
    const again = vi.fn();
    const deps = {
      send: (input: CompCardInput) => {
        sent.push(input);
        return new Promise<SaveCompCardResult>((resolve) => answers.push(resolve));
      },
      latest: () => latest,
      again,
    };
    return {
      saved,
      sent,
      again,
      show: (card: typeof X | null) => (latest = card),
      save: (card: typeof X, forUser = "u") => saveCard(card, forUser, saved, deps),
      answer: (n: number, result: SaveCompCardResult) => answers[n](result),
    };
  }

  it("an answer changed back while the save of the change is on its way: once that save is confirmed, another is scheduled", async () => {
    const p = page();
    p.show(Y);
    const first = p.save(Y);
    expect(p.sent).toEqual([{ wentWell: "Y" }]);
    // Changed back while Y is on its way: the server is still known to hold X, so nothing is sent.
    p.show(backToX);
    await p.save(backToX);
    expect(p.sent).toHaveLength(1);
    p.answer(0, { ok: true });
    await first;
    expect(p.saved.current?.card.wentWell).toBe("Y");
    expect(p.again).toHaveBeenCalledTimes(1);
    // The save scheduled then sends X, and nothing is left after it.
    const second = p.save(backToX);
    expect(p.sent[1]).toEqual({ wentWell: "X" });
    p.answer(1, { ok: true });
    await second;
    expect(p.saved.current?.card.wentWell).toBe("X");
    expect(p.again).toHaveBeenCalledTimes(1);
  });

  it("nothing left once a save is confirmed: no other", async () => {
    const p = page();
    p.show(Y);
    const save = p.save(Y);
    p.answer(0, { ok: true });
    await save;
    expect(p.again).not.toHaveBeenCalled();
  });

  it("not after a refusal (the same save would be refused again), nor once the learner's data was let go of or is another's", async () => {
    const refused = page();
    refused.show(backToX);
    const a = refused.save(Y);
    refused.answer(0, { ok: false, error: "other-account" });
    await a;
    expect(refused.saved.current?.card.wentWell).toBe("X");
    expect(refused.again).not.toHaveBeenCalled();

    const letGo = page();
    const b = letGo.save(Y);
    letGo.show(backToX);
    letGo.saved.current = null;
    letGo.answer(0, { ok: true });
    await b;
    expect(letGo.again).not.toHaveBeenCalled();

    const other = page();
    other.saved.current = { forUser: "someone else", card: savedCardOf(X, blank) };
    await other.save(Y);
    expect(other.sent).toEqual([]);
  });

  it("a save that fails is thrown on, to be tried again, and what it sent is no longer known", async () => {
    const saved: CardSavedRef = { current: { forUser: "u", card: savedCardOf(X, blank) } };
    const again = vi.fn();
    const deps = { send: () => Promise.reject(new Error("offline")), latest: () => Y, again };
    await expect(saveCard(Y, "u", saved, deps)).rejects.toThrow("offline");
    expect(saved.current?.card).not.toHaveProperty("wentWell");
    expect(again).not.toHaveBeenCalled();
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
