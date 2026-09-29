/**
 * "Has this stored JSON changed since I read it?" — for saves that must not
 * overwrite someone else's newer save unseen (D33). Pure and unit-tested;
 * safe on both sides, so the server and the course page agree exactly.
 *
 * A lesson's interactive stage and its texts are single JSON columns holding
 * every language. Two partners can have the same lesson open at once; without
 * a check, the later save silently puts back whatever the earlier one changed.
 *
 * Compared as JSON, not as JS objects: Postgres's jsonb reorders keys, and
 * JSON drops `undefined` fields — neither is a change.
 */

/** JSON text with every object's keys sorted: equal data, equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          )
        )
      : v
  );
}

/** The same data as stored JSON (key order and undefined fields aside)? */
export function sameStoredJson(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * A short fingerprint of a stored value, or null when nothing is stored. The
 * page hands it back with a save, so the server can tell whether what it
 * holds is still what the editor started from — without sending the whole
 * text back and forth. (cyrb53: a fast 53-bit string hash; this detects
 * edits, it isn't a security check.)
 */
export function fingerprint(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = canonicalJson(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Thrown inside a save's transaction when what's stored is no longer what the
 * editor started from — throwing rolls the transaction back, so a refused
 * save leaves no trace. The action turns it into "changed-elsewhere".
 */
export class ChangedElsewhere extends Error {
  constructor() {
    super("changed-elsewhere");
    this.name = "ChangedElsewhere";
  }
}
