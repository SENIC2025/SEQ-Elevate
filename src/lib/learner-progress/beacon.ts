/**
 * A learner's course and Comp Card saves sent as the page goes (D37 as
 * built, 24 October).
 *
 * Next sends a page's server actions one at a time: a course or Comp Card
 * save handed over while another is on its way waits behind it, and one
 * waiting never leaves a page that goes. So on `pagehide` the learner
 * store sends what the server hasn't confirmed of the Comp Card while a
 * save of it is on its way or failed (card-save.ts cardBeacon), and of
 * each course with a save on its way or failed (course-save.ts
 * progressBeacons), to POST BEACON_PATH with fetch(keepalive), which the
 * browser finishes after the page has gone
 * (src/app/api/progress/beacon/route.ts). The route saves each through
 * the save action's own code.
 *
 * A body is one course's patch, `{ v: 1, slug, forUser, patch }`, or the
 * Comp Card's fields, `{ v: 1, forUser, card }`, for the learner the save
 * was made for; never both. Browsers allow keepalive requests in flight
 * 64 KiB of body in all, so the page sends at most BEACON_BUDGET_BYTES,
 * the card and every course together, and the route reads no further than
 * BEACON_MAX_BYTES.
 *
 * Pure: the store and the route both use it.
 */

import { COMP_CARD_FIELDS } from "@/lib/comp-card-visibility";
import { RESPONSE_LIMITS, type ProgressPatch } from "./contract";
import { fitPatch } from "./patch";

export const BEACON_PATH = "/api/progress/beacon";

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

/** The most of a body the route reads, in bytes. */
export const BEACON_MAX_BYTES = 64 * 1024;

/**
 * The most a page sends this way as it goes, in bytes, the Comp Card and
 * every course together: under the 64 KiB browsers allow keepalive
 * requests in flight, which others the page sends then may share.
 */
export const BEACON_BUDGET_BYTES = 48 * 1024;

/** One course's save as the route reads it: the patch is read as the save action reads one. */
export interface BeaconSave {
  slug: string;
  forUser: string;
  patch: unknown;
}

/** The body of one course's save, for the learner it was made for. */
export function beaconBody(slug: string, forUser: string, patch: ProgressPatch): string {
  return JSON.stringify({ v: 1, slug, forUser, patch });
}

/** A Comp Card save as the route reads it: the fields are read as the card's save action reads them. */
export interface CardBeaconSave {
  forUser: string;
  card: unknown;
}

/** The Comp Card's fields a save sends, as the page has them (CompCardInput's, without who sees the card). */
export interface CardBeaconFields {
  wentWell?: string;
  difficult?: string;
  improve?: string;
  behaviour?: string;
  confidence?: number;
}

const asBody = (raw: unknown): Record<string, unknown> | null =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw as Record<string, unknown>).v === 1
    ? (raw as Record<string, unknown>)
    : null;

/** A body read as JSON, as a course save: null when it isn't one (a Comp Card's body included). */
export function readBeaconBody(raw: unknown): BeaconSave | null {
  const body = asBody(raw);
  if (!body || typeof body.slug !== "string" || typeof body.forUser !== "string" || !("patch" in body) || "card" in body) {
    return null;
  }
  return { slug: body.slug, forUser: body.forUser, patch: body.patch };
}

/** The body of the Comp Card's save, for the learner it was made for. */
export function cardBeaconBody(forUser: string, card: CardBeaconFields): string {
  return JSON.stringify({ v: 1, forUser, card });
}

/** A body read as JSON, as a Comp Card save: null when it isn't one (a course's body included). */
export function readCardBeaconBody(raw: unknown): CardBeaconSave | null {
  const body = asBody(raw);
  if (!body || typeof body.forUser !== "string" || !("card" in body) || "slug" in body || "patch" in body) return null;
  return { forUser: body.forUser, card: body.card };
}

/**
 * The body of the Comp Card's `card` within `maxBytes` (UTF-8): the
 * confidence and each text in the card's order while the body still fits,
 * a text that doesn't left out. Null when nothing fits.
 */
export function fitCardBeacon(
  forUser: string,
  card: CardBeaconFields,
  maxBytes: number
): { body: string; bytes: number } | null {
  const fitted: CardBeaconFields = {};
  let best: { body: string; bytes: number } | null = null;
  for (const field of ["confidence", ...COMP_CARD_FIELDS] as const) {
    if (card[field] === undefined) continue;
    const next = { ...fitted, [field]: card[field] };
    const body = cardBeaconBody(forUser, next);
    const bytes = utf8Bytes(body);
    if (bytes > maxBytes) continue;
    Object.assign(fitted, next);
    best = { body, bytes };
  }
  return best;
}

/**
 * The body of `patch` for `slug` within `maxBytes` (UTF-8): as much of it
 * as fits, taken as a save takes it (fitPatch: never what the server
 * would refuse; keys, lessons and questions in order). Null when nothing
 * fits.
 */
export function fitBeacon(
  slug: string,
  forUser: string,
  patch: ProgressPatch,
  maxBytes: number
): { body: string; bytes: number } | null {
  let chars = Math.min(RESPONSE_LIMITS.patchJsonChars, maxBytes - utf8Bytes(beaconBody(slug, forUser, { v: 2 })));
  // A character takes one to three bytes: the patch is fitted to a length
  // in characters, measured, and fitted again shorter while it is over.
  for (let tries = 0; tries < 6 && chars > 0; tries++) {
    const fitted = fitPatch(patch, chars).patch;
    if (!fitted) return null;
    const body = beaconBody(slug, forUser, fitted);
    const bytes = utf8Bytes(body);
    if (bytes <= maxBytes) return { body, bytes };
    chars = Math.floor((chars * maxBytes) / bytes) - 16;
  }
  return null;
}
