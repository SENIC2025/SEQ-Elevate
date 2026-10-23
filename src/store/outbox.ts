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
 * outbox is applied as changes made on the page, and saved like any. It is
 * cleared as soon as nothing that page holds is left to send, whether or
 * not it was applied there (course-save.ts): kept, it would come back over
 * newer progress on a later load. Another learner's entry (an account
 * signed in after a sign-out on this tab) is never read.
 *
 * Each entry keeps beside its patch what the server held of each answer
 * when it was kept (its base), and only what the server still holds as it
 * was comes back (restoreOutbox): an answer saved since on another device
 * — or by a page of an older build after a rollback, which never reads
 * the outbox — is newer, and stays. An answer whose save's answer was
 * lost may have been written, so beside its base the entry keeps what the
 * server holds if it was (`alt`): either comes back. Nothing of a learner stays in the tab
 * once the store lets go of them (signed out, another account, erased):
 * every entry is cleared then (clearEveryOutbox), at the cost of what a
 * page from a build that was gone hadn't sent yet.
 *
 * Pure but for the storage handed in, and never throws: a browser that
 * blocks storage keeps nothing here, which leaves the answers on the page.
 */

import { isSectionId } from "@/lib/cms/sections/contract";
import type { PatchAnswer, ProgressPatch, ProgressState, StoredAnswer } from "@/lib/learner-progress/contract";
import { readAnswer } from "@/lib/learner-progress/parse";
import { baseOf, restorablePatch } from "@/lib/learner-progress/patch";

export const OUTBOX_PREFIX = "seq-elevate-outbox-v1:";

/** The part of the Web Storage API the outbox uses: the store hands in sessionStorage. */
export type OutboxStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The entry for `forUser` (whose data the store holds, see session-owner.ts) and course `slug`. */
export const outboxKey = (forUser: string, slug: string) => `${OUTBOX_PREFIX}${forUser}:${slug}`;

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

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

/** What the server held of each answer of an entry's patch, as kept beside it: what reads as an answer, else none. */
function readBase(raw: unknown, patch: ProgressPatch): Record<string, StoredAnswer | null> {
  const base = isRecord(raw) && isRecord(raw.base) ? raw.base : {};
  return Object.fromEntries(
    Object.keys(patch.answers ?? {}).map((key) => [key, (readAnswer(key, base[key]) as StoredAnswer | null) ?? null])
  );
}

/** What the server holds of an answer of the patch if a save of it whose answer was lost was written: only those kept. */
function readAlt(raw: unknown, patch: ProgressPatch): Record<string, StoredAnswer | null> {
  const alt = isRecord(raw) && isRecord(raw.alt) ? raw.alt : {};
  return Object.fromEntries(
    Object.keys(patch.answers ?? {})
      .filter((key) => key in alt)
      .map((key) => [key, (readAnswer(key, alt[key]) as StoredAnswer | null) ?? null])
  );
}

interface Entry {
  patch: ProgressPatch;
  base: Record<string, StoredAnswer | null>;
  /** For an answer whose save's answer was lost: what the server holds if it was written. */
  alt: Record<string, StoredAnswer | null>;
}

function readEntry(storage: OutboxStorage | null, forUser: string, slug: string): Entry | null {
  try {
    const raw = storage?.getItem(outboxKey(forUser, slug));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const patch = readPatch(parsed);
    return patch ? { patch, base: readBase(parsed, patch), alt: readAlt(parsed, patch) } : null;
  } catch {
    return null;
  }
}

function writeEntry(storage: OutboxStorage, forUser: string, slug: string, entry: Entry): boolean {
  try {
    const alt = Object.keys(entry.alt).length ? { alt: entry.alt } : {};
    storage.setItem(outboxKey(forUser, slug), JSON.stringify({ ...entry.patch, base: entry.base, ...alt }));
    return true;
  } catch {
    return false;
  }
}

/** The patch waiting for `forUser` in `slug`, or null: none, unreadable, or no storage. */
export function readOutbox(
  storage: OutboxStorage | null,
  forUser: string,
  slug: string
): ProgressPatch | null {
  return readEntry(storage, forUser, slug)?.patch ?? null;
}

/**
 * What the outbox brings back for `forUser` in `slug` over what the server
 * holds now (`server`, the progress just loaded): its finished lessons and
 * completion, and each answer the server still holds as it was when the
 * entry was kept, or as a lost save of it would have left it
 * (restorablePatch) — never one over an answer saved elsewhere since.
 * What can't come back is dropped from the entry for good, and an entry
 * with nothing left is cleared. Null when nothing comes back.
 */
export function restoreOutbox(
  storage: OutboxStorage | null,
  forUser: string,
  slug: string,
  server: ProgressState
): ProgressPatch | null {
  const entry = readEntry(storage, forUser, slug);
  if (!entry || !storage) return null;
  const patch = restorablePatch(entry.patch, entry.base, server, entry.alt);
  if (!patch) {
    clearOutbox(storage, forUser, slug);
    return null;
  }
  if (JSON.stringify(patch) !== JSON.stringify(entry.patch)) {
    const keys = Object.keys(patch.answers ?? {});
    writeEntry(storage, forUser, slug, {
      patch,
      base: Object.fromEntries(keys.map((key) => [key, entry.base[key] ?? null])),
      alt: Object.fromEntries(keys.filter((key) => key in entry.alt).map((key) => [key, entry.alt[key] ?? null])),
    });
  }
  return patch;
}

/**
 * Keeps `patch` as what waits for `forUser` in `slug`: all the page sending
 * it has that the server hasn't confirmed, worked out against `acked`
 * (what the server is known to hold), which is kept beside it as each
 * answer's base (baseOf). `ifWritten` is what the server holds if every
 * save whose answer was lost was written: kept beside an answer where it
 * differs from the base (`alt`). It takes the place of what waited, which
 * that page took in when it loaded the course, or which it changed since —
 * merged in, an answer changed since would come back after the reload.
 * Fill mode is never kept: only the move of a guest's progress sends it.
 * False when it couldn't be kept (no storage, or the browser refused it):
 * the answers are then only on the page.
 */
export function putInOutbox(
  storage: OutboxStorage | null,
  forUser: string,
  slug: string,
  patch: ProgressPatch,
  acked?: ProgressState,
  ifWritten?: ProgressState
): boolean {
  if (!storage) return false;
  const { fill: _fill, ...own } = patch;
  void _fill;
  const base = acked ? baseOf(own, acked) : {};
  const written = ifWritten ? baseOf(own, ifWritten) : {};
  const alt = Object.fromEntries(
    Object.entries(written).filter(([key, answer]) => JSON.stringify(answer) !== JSON.stringify(base[key] ?? null))
  );
  return writeEntry(storage, forUser, slug, { patch: own, base, alt });
}

/** Forgets what waits for `forUser` in `slug`: the server has it, or the learner changed it since. */
export function clearOutbox(storage: OutboxStorage | null, forUser: string, slug: string): void {
  try {
    storage?.removeItem(outboxKey(forUser, slug));
  } catch {
    /* nothing kept, nothing to clear */
  }
}

/**
 * Forgets every entry in the tab, whoever's: the learner store has let go
 * of its learner (signed out, another account signed in, the account
 * erased), and nothing of theirs — reflection text included — stays in the
 * tab for whoever uses it next. Never throws.
 */
export function clearEveryOutbox(storage: Pick<Storage, "length" | "key" | "removeItem"> | null): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(OUTBOX_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    /* nothing kept, nothing to clear */
  }
}
