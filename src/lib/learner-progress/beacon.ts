/**
 * A learner's course save sent as the page goes (D37 as built, 24 October).
 *
 * Next sends a page's server actions one at a time: a course save handed
 * over while another is on its way waits behind it, and one waiting never
 * leaves a page that goes. So on `pagehide` the learner store sends what
 * the server hasn't confirmed of each course with a save on its way or
 * failed (course-save.ts progressBeacons) to POST BEACON_PATH with
 * fetch(keepalive), which the browser finishes after the page has gone
 * (src/app/api/progress/beacon/route.ts). The route saves it through the
 * save action's own code.
 *
 * The body is one course's patch, for the learner the save was made for:
 * `{ v: 1, slug, forUser, patch }`. Browsers allow keepalive requests in
 * flight 64 KiB of body in all, so the page sends at most
 * BEACON_BUDGET_BYTES, every course together, and the route reads no
 * further than BEACON_MAX_BYTES.
 *
 * Pure: the store and the route both use it.
 */

import { RESPONSE_LIMITS, type ProgressPatch } from "./contract";
import { fitPatch } from "./patch";

export const BEACON_PATH = "/api/progress/beacon";

/** The most of a body the route reads, in bytes. */
export const BEACON_MAX_BYTES = 64 * 1024;

/**
 * The most a page sends this way as it goes, in bytes, every course
 * together: under the 64 KiB browsers allow keepalive requests in flight,
 * which others the page sends then may share.
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

/** A body read as JSON, as a save: null when it isn't one. */
export function readBeaconBody(raw: unknown): BeaconSave | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (body.v !== 1 || typeof body.slug !== "string" || typeof body.forUser !== "string" || !("patch" in body)) {
    return null;
  }
  return { slug: body.slug, forUser: body.forUser, patch: body.patch };
}

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

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
