/**
 * A signed-in learner's saves that a newer build of the site couldn't take
 * (D68, spec 5.4).
 *
 * A server action is found by an id the build makes. After a deploy, a page
 * loaded before it may send a save the new server doesn't recognise
 * (Next's UnrecognizedActionError), and trying it again can't help: only
 * reloading the page can. So that save isn't tried again; everything the
 * server hasn't confirmed for the course goes to this tab's outbox — a
 * sessionStorage entry per learner and course, which outlives the reload —
 * and the page asks the learner to reload. Once the reloaded page has
 * loaded and merged the course's saved progress for the same learner, the
 * outbox is applied as changes made on the page, and saved like any; it is
 * cleared once a save of them is confirmed. Another learner's entry (an
 * account signed in after a sign-out on this tab) is never read.
 *
 * Pure but for the storage handed in, and never throws: a browser that
 * blocks storage keeps nothing here, which leaves the answers on the page.
 */

import { isSectionId } from "@/lib/cms/sections/contract";
import type { PatchAnswer, ProgressPatch } from "@/lib/learner-progress/contract";
import { readAnswer } from "@/lib/learner-progress/parse";

export const OUTBOX_PREFIX = "seq-elevate-outbox-v1:";

/** The part of the Web Storage API the outbox uses: the store hands in sessionStorage. */
export type OutboxStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The entry for `forUser` (whose data the store holds, see session-owner.ts) and course `slug`. */
export const outboxKey = (forUser: string, slug: string) => `${OUTBOX_PREFIX}${forUser}:${slug}`;

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * `older` then `newer` as one patch: each finished lesson once, in order;
 * per key the newer answer — question by question for a reflection or a
 * rating, as the server merges them; the first completion. Fill mode is
 * never kept: only the move of a guest's progress sends it, and that is
 * never put here.
 */
export function mergePatches(older: ProgressPatch, newer: ProgressPatch): ProgressPatch {
  const completed = [...(older.completed ?? []), ...(newer.completed ?? [])].filter(
    (id, i, all) => all.indexOf(id) === i
  );
  const answers: Record<string, PatchAnswer> = { ...(older.answers ?? {}) };
  for (const [key, answer] of Object.entries(newer.answers ?? {})) {
    const before = answers[key];
    if (answer.type === "reflection" && before?.type === "reflection") {
      answers[key] = { type: "reflection", text: { ...before.text, ...answer.text } };
    } else if (answer.type === "rating" && before?.type === "rating") {
      answers[key] = { type: "rating", values: { ...before.values, ...answer.values } };
    } else {
      answers[key] = answer;
    }
  }
  const completedAt = older.completedAt ?? newer.completedAt;
  return {
    v: 2,
    ...(completed.length ? { completed } : {}),
    ...(Object.keys(answers).length ? { answers } : {}),
    ...(completedAt ? { completedAt } : {}),
  };
}

/**
 * What an entry holds, as a patch: each finished lesson, each answer this
 * key can take (parse.ts) and a completion time that reads as one. An
 * answer is read as a saved one is, without the limits of one save: a
 * reflection over the length limit is the learner's text, back on the page
 * for them to shorten, and the store holds it back until they do; one with
 * more questions than a save may carry is sent a save's worth at a time
 * (fitPatch). Null for anything else, or nothing.
 */
function readPatch(raw: unknown): ProgressPatch | null {
  if (!isRecord(raw) || raw.v !== 2) return null;
  const completed = (Array.isArray(raw.completed) ? raw.completed : []).filter(
    (id, i, all): id is string => isSectionId(id) && all.indexOf(id) === i
  );
  const answers: Record<string, PatchAnswer> = {};
  for (const [key, value] of Object.entries(isRecord(raw.answers) ? raw.answers : {})) {
    const answer = readAnswer(key, value);
    if (answer) answers[key] = answer;
  }
  const at = raw.completedAt;
  const completedAt = typeof at === "string" && Number.isFinite(Date.parse(at)) ? at : undefined;
  if (!completed.length && !Object.keys(answers).length && !completedAt) return null;
  return {
    v: 2,
    ...(completed.length ? { completed } : {}),
    ...(Object.keys(answers).length ? { answers } : {}),
    ...(completedAt ? { completedAt } : {}),
  };
}

/** The patch waiting for `forUser` in `slug`, or null: none, unreadable, or no storage. */
export function readOutbox(
  storage: OutboxStorage | null,
  forUser: string,
  slug: string
): ProgressPatch | null {
  try {
    const raw = storage?.getItem(outboxKey(forUser, slug));
    return raw ? readPatch(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * Adds `patch` to what waits for `forUser` in `slug`. False when it
 * couldn't be kept (no storage, or the browser refused it): the answers are
 * then only on the page.
 */
export function putInOutbox(
  storage: OutboxStorage | null,
  forUser: string,
  slug: string,
  patch: ProgressPatch
): boolean {
  if (!storage) return false;
  try {
    const before = readOutbox(storage, forUser, slug);
    const { fill: _fill, ...own } = patch;
    void _fill;
    const next = before ? mergePatches(before, own) : own;
    storage.setItem(outboxKey(forUser, slug), JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** Forgets what waits for `forUser` in `slug`: a save of it was confirmed. */
export function clearOutbox(storage: OutboxStorage | null, forUser: string, slug: string): void {
  try {
    storage?.removeItem(outboxKey(forUser, slug));
  } catch {
    /* nothing kept, nothing to clear */
  }
}
