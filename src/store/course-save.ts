/**
 * One save of a course's progress, as the learner store sends it (D62.b,
 * spec 5.4).
 *
 * The store keeps, per course, what the server is known to hold (`acked`:
 * the progress it loaded, moved on by every save it confirmed) and what the
 * learner has now (`latest`). A save sends patchSince(acked, latest) worked
 * out when it is SENT, not when it was scheduled: a retry, or a save sent
 * after the learner changed something again, carries everything not yet
 * confirmed. What the server would refuse is held back (fitPatch) and what
 * it did refuse is never sent again unchanged — either would otherwise be
 * sent on every save, for ever — and the learner is told about both, on
 * every save that leaves them out (progressRefused). When something is
 * still left once a save is confirmed (a value changed back while it was
 * on its way, a patch too big for one save), another is scheduled.
 *
 * What a save sends isn't known on the server until it is confirmed: the
 * save may still be written, and one that fails (a dropped connection) may
 * have been. So an answer a save on its way carries that the page has
 * changed since, and an answer whose save failed until a save of it is
 * confirmed (`unsure`), is sent as the page has it whatever `acked` says:
 * a change back to what the server was known to hold is a change, and gets
 * a save of its own. A save that fails once the page has changed since it
 * was worked out is followed by another if something is left, as a newer
 * save may have been worked out without what it sent; failing with the
 * page unchanged, it is tried again (pending-save.ts) and then left until
 * the next change. A save that finds a newer build wrote nothing. The
 * course loading again says what the server holds, and ends the doubt.
 *
 * A save is answered, not thrown, when no try can succeed: another
 * account's (dropped, D37), or one the server can't take at all (logged).
 * A thrown error is thrown on, so it's tried again (pending-save.ts) —
 * except Next's UnrecognizedActionError, which means this page is from a
 * build the server no longer has (D68): only a reload helps, so what isn't
 * confirmed when it fails goes to the tab's outbox instead (outbox.ts).
 *
 * Once the store has let go of the learner (signed out, another account
 * signed in), a save's answer keeps nothing of theirs in the tab (D68).
 *
 * Next sends a page's server actions one at a time: a save handed over
 * while another is on its way waits behind it, and one waiting never
 * leaves a page that goes. So when the page is hidden or left (pageHidden:
 * pagehide, and visibilitychange to hidden, after which a phone may
 * discard the tab and load it again), what the page has of a course that
 * the server hasn't confirmed goes to the tab's outbox while a save of it
 * is on its way or failed — every answer a save on its way carries
 * counted as not confirmed — and the page that loads the course next
 * brings it back over what the server held or any value those saves may
 * have left. And when the page is left (pagehide), what it has of each
 * such course that the server hasn't confirmed is sent outside that queue
 * too, with fetch(keepalive), which the browser finishes after the page
 * has gone (progressBeacons; POST /api/progress/beacon, D37 as built).
 *
 * The outbox only ever holds what a page of this tab had that the server
 * hadn't confirmed — beside an answer a save not confirmed carried, each
 * value that save may have left — and the page that loads the course next
 * takes it in (outboxRestored). While it holds an entry for the course,
 * the entry follows what is confirmed: after every save confirmed, every
 * save that finds nothing to send and every change that leaves nothing
 * new (courseChanged), it holds what the page has that the server hasn't
 * confirmed, or is cleared once there is none — kept as it was, it would
 * bring back over newer progress what the page had before (spec 5.4).
 *
 * No React: DemoStateProvider in demo-state.tsx applies it.
 */

import { unstable_isUnrecognizedActionError } from "next/navigation";
import type {
  KeyRefusal,
  PatchAnswer,
  ProgressPatch,
  ProgressState,
  RefusedKey,
  SaveProgressResult,
} from "@/lib/learner-progress/contract";
import {
  answersIn,
  applyPatch,
  fitPatch,
  patchSince,
  withoutRefused,
  type FittedPatch,
  type UnsureAnswers,
} from "@/lib/learner-progress/patch";
import { BEACON_BUDGET_BYTES, fitBeacon } from "@/lib/learner-progress/beacon";
import { clearOutbox, inOutbox, putInOutbox, type OutboxStorage } from "./outbox";

/** At most this many failed saves' outcomes kept for a course: the first ones, and the newest. */
const LOST_KEPT = 8;

/** Answers whose save failed (it may have been written): which, and what the server may hold of them. */
interface LostSaves {
  answers: Map<string, Set<string> | null>;
  /**
   * For each failed save, what the server holds if it was written last,
   * moved on by every save confirmed since: at most LOST_KEPT, the first
   * ones and the newest.
   */
  ifWritten: ProgressState[];
}

/** What the store keeps for its saves. Replaced whole when it lets go of a learner's data. */
export interface CourseSaveRefs {
  /** By course: what the server is known to hold. Set when the course's progress loads. */
  acked: Map<string, ProgressState>;
  /** By course: what the learner has now, once it has loaded. */
  latest: Map<string, ProgressState>;
  /** By course, then key: what the server refused, as it was sent ("" for a lesson), and why. */
  refused: Map<string, Map<string, { sent: string; reason: KeyRefusal }>>;
  /** By course: the saves sent and not answered yet, as sent. */
  sending: Map<string, ProgressPatch[]>;
  /** By course: the answers whose save failed, until a save of them is confirmed or the course loads again. */
  unsure: Map<string, LostSaves>;
}

export function courseSaveRefs(): CourseSaveRefs {
  return { acked: new Map(), latest: new Map(), refused: new Map(), sending: new Map(), unsure: new Map() };
}

/**
 * `slug`'s progress has loaded (or loaded again): the server holds
 * `server`. What the learner has is set once it is merged (courseChanged);
 * refusals and answers whose save failed are forgotten: the load says what
 * the server holds.
 */
export function courseLoaded(refs: CourseSaveRefs, slug: string, server: ProgressState): void {
  refs.acked.set(slug, server);
  refs.latest.delete(slug);
  refs.refused.delete(slug);
  refs.unsure.delete(slug);
}

export interface CourseSaveDeps {
  /** saveCourseProgressPatch. */
  send(slug: string, patch: ProgressPatch, forUser: string): Promise<SaveProgressResult>;
  /** Keys held back or refused: the learner is told (progressRefused). */
  refusedKeys(slug: string, keys: RefusedKey[]): void;
  /** This page's build is gone; what isn't confirmed is in the outbox: the learner is asked to reload. */
  staleBuild(slug: string): void;
  /** The tab's sessionStorage, for the outbox (outbox.ts); null where the browser has none. */
  outbox: OutboxStorage | null;
  /** Something is left to send: schedule another save. */
  again(): void;
  /** Are the refs still the learner's? False once the store has let go of them. */
  current(): boolean;
}

/** JSON with object keys in order, so the same answer reads the same. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * `patch` without what the server refused before, unchanged since; each
 * answer left out is added to `repeats`, so the learner is told again.
 * Null when nothing is left.
 */
function withoutRepeats(
  patch: ProgressPatch,
  refused: Map<string, { sent: string; reason: KeyRefusal }> | undefined,
  repeats: RefusedKey[]
): ProgressPatch | null {
  if (!refused?.size) return patch;
  const completed = (patch.completed ?? []).filter((id) => !refused.has(id));
  const answers = Object.fromEntries(
    Object.entries(patch.answers ?? {}).filter(([key, answer]) => {
      const before = refused.get(key);
      if (before?.sent !== canonical(answer)) return true;
      repeats.push({ key, reason: before.reason });
      return false;
    })
  ) as Record<string, PatchAnswer>;
  if (!completed.length && !Object.keys(answers).length && !patch.completedAt) return null;
  return {
    v: 2,
    ...(completed.length ? { completed } : {}),
    ...(Object.keys(answers).length ? { answers } : {}),
    ...(patch.completedAt ? { completedAt: patch.completedAt } : {}),
  };
}

/** `from`'s answers added to `into`: a reflection's or rating's questions joined, a whole answer whole. */
function addAnswers(into: Map<string, Set<string> | null>, from: UnsureAnswers): void {
  for (const [key, questions] of from) {
    const had = into.get(key);
    if (questions === null || (into.has(key) && had === null)) into.set(key, null);
    else into.set(key, new Set([...(had ?? []), ...questions]));
  }
}

/**
 * The answers of `slug` the server may hold otherwise than `acked` says:
 * those whose save failed, and — with `onTheirWay` — those the page has
 * changed since a save on its way carried them.
 */
function unsureOf(refs: CourseSaveRefs, slug: string, onTheirWay: boolean): UnsureAnswers | undefined {
  const out = new Map<string, Set<string> | null>();
  const lost = refs.unsure.get(slug);
  if (lost) addAnswers(out, lost.answers);
  const sending = onTheirWay ? refs.sending.get(slug) : undefined;
  const acked = refs.acked.get(slug);
  const latest = refs.latest.get(slug);
  if (sending?.length && acked && latest) {
    // What the server holds once they are written, against the page.
    const written = sending.reduce<ProgressState>((held, patch) => applyPatch(held, patch), acked);
    const changed = patchSince(written, latest);
    if (changed) addAnswers(out, answersIn(changed));
  }
  return out.size ? out : undefined;
}

/**
 * What the server doesn't have yet for `slug`, and the part of it a save
 * can send now; a refused answer left out unchanged is added to `repeats`.
 * Without `onTheirWay`, what a save on its way carries counts as written:
 * once a save is confirmed, another follows only for what no save carries.
 */
function outstanding(
  refs: CourseSaveRefs,
  slug: string,
  { onTheirWay = true, repeats = [] }: { onTheirWay?: boolean; repeats?: RefusedKey[] } = {}
): FittedPatch | null {
  const acked = refs.acked.get(slug);
  const latest = refs.latest.get(slug);
  if (!acked || !latest) return null;
  const all = patchSince(acked, latest, unsureOf(refs, slug, onTheirWay));
  const pending = all && withoutRepeats(all, refs.refused.get(slug), repeats);
  return pending ? fitPatch(pending) : null;
}

/** Are `a` and `b` the same as far as a save goes: the same lessons finished, the same answers? */
const sameProgress = (a: ProgressState, b: ProgressState) => !patchSince(a, b) && !patchSince(b, a);

/** A save of `patch` failed: what it carried may have been written, and isn't known until a save of it is confirmed. */
function sentAndLost(refs: CourseSaveRefs, slug: string, patch: ProgressPatch): void {
  const acked = refs.acked.get(slug);
  const answers = answersIn(patch);
  if (!acked || !answers.size) return;
  const lost: LostSaves = refs.unsure.get(slug) ?? { answers: new Map(), ifWritten: [] };
  addAnswers(lost.answers, answers);
  // The saves before it that failed may have been written or not: the
  // values each leaves are kept apart, and an answer comes back from the
  // outbox over any of them (outbox.ts).
  const outcome = applyPatch(acked, patch);
  if (!lost.ifWritten.some((other) => sameProgress(other, outcome))) {
    if (lost.ifWritten.length < LOST_KEPT) lost.ifWritten.push(outcome);
    else lost.ifWritten[LOST_KEPT - 1] = outcome;
  }
  refs.unsure.set(slug, lost);
}

/** A save of `confirmed` was confirmed: what it carried is known again, as the server writes saves in order. */
function sentAndConfirmed(refs: CourseSaveRefs, slug: string, confirmed: ProgressPatch): void {
  const lost = refs.unsure.get(slug);
  if (!lost) return;
  for (const [key, questions] of answersIn(confirmed)) {
    if (!lost.answers.has(key)) continue;
    const had = lost.answers.get(key) ?? null;
    if (questions === null) lost.answers.delete(key);
    else if (had !== null) {
      for (const q of questions) had.delete(q);
      if (!had.size) lost.answers.delete(key);
    }
  }
  if (lost.answers.size) lost.ifWritten = lost.ifWritten.map((held) => applyPatch(held, confirmed));
  else refs.unsure.delete(slug);
}

/** What the next save of `slug` would send; null when nothing. */
export function outstandingPatch(refs: CourseSaveRefs, slug: string): ProgressPatch | null {
  return outstanding(refs, slug)?.patch ?? null;
}

/** Has `slug`'s progress loaded, so what the server holds of it is known? */
const loaded = (refs: CourseSaveRefs, slug: string) => refs.acked.has(slug) && refs.latest.has(slug);

/**
 * What this page has of `slug` that the server hasn't confirmed: what it
 * has that `acked` doesn't, and every answer whose save failed — with
 * `onTheirWay`, every answer a save on its way carries too — as the page
 * has it. Null when nothing, or before the course has loaded.
 */
function unconfirmedOf(refs: CourseSaveRefs, slug: string, onTheirWay: boolean): ProgressPatch | null {
  const acked = refs.acked.get(slug);
  const latest = refs.latest.get(slug);
  if (!acked || !latest) return null;
  const unsure = new Map(refs.unsure.get(slug)?.answers);
  if (onTheirWay) for (const patch of refs.sending.get(slug) ?? []) addAnswers(unsure, answersIn(patch));
  return patchSince(acked, latest, unsure);
}

/**
 * What this page has of `slug` that the server hasn't confirmed, kept in
 * the tab's outbox in place of what it held — this page took that in when
 * the course loaded — or nothing kept when there is none. A save whose
 * answer was lost may have written what it sent. With `onTheirWay`, so may
 * the saves on their way, one by one: every answer they carry counts as
 * not confirmed. Without, they wrote nothing (a newer build).
 */
function keepUnconfirmed(
  refs: CourseSaveRefs,
  slug: string,
  forUser: string,
  outbox: OutboxStorage | null,
  onTheirWay: boolean
) {
  const acked = refs.acked.get(slug);
  const lost = refs.unsure.get(slug);
  const sending = onTheirWay ? (refs.sending.get(slug) ?? []) : [];
  const unconfirmed = unconfirmedOf(refs, slug, onTheirWay);
  if (!acked || !unconfirmed) {
    clearOutbox(outbox, forUser, slug);
    return;
  }
  // What the server may hold besides `acked`: what the saves on their way
  // leave as they are written in turn (the first is the one on the wire),
  // then what each failed save leaves.
  const mayHold: ProgressState[] = [];
  let held = acked;
  for (const patch of sending) mayHold.push((held = applyPatch(held, patch)));
  mayHold.push(...(lost?.ifWritten ?? []));
  // With what the server holds, so the patch never comes back over an
  // answer saved elsewhere meanwhile (outbox.ts restoreOutbox).
  putInOutbox(outbox, forUser, slug, unconfirmed, acked, mayHold);
}

/**
 * What the tab's outbox holds for `slug` follows what the server has
 * confirmed. Nothing `left` — nothing to send that the server would take,
 * no save on its way — and it is cleared: what it kept is on the server or
 * was changed since. Else an entry, if there is one, holds what the page
 * has that the server hasn't confirmed, every answer a save on its way
 * carries included.
 */
function followOutbox(
  refs: CourseSaveRefs,
  slug: string,
  forUser: string,
  outbox: OutboxStorage | null,
  left: boolean
) {
  if (!loaded(refs, slug)) return;
  if (!left) clearOutbox(outbox, forUser, slug);
  else if (inOutbox(outbox, forUser, slug)) keepUnconfirmed(refs, slug, forUser, outbox, true);
}

/** Is a save of `slug` on its way? */
const onItsWay = (refs: CourseSaveRefs, slug: string) => !!refs.sending.get(slug)?.length;

/**
 * The page is being hidden or left (pagehide; visibilitychange to hidden,
 * after which a phone may discard the tab and load it again), its waiting
 * saves just sent (pending-save.ts flush). For each course with a save on
 * its way — on the wire, or waiting behind another in Next's queue, never
 * to leave a page that goes — or one that failed, what the page has that
 * the server hasn't confirmed goes to the tab's outbox, beside what the
 * server held and each value those saves may have left: the page that
 * loads the course next brings it back over any of them (outbox.ts).
 * Cheap, and synchronous: sessionStorage only.
 */
export function pageHidden(refs: CourseSaveRefs, forUser: string, outbox: OutboxStorage | null): void {
  for (const slug of new Set([...refs.sending.keys(), ...refs.unsure.keys()])) {
    if (loaded(refs, slug)) keepUnconfirmed(refs, slug, forUser, outbox, true);
  }
}

/**
 * The page is being left (pagehide), its waiting saves just sent and what
 * isn't confirmed put in the tab's outbox (pageHidden). For each course
 * with a save on its way — on the wire, or waiting behind another in
 * Next's queue, never to leave a page that goes — or one that failed: what
 * the page has that the server hasn't confirmed, every answer a save on
 * its way carries counted as not confirmed, as the page has it, without
 * what the server refused before and the page hasn't changed since. The
 * bodies of POST /api/progress/beacon, sent with fetch(keepalive): the
 * browser finishes them after the page has gone, and the route saves each
 * through the save action's own code, so a save that also arrives through
 * the queue writes the same values (D37 as built). Every course together
 * within `budget` bytes; what doesn't fit isn't sent this way.
 */
export function progressBeacons(
  refs: CourseSaveRefs,
  forUser: string,
  budget: number = BEACON_BUDGET_BYTES
): string[] {
  const bodies: string[] = [];
  let left = budget;
  for (const slug of new Set([...refs.sending.keys(), ...refs.unsure.keys()])) {
    if (!loaded(refs, slug)) continue;
    const unconfirmed = unconfirmedOf(refs, slug, true);
    const patch = unconfirmed && withoutRepeats(unconfirmed, refs.refused.get(slug), []);
    const fitted = patch && fitBeacon(slug, forUser, patch, left);
    if (!fitted) continue;
    bodies.push(fitted.body);
    left -= fitted.bytes;
  }
  return bodies;
}

/**
 * `slug`'s progress as the learner has it now (`latest`), once it has
 * loaded: kept for the next save. True when there is something to send —
 * an answer whose save is on its way or failed, changed back to what the
 * server was known to hold, included. When there's nothing — the learner
 * went back to what the server has, or what the outbox brought back is on
 * the server already — the tab's outbox for the course is cleared: it
 * holds nothing the server needs.
 */
export function courseChanged(
  refs: CourseSaveRefs,
  slug: string,
  forUser: string,
  latest: ProgressState,
  outbox: OutboxStorage | null
): boolean {
  refs.latest.set(slug, latest);
  const acked = refs.acked.get(slug);
  if (!acked) return false;
  if (patchSince(acked, latest, unsureOf(refs, slug, true))) return true;
  followOutbox(refs, slug, forUser, outbox, onItsWay(refs, slug));
  return false;
}

/** Sends `slug`'s progress for `forUser`: what the server doesn't have yet (see above). */
export async function saveCourse(
  slug: string,
  forUser: string,
  refs: CourseSaveRefs,
  deps: CourseSaveDeps
): Promise<void> {
  const repeats: RefusedKey[] = [];
  const fitted = outstanding(refs, slug, { repeats });
  const told = [...(fitted?.held ?? []), ...repeats];
  if (told.length) deps.refusedKeys(slug, told);
  const patch = fitted?.patch;
  if (!patch) {
    // Nothing a save could send: the server has all it can take, but for
    // what a save on its way may still leave there.
    followOutbox(refs, slug, forUser, deps.outbox, onItsWay(refs, slug));
    return;
  }

  // The page this save was worked out from, and the saves on their way.
  const basis = refs.latest.get(slug);
  const sending = refs.sending.get(slug) ?? [];
  refs.sending.set(slug, sending);
  sending.push(patch);
  const answered = () => {
    const at = sending.indexOf(patch);
    if (at >= 0) sending.splice(at, 1);
    if (!sending.length && refs.sending.get(slug) === sending) refs.sending.delete(slug);
  };
  let result: SaveProgressResult;
  try {
    result = await deps.send(slug, patch, forUser);
  } catch (err) {
    answered();
    if (unstable_isUnrecognizedActionError(err)) {
      // The store has let go of the learner (signed out, another account):
      // nothing of theirs is kept in the tab (D68).
      if (!deps.current()) return;
      // What isn't confirmed now, not when it was sent: an answer changed
      // back meanwhile mustn't come back after the reload.
      keepUnconfirmed(refs, slug, forUser, deps.outbox, false);
      deps.staleBuild(slug);
      return;
    }
    if (deps.current()) {
      sentAndLost(refs, slug, patch);
      // A newer save may have been worked out without what this one sent
      // (pending-save.ts then doesn't try this one again).
      if (refs.latest.get(slug) !== basis && outstanding(refs, slug)?.patch) deps.again();
    }
    throw err;
  }
  answered();
  if (!deps.current()) return;
  if (!result.ok) {
    if (result.error !== "other-account") {
      console.error(`The progress of "${slug}" wasn't saved, and can't be: ${result.error}.`);
    }
    return;
  }

  const acked = refs.acked.get(slug);
  if (!acked) return;
  const confirmed = withoutRefused(patch, result.refused);
  refs.acked.set(slug, applyPatch(acked, confirmed));
  sentAndConfirmed(refs, slug, confirmed);
  if (result.refused.length) {
    const repeat = refs.refused.get(slug) ?? new Map<string, { sent: string; reason: KeyRefusal }>();
    refs.refused.set(slug, repeat);
    for (const { key, reason } of result.refused) {
      const answer = patch.answers?.[key];
      repeat.set(key, { sent: answer ? canonical(answer) : "", reason });
    }
    deps.refusedKeys(slug, result.refused);
  }
  const more = !!outstanding(refs, slug, { onTheirWay: false })?.patch;
  if (more) deps.again();
  followOutbox(refs, slug, forUser, deps.outbox, more || onItsWay(refs, slug));
}
