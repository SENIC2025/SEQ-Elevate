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
 * The outbox only ever holds what a page of this tab had that the server
 * hadn't confirmed — beside an answer whose save failed, what the server
 * holds if it was written — and the page that loads the course next takes
 * it in (outboxRestored). So as soon as nothing this page holds is left to send
 * — a save confirmed with nothing left, a change that leaves nothing new
 * (courseChanged) — what it kept is on the server or was changed since,
 * and it is cleared: applied again on a later load, it would come back
 * over newer progress (spec 5.4).
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
import { clearOutbox, putInOutbox, type OutboxStorage } from "./outbox";

/** Answers whose save failed (it may have been written): which, and what the server holds if they were. */
interface LostSaves {
  answers: Map<string, Set<string> | null>;
  ifWritten: ProgressState;
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

/** A save of `patch` failed: what it carried may have been written, and isn't known until a save of it is confirmed. */
function sentAndLost(refs: CourseSaveRefs, slug: string, patch: ProgressPatch): void {
  const acked = refs.acked.get(slug);
  const answers = answersIn(patch);
  if (!acked || !answers.size) return;
  const lost = refs.unsure.get(slug) ?? { answers: new Map(), ifWritten: acked };
  addAnswers(lost.answers, answers);
  lost.ifWritten = applyPatch(lost.ifWritten, patch);
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
  if (lost.answers.size) lost.ifWritten = applyPatch(lost.ifWritten, confirmed);
  else refs.unsure.delete(slug);
}

/** What the next save of `slug` would send; null when nothing. */
export function outstandingPatch(refs: CourseSaveRefs, slug: string): ProgressPatch | null {
  return outstanding(refs, slug)?.patch ?? null;
}

/** Has `slug`'s progress loaded, so what the server holds of it is known? */
const loaded = (refs: CourseSaveRefs, slug: string) => refs.acked.has(slug) && refs.latest.has(slug);

/**
 * What this page has of `slug` that the server hasn't confirmed, kept in
 * the tab's outbox in place of what it held — this page took that in when
 * the course loaded — or nothing kept when there is none.
 */
function keepUnconfirmed(refs: CourseSaveRefs, slug: string, forUser: string, outbox: OutboxStorage | null) {
  const acked = refs.acked.get(slug);
  const latest = refs.latest.get(slug);
  // A save that finds a newer build wrote nothing; one whose answer was
  // lost may have written what it sent.
  const unconfirmed = acked && latest ? patchSince(acked, latest, unsureOf(refs, slug, false)) : null;
  // With what the server holds, so the patch never comes back over an
  // answer saved elsewhere meanwhile (outbox.ts restoreOutbox).
  if (unconfirmed) putInOutbox(outbox, forUser, slug, unconfirmed, acked, refs.unsure.get(slug)?.ifWritten);
  else clearOutbox(outbox, forUser, slug);
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
  clearOutbox(outbox, forUser, slug);
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
    // Nothing a save could send: the server has all it can take.
    if (loaded(refs, slug)) clearOutbox(deps.outbox, forUser, slug);
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
      // What isn't confirmed now, not when it was sent: an answer changed
      // back meanwhile mustn't come back after the reload.
      keepUnconfirmed(refs, slug, forUser, deps.outbox);
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
  if (outstanding(refs, slug, { onTheirWay: false })?.patch) deps.again();
  else clearOutbox(deps.outbox, forUser, slug);
}
