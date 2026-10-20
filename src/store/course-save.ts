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
 * sent on every save, for ever — and the learner is told about both
 * (progressRefused). When something is still left once a save is
 * confirmed (a value changed back while it was on its way, a patch too big
 * for one save), another is scheduled.
 *
 * A save is answered, not thrown, when no try can succeed: another
 * account's (dropped, D37), or one the server can't take at all (logged).
 * A thrown error is thrown on, so it's tried again (pending-save.ts) —
 * except Next's UnrecognizedActionError, which means this page is from a
 * build the server no longer has (D68): only a reload helps, so what isn't
 * confirmed when it fails goes to the tab's outbox instead (outbox.ts).
 *
 * The outbox only ever holds what a page of this tab had that the server
 * hadn't confirmed, and the page that loads the course next takes it in
 * (outboxRestored). So as soon as nothing this page holds is left to send
 * — a save confirmed with nothing left, a change that leaves nothing new
 * (courseChanged) — what it kept is on the server or was changed since,
 * and it is cleared: applied again on a later load, it would come back
 * over newer progress (spec 5.4).
 *
 * No React: DemoStateProvider in demo-state.tsx applies it.
 */

import { unstable_isUnrecognizedActionError } from "next/navigation";
import type {
  PatchAnswer,
  ProgressPatch,
  ProgressState,
  RefusedKey,
  SaveProgressResult,
} from "@/lib/learner-progress/contract";
import { applyPatch, fitPatch, patchSince, withoutRefused, type FittedPatch } from "@/lib/learner-progress/patch";
import { clearOutbox, putInOutbox, type OutboxStorage } from "./outbox";

/** What the store keeps for its saves. Replaced whole when it lets go of a learner's data. */
export interface CourseSaveRefs {
  /** By course: what the server is known to hold. Set when the course's progress loads. */
  acked: Map<string, ProgressState>;
  /** By course: what the learner has now, once it has loaded. */
  latest: Map<string, ProgressState>;
  /** By course, then key: what the server refused, as it was sent ("" for a lesson). */
  refused: Map<string, Map<string, string>>;
}

export function courseSaveRefs(): CourseSaveRefs {
  return { acked: new Map(), latest: new Map(), refused: new Map() };
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

/** `patch` without what the server refused before, unchanged since. Null when nothing is left. */
function withoutRepeats(patch: ProgressPatch, refused: Map<string, string> | undefined): ProgressPatch | null {
  if (!refused?.size) return patch;
  const completed = (patch.completed ?? []).filter((id) => !refused.has(id));
  const answers = Object.fromEntries(
    Object.entries(patch.answers ?? {}).filter(([key, answer]) => refused.get(key) !== canonical(answer))
  ) as Record<string, PatchAnswer>;
  if (!completed.length && !Object.keys(answers).length && !patch.completedAt) return null;
  return {
    v: 2,
    ...(completed.length ? { completed } : {}),
    ...(Object.keys(answers).length ? { answers } : {}),
    ...(patch.completedAt ? { completedAt: patch.completedAt } : {}),
  };
}

/** What the server doesn't have yet for `slug`, and the part of it a save can send now. */
function outstanding(refs: CourseSaveRefs, slug: string): FittedPatch | null {
  const acked = refs.acked.get(slug);
  const latest = refs.latest.get(slug);
  if (!acked || !latest) return null;
  const all = patchSince(acked, latest);
  const pending = all && withoutRepeats(all, refs.refused.get(slug));
  return pending ? fitPatch(pending) : null;
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
  const unconfirmed = acked && latest ? patchSince(acked, latest) : null;
  // With what the server holds, so the patch never comes back over an
  // answer saved elsewhere meanwhile (outbox.ts restoreOutbox).
  if (unconfirmed) putInOutbox(outbox, forUser, slug, unconfirmed, acked);
  else clearOutbox(outbox, forUser, slug);
}

/**
 * `slug`'s progress as the learner has it now (`latest`), once it has
 * loaded: kept for the next save. True when there is something to send.
 * When there's nothing — the learner went back to what the server has, or
 * what the outbox brought back is on the server already — the tab's
 * outbox for the course is cleared: it holds nothing the server needs.
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
  if (patchSince(acked, latest)) return true;
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
  const fitted = outstanding(refs, slug);
  if (fitted?.held.length) deps.refusedKeys(slug, fitted.held);
  const patch = fitted?.patch;
  if (!patch) {
    // Nothing a save could send: the server has all it can take.
    if (loaded(refs, slug)) clearOutbox(deps.outbox, forUser, slug);
    return;
  }

  let result: SaveProgressResult;
  try {
    result = await deps.send(slug, patch, forUser);
  } catch (err) {
    if (unstable_isUnrecognizedActionError(err)) {
      // What isn't confirmed now, not when it was sent: an answer changed
      // back meanwhile mustn't come back after the reload.
      keepUnconfirmed(refs, slug, forUser, deps.outbox);
      deps.staleBuild(slug);
      return;
    }
    throw err;
  }
  if (!deps.current()) return;
  if (!result.ok) {
    if (result.error !== "other-account") {
      console.error(`The progress of "${slug}" wasn't saved, and can't be: ${result.error}.`);
    }
    return;
  }

  const acked = refs.acked.get(slug);
  if (!acked) return;
  refs.acked.set(slug, applyPatch(acked, withoutRefused(patch, result.refused)));
  if (result.refused.length) {
    const repeat = refs.refused.get(slug) ?? new Map<string, string>();
    refs.refused.set(slug, repeat);
    for (const { key } of result.refused) {
      const answer = patch.answers?.[key];
      repeat.set(key, answer ? canonical(answer) : "");
    }
    deps.refusedKeys(slug, result.refused);
  }
  if (outstanding(refs, slug)?.patch) deps.again();
  else clearOutbox(deps.outbox, forUser, slug);
}
