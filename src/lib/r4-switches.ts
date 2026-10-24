/**
 * Release 4's kill switches (spec 7.1): server environment variables, read
 * on every call like Release 2's and Release 3's (cms/sections/switches.ts,
 * r3-switches.ts), so a changed value takes effect on the next request of a
 * redeploy. Server-side only: the browser has no such variables.
 *
 *   R4_FURTHER_READING=off  learners and preview get no further-reading list
 *                           and no references link, and the references page
 *                           answers "not found". Editors keep editing;
 *                           nothing is deleted.
 *   R4_ITEM_LANGUAGE=off    every published document and further-reading
 *                           link shows in every language (as documents did
 *                           before Release 4).
 *
 * Each is on unless its variable says exactly "off" (any case, spaces
 * ignored). Nothing switches off the address check, the server-side
 * filtering of drafts, or links being hidden until shown (D111).
 */

type Env = Record<string, string | undefined>;

const off = (value: string | undefined) => value?.trim().toLowerCase() === "off";

/** Further reading and references reach learners, unless R4_FURTHER_READING=off. */
export function furtherReadingOn(env: Env = process.env): boolean {
  return !off(env.R4_FURTHER_READING);
}

/** Documents and links follow their languages for learners, unless R4_ITEM_LANGUAGE=off. */
export function itemLanguageOn(env: Env = process.env): boolean {
  return !off(env.R4_ITEM_LANGUAGE);
}
