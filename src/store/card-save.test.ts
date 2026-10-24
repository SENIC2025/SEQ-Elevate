import { afterEach, describe, it, expect, vi } from "vitest";
import type { CompCardInput, SaveCompCardResult } from "@/app/actions/learner";
import {
  afterCardSave,
  cardAfterReread,
  cardBeacon,
  cardChanges,
  guestCardOrBadgesChanged,
  saveCard,
  savedCardOf,
  type CardSavedRef,
  type CardSendingRef,
} from "./card-save";
import type { CompCardData } from "./demo-state";
import { pendingSave } from "./pending-save";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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
    const answers: { resolve: (result: SaveCompCardResult) => void; reject: (err: Error) => void }[] = [];
    let latest: typeof X | null = X;
    const again = vi.fn();
    const deps = {
      send: (input: CompCardInput) => {
        sent.push(input);
        return new Promise<SaveCompCardResult>((resolve, reject) => answers.push({ resolve, reject }));
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
      answer: (n: number, result: SaveCompCardResult) => answers[n].resolve(result),
      /** The save's answer never comes: a dropped connection (the server may have written it). */
      fail: (n: number) => answers[n].reject(new TypeError("Failed to fetch")),
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

  it("a save that fails once the page has changed since it was sent: another is scheduled, as a newer save may have been worked out without what it sent", async () => {
    const p = page();
    p.show(Y);
    const first = p.save(Y);
    // Changed back while Y is on its way: nothing to send then.
    p.show(backToX);
    await p.save(backToX);
    expect(p.sent).toHaveLength(1);
    // Y's answer is lost: the server may hold Y now, and the page shows X.
    p.fail(0);
    await expect(first).rejects.toThrow("Failed to fetch");
    expect(p.saved.current?.card).not.toHaveProperty("wentWell");
    expect(p.again).toHaveBeenCalledTimes(1);
    // The save scheduled then sends what the page shows.
    const second = p.save(backToX);
    expect(p.sent[1]).toEqual({ wentWell: "X" });
    p.answer(1, { ok: true });
    await second;
    expect(p.saved.current?.card.wentWell).toBe("X");
    expect(p.again).toHaveBeenCalledTimes(1);
  });

  it("not when the page is as the failed save sent it (it is tried again itself), nor once the learner's data was let go of", async () => {
    const same = page();
    same.show(Y);
    const a = same.save(Y);
    same.fail(0);
    await expect(a).rejects.toThrow();
    expect(same.again).not.toHaveBeenCalled();

    const letGo = page();
    letGo.show(Y);
    const b = letGo.save(Y);
    letGo.show(backToX);
    letGo.saved.current = null;
    letGo.fail(0);
    await expect(b).rejects.toThrow();
    expect(letGo.again).not.toHaveBeenCalled();
  });
});

describe("saveCard with the page's pending saves (pending-save.ts), as DemoStateProvider wires them: a save whose answer is lost (V3)", () => {
  const X = { ...blank, wentWell: "X", updatedAt: "2026-11-21T10:00:00.000Z" };

  /**
   * A page signed in as "u", whose card loaded as X, and the server. Each
   * save's answer is held until the test gives it: `ok`, or `lost` (the
   * server writes it, and the page gets a dropped connection). Offline,
   * every save fails at once and nothing is written.
   */
  function wired() {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = { wentWell: "X", improve: "" };
    const sent: CompCardInput[] = [];
    const answers: { ok: () => void; lost: () => void }[] = [];
    const net = { offline: false };
    const saved: CardSavedRef = { current: { forUser: "u", card: savedCardOf(X, blank) } };
    let scheduled: CompCardData = X;
    const cardSave = pendingSave(700);
    const write = (input: CompCardInput) => {
      if (input.wentWell !== undefined) server.wentWell = input.wentWell;
      if (input.improve !== undefined) server.improve = input.improve;
    };
    const send = (input: CompCardInput) => {
      sent.push(input);
      if (net.offline) return Promise.reject(new TypeError("Failed to fetch"));
      return new Promise<SaveCompCardResult>((resolve, reject) =>
        answers.push({
          ok: () => {
            write(input);
            resolve({ ok: true });
          },
          lost: () => {
            write(input);
            reject(new TypeError("Failed to fetch"));
          },
        })
      );
    };
    // demo-state.tsx: saveCardFor and the card write-through.
    const save = (c: CompCardData): Promise<void> =>
      saveCard(c, "u", saved, {
        send,
        latest: () => scheduled,
        again: () => {
          const latest = scheduled;
          cardSave.schedule(() => save(latest));
        },
      });
    let t = 0;
    const change = (fields: Partial<CompCardData>) => {
      const card = { ...scheduled, ...fields, updatedAt: new Date(Date.parse(X.updatedAt) + ++t * 1000).toISOString() };
      scheduled = card;
      cardSave.schedule(() => save(card));
    };
    return { server, sent, answers, net, change, shown: () => scheduled };
  }

  it("the change's save is written by the server and its answer lost, once the change back worked out nothing: another save sends what the page shows", async () => {
    const p = wired();
    p.change({ wentWell: "Y" });
    await vi.advanceTimersByTimeAsync(700);
    expect(p.sent).toEqual([{ wentWell: "Y" }]);
    p.change({ wentWell: "X" });
    await vi.advanceTimersByTimeAsync(700); // the change back: nothing to send, the server being known to hold X
    expect(p.sent).toHaveLength(1);
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(p.sent).toEqual([{ wentWell: "Y" }, { wentWell: "X" }]);
    p.answers[1].ok();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(p.shown().wentWell).toBe("X");
    expect(p.server.wentWell, "the account holds what the page shows").toBe("X");
    expect(p.sent).toHaveLength(2);
  });

  it("the same with the answer confirmed (B-E8): the account holds what the page shows", async () => {
    const p = wired();
    p.change({ wentWell: "Y" });
    await vi.advanceTimersByTimeAsync(700);
    p.change({ wentWell: "X" });
    await vi.advanceTimersByTimeAsync(700);
    p.answers[0].ok();
    await vi.advanceTimersByTimeAsync(800);
    expect(p.sent).toEqual([{ wentWell: "Y" }, { wentWell: "X" }]);
    p.answers[1].ok();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(p.server.wentWell).toBe("X");
    expect(p.sent).toHaveLength(2);
  });

  it("a newer change still waiting when the answer is lost: one save, of the card as the page shows it", async () => {
    const p = wired();
    p.change({ wentWell: "Y" });
    await vi.advanceTimersByTimeAsync(700);
    p.change({ wentWell: "Z" });
    await vi.advanceTimersByTimeAsync(300);
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(p.sent).toEqual([{ wentWell: "Y" }, { wentWell: "Z" }]);
    p.answers[1].ok();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(p.server.wentWell).toBe("Z");
    expect(p.sent).toHaveLength(2);
  });

  it("offline: the save scheduled then is tried again as any save is (1 s, 2 s, 4 s, 8 s) and then left, never every 700 ms; the next change sends the answer too", async () => {
    const p = wired();
    p.change({ wentWell: "Y" });
    await vi.advanceTimersByTimeAsync(700);
    p.change({ wentWell: "X" });
    await vi.advanceTimersByTimeAsync(700);
    p.net.offline = true;
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(60_000);
    // Y's save, then the one scheduled after it: its first try and four more.
    expect(p.sent).toEqual([{ wentWell: "Y" }, ...Array.from({ length: 5 }, () => ({ wentWell: "X" }))]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(p.sent).toHaveLength(6);
    expect(console.error).toHaveBeenCalledTimes(1);
    // Online again: the learner's next change carries the answer whose save wasn't confirmed.
    p.net.offline = false;
    p.change({ improve: "I" });
    await vi.advanceTimersByTimeAsync(700);
    expect(p.sent[6]).toEqual({ wentWell: "X", improve: "I" });
    p.answers[1].ok();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(p.server).toEqual({ wentWell: "X", improve: "I" });
    expect(p.sent).toHaveLength(7);
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

describe("cardBeacon: the card's fields the page sends as it goes, outside Next's queue (D37 as built)", () => {
  const X = { ...blank, wentWell: "X", improve: "I", updatedAt: "2026-11-21T10:00:00.000Z" };
  const known = (): CardSavedRef => ({ current: { forUser: "u", card: savedCardOf(X, blank) } });

  it("nothing while no card save is on its way and none failed: the server is known to hold the card", () => {
    expect(cardBeacon({ ...X, wentWell: "Z" }, "u", known(), [])).toBeNull();
  });

  it("with a save on its way: the fields the server isn't known to hold, as the page has them", () => {
    const sending = [{ forUser: "u", input: { wentWell: "Y" } }];
    expect(cardBeacon({ ...X, wentWell: "Z", confidence: 5 }, "u", known(), sending)).toEqual({ wentWell: "Z", confidence: 5 });
  });

  it("every field a save on its way carries counts as not confirmed: one changed back is sent as the page has it", () => {
    const sending = [{ forUser: "u", input: { wentWell: "Y" } }];
    expect(cardBeacon(X, "u", known(), sending)).toEqual({ wentWell: "X" });
  });

  it("never a field the page didn't change: another tab's or device's change of it stays", () => {
    const sending = [{ forUser: "u", input: { wentWell: "Y" } }];
    expect(cardBeacon({ ...X, wentWell: "Y" }, "u", known(), sending)).toEqual({ wentWell: "Y" });
  });

  it("a failed save, nothing on its way: the fields it sent, no longer known", () => {
    const saved = known();
    saved.current!.card = afterCardSave(saved.current!.card, { wentWell: "Y" }, "failed");
    expect(cardBeacon({ ...X, wentWell: "Y" }, "u", saved, [])).toEqual({ wentWell: "Y" });
  });

  it("never who sees the card, nor a text over 2,000 characters", () => {
    const sending = [{ forUser: "u", input: { wentWell: "Y" } }];
    const card = { ...X, wentWell: "Y", sharing: "facilitators" as const, behaviour: "b".repeat(2001) };
    expect(cardBeacon(card, "u", known(), sending)).toEqual({ wentWell: "Y" });
  });

  it("nothing for another learner's saves, once the page let go of the learner, or with no card", () => {
    expect(cardBeacon({ ...X, wentWell: "Z" }, "u", known(), [{ forUser: "v", input: { wentWell: "Y" } }])).toBeNull();
    const sending = [{ forUser: "u", input: { wentWell: "Y" } }];
    expect(cardBeacon({ ...X, wentWell: "Z" }, "u", { current: null }, sending)).toBeNull();
    expect(cardBeacon({ ...X, wentWell: "Z" }, "v", known(), sending)).toBeNull();
    expect(cardBeacon(null, "u", known(), sending)).toBeNull();
  });
});

describe("saveCard: the saves on their way, and a refusal before the profile step", () => {
  const X = { ...blank, wentWell: "X", updatedAt: "2026-11-21T10:00:00.000Z" };
  const Y = { ...X, wentWell: "Y", updatedAt: "2026-11-21T10:00:01.000Z" };

  it("a save is on its way from when it is sent until it is answered: confirmed, refused or failed", async () => {
    for (const end of ["ok", "refused", "failed"] as const) {
      const saved: CardSavedRef = { current: { forUser: "u", card: savedCardOf(X, blank) } };
      const sending: CardSendingRef = { current: [] };
      let answer!: (r: SaveCompCardResult) => void;
      let fail!: (e: Error) => void;
      const done = saveCard(Y, "u", saved, {
        send: () => new Promise((resolve, reject) => ((answer = resolve), (fail = reject))),
        latest: () => Y,
        again: () => undefined,
        sending,
      }).catch(() => undefined);
      expect(sending.current, end).toEqual([{ forUser: "u", input: { wentWell: "Y" } }]);
      if (end === "failed") fail(new TypeError("Failed to fetch"));
      else answer(end === "ok" ? { ok: true } : { ok: false, error: "bad-input" });
      await done;
      expect(sending.current, end).toEqual([]);
    }
  });

  it("refused before the profile step is done (D79): the page says so, and the server is known to hold what it did", async () => {
    const saved: CardSavedRef = { current: { forUser: "u", card: savedCardOf(X, blank) } };
    const profileIncomplete = vi.fn();
    const again = vi.fn();
    const deps = {
      send: async (): Promise<SaveCompCardResult> => ({ ok: false, error: "profile-incomplete" }),
      latest: () => Y,
      again,
      profileIncomplete,
    };
    await saveCard(Y, "u", saved, deps);
    expect(profileIncomplete).toHaveBeenCalledTimes(1);
    expect(again).not.toHaveBeenCalled();
    expect(saved.current?.card.wentWell).toBe("X");
    // Not for another refusal, nor once the page let go of the learner.
    await saveCard(Y, "u", saved, { ...deps, send: async () => ({ ok: false, error: "bad-input" }) });
    let letGo!: () => void;
    const late = saveCard(Y, "u", saved, { ...deps, send: () => new Promise((resolve) => (letGo = () => resolve({ ok: false, error: "profile-incomplete" }))) });
    saved.current = null;
    letGo();
    await late;
    expect(profileIncomplete).toHaveBeenCalledTimes(1);
  });
});

describe("the page going with a card save on its way, as DemoStateProvider wires it: Next's queue and the keepalive request (K1, K4)", () => {
  const X = { ...blank, wentWell: "X", improve: "I", updatedAt: "2026-11-21T10:00:00.000Z" };

  /**
   * A page signed in as "u", whose card loaded as X, and the server. Next
   * sends the page's actions one at a time: a save handed over while
   * another is on its way waits behind it. The test answers the one on the
   * wire; when the page goes (pagehide), what is waiting is flushed, and
   * the page's keepalive request (cardBeacon), if any, reaches the server
   * after the save on the wire, which the server writes with its answer
   * reaching no page; the saves behind it never leave.
   */
  function goingPage({ beacon = true } = {}) {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server: Record<string, unknown> = { wentWell: "X", improve: "I" };
    const write = (input: CompCardInput) => {
      for (const field of ["wentWell", "difficult", "improve", "behaviour", "confidence"] as const) {
        if (input[field] !== undefined) server[field] = input[field];
      }
    };
    const saved: CardSavedRef = { current: { forUser: "u", card: savedCardOf(X, blank) } };
    const sending: CardSendingRef = { current: [] };
    const queue: { input: CompCardInput; resolve: (r: SaveCompCardResult) => void; reject: (e: Error) => void }[] = [];
    const cardSave = pendingSave(700);
    let scheduled: CompCardData = X;
    let gone = false;
    const send = (input: CompCardInput) =>
      new Promise<SaveCompCardResult>((resolve, reject) => queue.push({ input, resolve, reject }));
    const save = (c: CompCardData): Promise<void> =>
      saveCard(c, "u", saved, {
        send,
        latest: () => scheduled,
        again: () => {
          const latest = scheduled;
          cardSave.schedule(() => save(latest));
        },
        sending,
      });
    let t = 0;
    return {
      server,
      queue,
      change(fields: Partial<CompCardData>) {
        const card = { ...scheduled, ...fields, updatedAt: new Date(Date.parse(X.updatedAt) + ++t * 1000).toISOString() };
        scheduled = card;
        cardSave.schedule(() => save(card));
      },
      /** The save on the wire is confirmed: the next in the queue goes on the wire. */
      confirm() {
        const first = queue.shift()!;
        write(first.input);
        first.resolve({ ok: true });
      },
      /** The page goes: the waiting save is flushed, the save on the wire written, its answer lost; the keepalive request lands. */
      goes() {
        cardSave.flush();
        const sent = beacon ? cardBeacon(scheduled, "u", saved, sending.current) : null;
        gone = true;
        const onTheWire = queue.shift();
        if (onTheWire) write(onTheWire.input);
        if (sent) write(sent);
        return sent;
      },
      gone: () => gone,
    };
  }

  it("K1: more typed after the save left, the next save waiting behind it: the account holds what the learner left", async () => {
    const p = goingPage();
    p.change({ wentWell: "first" });
    await vi.advanceTimersByTimeAsync(700);
    p.change({ wentWell: "first and more" });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(p.queue.map((q) => q.input), "the second waits behind the first").toEqual([{ wentWell: "first" }, { wentWell: "first and more" }]);
    expect(p.goes()).toEqual({ wentWell: "first and more" });
    expect(p.server).toEqual({ wentWell: "first and more", improve: "I" });
  });

  it("without the keepalive request (the build before), the account keeps what the save on its way carried", async () => {
    const p = goingPage({ beacon: false });
    p.change({ wentWell: "first" });
    await vi.advanceTimersByTimeAsync(700);
    p.change({ wentWell: "first and more" });
    await vi.advanceTimersByTimeAsync(1_500);
    p.goes();
    expect(p.server.wentWell).toBe("first");
  });

  it("K4: more typed and the page gone at once, within the pause: the waiting save is flushed into the queue, and the request carries it", async () => {
    const p = goingPage();
    p.change({ wentWell: "first" });
    await vi.advanceTimersByTimeAsync(700);
    p.change({ wentWell: "first more" });
    expect(p.goes()).toEqual({ wentWell: "first more" });
    expect(p.server.wentWell).toBe("first more");
  });

  it("an answer changed back while the save of the change is on its way: the account holds what the page shows", async () => {
    const p = goingPage();
    p.change({ wentWell: "Y" });
    await vi.advanceTimersByTimeAsync(700);
    p.change({ wentWell: "X" });
    await vi.advanceTimersByTimeAsync(700); // nothing to send: the server is known to hold X
    expect(p.queue).toHaveLength(1);
    expect(p.goes()).toEqual({ wentWell: "X" });
    expect(p.server.wentWell).toBe("X");
  });

  it("a field changed in another tab meanwhile, not on this page, keeps the other tab's", async () => {
    const p = goingPage();
    p.change({ wentWell: "Y" });
    await vi.advanceTimersByTimeAsync(700);
    p.server.improve = "from another tab";
    p.change({ wentWell: "Y and more" });
    await vi.advanceTimersByTimeAsync(700);
    expect(p.goes()).toEqual({ wentWell: "Y and more" });
    expect(p.server).toEqual({ wentWell: "Y and more", improve: "from another tab" });
  });

  it("guard: every save confirmed before the page goes: nothing is sent outside the queue", async () => {
    const p = goingPage();
    p.change({ wentWell: "Y" });
    await vi.advanceTimersByTimeAsync(700);
    p.confirm();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(p.goes()).toBeNull();
    expect(p.server.wentWell).toBe("Y");
  });
});
