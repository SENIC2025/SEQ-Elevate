/**
 * What the learner store sends (D62.b, spec 5.4): a patch holding only
 * what changed since the last save the server confirmed.
 *
 * The store keeps, per course, what the server is known to have (`acked`)
 * and what the learner has now (`latest`). A save works out
 * patchSince(acked, latest) when it is SENT, not when it is scheduled, so a
 * retry or a newer save always carries everything not confirmed yet; once
 * confirmed, applyPatch moves `acked` on by what was sent (less what the
 * server refused, withoutRefused). A value changed back while a save was on
 * its way then differs from `acked` again and is sent again; so is the
 * newer value when confirmations come back out of order.
 *
 * A reflection or rating is sent question by question, so two tabs
 * answering different questions keep both (the server merges per field).
 * fitPatch holds back what the server would refuse (parse.ts, the same
 * rules) — a reflection over the length limit loses only that question —
 * and splits a patch at the size limits, a reflection or rating with more
 * questions than one save may carry included; the rest goes in the next
 * save.
 *
 * Pure and client-safe.
 */

import { isSectionId, type PartKey } from "@/lib/cms/sections/contract";
import {
  LEGACY_PROMPT_IDS,
  RESPONSE_LIMITS,
  type PatchAnswer,
  type ProgressPatch,
  type ProgressState,
  type RefusedKey,
  type StoredAnswer,
} from "./contract";
import { completeLesson, withAnswer } from "./answers";
import { checkAnswer } from "./parse";

/** A course nobody has done anything in: what the server has before a first save. */
export const EMPTY_PROGRESS: ProgressState = Object.freeze({
  stagesCompleted: [],
  sectionsCompleted: [],
  simulation: null,
  scenario: { root: null, followup: null, rootLabel: null, followupLabel: null },
  reflection: { p1: "", p2: "", p3: "" },
  assessment: { answers: {}, checked: false },
  responses: {},
  completedAt: null,
}) as ProgressState;

/** Values compared as JSON with object keys in order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/**
 * Every answer the progress holds, by key, as it would be sent. Unlike the
 * players' answersOf, the standard reflection and quick check are always
 * there: emptying one is a change too.
 */
function sendable(p: ProgressState): Map<PartKey, StoredAnswer> {
  const out = new Map<PartKey, StoredAnswer>();
  if (p.simulation) {
    out.set("simulation/main", { type: "practice", optionId: p.simulation.choice, correct: p.simulation.correct });
  }
  if (p.scenario.root) {
    out.set("scenario/main", {
      type: "scenario",
      rootId: p.scenario.root,
      ...(p.scenario.followup ? { followupId: p.scenario.followup } : {}),
    });
  }
  out.set("reflection/main", {
    type: "reflection",
    text: Object.fromEntries(LEGACY_PROMPT_IDS.map((id) => [id, p.reflection[id]])),
  });
  out.set("assessment/main", { type: "quiz", answers: p.assessment.answers, checked: p.assessment.checked });
  for (const [key, answer] of Object.entries(p.responses) as [PartKey, StoredAnswer & { retaken?: true }][]) {
    if (!answer) continue;
    if (answer.type === "quiz") out.set(key, { type: "quiz", answers: answer.answers, checked: answer.checked });
    else out.set(key, answer);
  }
  return out;
}

/** The fields of `now` that differ from `before`'s (all of them when `before` is another type). */
function changedFields<V>(now: Record<string, V>, before: Record<string, V> | undefined): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [field, value] of Object.entries(now)) {
    if (!before || before[field] !== value) out[field] = value;
  }
  return out;
}

/** What `latest` holds that the server (`acked`) doesn't: null when nothing. */
export function patchSince(acked: ProgressState, latest: ProgressState): ProgressPatch | null {
  const had = new Set([...acked.stagesCompleted, ...acked.sectionsCompleted]);
  const completed = [...latest.stagesCompleted, ...latest.sectionsCompleted].filter(
    (id, i, all) => !had.has(id) && all.indexOf(id) === i
  );

  const before = sendable(acked);
  const answers: Record<string, PatchAnswer> = {};
  for (const [key, now] of sendable(latest)) {
    const old = before.get(key);
    if (now.type === "reflection") {
      const text = changedFields(now.text, old?.type === "reflection" ? old.text : undefined);
      if (Object.keys(text).length) answers[key] = { type: "reflection", text };
    } else if (now.type === "rating") {
      const values = changedFields(now.values, old?.type === "rating" ? old.values : undefined);
      if (Object.keys(values).length) answers[key] = { type: "rating", values };
    } else if (!same(now, old)) {
      answers[key] = now;
    }
  }

  const completedAt = latest.completedAt && !acked.completedAt ? latest.completedAt : undefined;
  if (!completed.length && !Object.keys(answers).length && !completedAt) return null;
  return {
    v: 2,
    ...(completed.length ? { completed } : {}),
    ...(Object.keys(answers).length ? { answers } : {}),
    ...(completedAt ? { completedAt } : {}),
  };
}

/**
 * `acked` once the server has confirmed `patch`: merged as the server
 * merges it (merge-server.ts), minus fill mode, which the store never
 * tracks this way.
 */
export function applyPatch<T extends ProgressState>(acked: T, patch: ProgressPatch): T {
  let out = acked;
  for (const id of patch.completed ?? []) {
    if (isSectionId(id)) out = completeLesson(out, id);
  }
  for (const [key, answer] of Object.entries(patch.answers ?? {})) {
    out = withAnswer(out, key as PartKey, answer);
  }
  if (patch.completedAt && !out.completedAt) out = { ...out, completedAt: patch.completedAt };
  return out;
}

/** `patch` without what the server refused: those aren't saved, so they aren't confirmed. */
export function withoutRefused(patch: ProgressPatch, refused: readonly RefusedKey[]): ProgressPatch {
  const keys = new Set(refused.map((r) => r.key));
  const out: ProgressPatch = { ...patch };
  if (patch.completed) out.completed = patch.completed.filter((id) => !keys.has(id));
  if (patch.answers) {
    out.answers = Object.fromEntries(Object.entries(patch.answers).filter(([key]) => !keys.has(key)));
  }
  return out;
}

export interface FittedPatch {
  /** What to send now; null when nothing can be. */
  patch: ProgressPatch | null;
  /** What the server would refuse: not sent (the learner is told). */
  held: RefusedKey[];
  /** More is left for the next save. */
  more: boolean;
}

/**
 * The part of `patch` to send now: without what the server would refuse,
 * and within the limits of one patch — its JSON length, its number of keys
 * and of finished lessons, the questions of one reflection or rating. Keys,
 * lessons and questions are taken in order; what doesn't fit is left for
 * the next save (patchSince still holds it).
 */
export function fitPatch(patch: ProgressPatch, maxChars: number = RESPONSE_LIMITS.patchJsonChars): FittedPatch {
  const held: RefusedKey[] = [];
  let more = false;

  const valid = (patch.completed ?? []).filter((id) => {
    if (isSectionId(id)) return true;
    held.push({ key: id, reason: "invalid" });
    return false;
  });
  if (valid.length > RESPONSE_LIMITS.completedPerPatch) more = true;
  const completed = valid.slice(0, RESPONSE_LIMITS.completedPerPatch);

  const head: ProgressPatch = {
    v: 2,
    ...(completed.length ? { completed } : {}),
    ...(patch.completedAt ? { completedAt: patch.completedAt } : {}),
    ...(patch.fill ? { fill: true as const } : {}),
  };
  // `"answers":{}` and its comma are only there once an answer is.
  let length = JSON.stringify(head).length + ',"answers":{}'.length;
  const answers: Record<string, PatchAnswer> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(patch.answers ?? {})) {
    let answer = raw;
    // More questions than one save may carry (an editor swapped one of a
    // live question's, D33, and the learner answered the new one too): a
    // save's worth now, the rest in the next.
    if (answer?.type === "reflection") {
      // Only the questions over the length limit stay behind.
      const fits = Object.entries(answer.text).filter(([, t]) => t.length <= RESPONSE_LIMITS.reflectionChars);
      if (fits.length < Object.keys(answer.text).length) {
        held.push({ key, reason: "too-long" });
        if (!fits.length) continue;
      }
      if (fits.length > RESPONSE_LIMITS.promptsPerAnswer) more = true;
      answer = { type: "reflection", text: Object.fromEntries(fits.slice(0, RESPONSE_LIMITS.promptsPerAnswer)) };
    } else if (answer?.type === "rating") {
      const values = Object.entries(answer.values);
      if (values.length > RESPONSE_LIMITS.statementsPerAnswer) {
        more = true;
        answer = { type: "rating", values: Object.fromEntries(values.slice(0, RESPONSE_LIMITS.statementsPerAnswer)) };
      }
    }
    const checked = checkAnswer(key, answer);
    if (!checked.ok) {
      held.push({ key, reason: checked.reason });
      continue;
    }
    const entry = JSON.stringify(key).length + 1 + JSON.stringify(checked.answer).length + (count ? 1 : 0);
    if (count >= RESPONSE_LIMITS.keysPerPatch || length + entry > maxChars) {
      more = true;
      continue;
    }
    answers[key] = checked.answer;
    length += entry;
    count++;
  }

  const out: ProgressPatch = { ...head, ...(count ? { answers } : {}) };
  const empty = !out.completed && !out.answers && !out.completedAt;
  return { patch: empty ? null : out, held, more };
}
