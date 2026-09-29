/**
 * Finds the Vercel Blob read-write token in the environment.
 *
 * Connecting a Blob store to the Vercel project normally injects
 * BLOB_READ_WRITE_TOKEN. When the store is connected with a custom environment
 * variable prefix, the token arrives under another name instead (e.g.
 * FILES_READ_WRITE_TOKEN or FILES_BLOB_READ_WRITE_TOKEN) — and @vercel/blob,
 * which reads only BLOB_READ_WRITE_TOKEN, fails with "No read-write token
 * found". The upload routes resolve the token here and pass it explicitly as
 * the `token` option, so uploads work with either naming.
 *
 * Only values shaped like a Blob read-write token (vercel_blob_rw_…) count,
 * so an unrelated *_READ_WRITE_TOKEN is never picked up, and NEXT_PUBLIC_
 * variables are ignored (a secret must never be configured as public).
 * describeBlobToken() reports where the token came from without revealing its
 * value or variable name, for the storage status endpoint.
 *
 * Pure: takes the environment as an argument (defaulting to process.env).
 */

const TOKEN_PREFIX = "vercel_blob_rw_";
const STANDARD_NAME = "BLOB_READ_WRITE_TOKEN";
const NAME_SUFFIX = "READ_WRITE_TOKEN";

type Env = Readonly<Record<string, string | undefined>>;

export type BlobTokenSource = "standard" | "prefixed" | "missing";

/** The trimmed value if it looks like a Blob read-write token, else undefined. */
function asBlobToken(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && v.startsWith(TOKEN_PREFIX) && v.length > TOKEN_PREFIX.length
    ? v
    : undefined;
}

function findBlobToken(
  env: Env
): { token: string; source: Exclude<BlobTokenSource, "missing"> } | null {
  const standard = asBlobToken(env[STANDARD_NAME]);
  if (standard) return { token: standard, source: "standard" };
  // Custom prefixes: first matching name in sorted order, so the choice is
  // deterministic if a project ever has more than one.
  const names = Object.keys(env)
    .filter(
      (n) =>
        n !== STANDARD_NAME &&
        n.endsWith(NAME_SUFFIX) &&
        !n.startsWith("NEXT_PUBLIC_")
    )
    .sort();
  for (const name of names) {
    const token = asBlobToken(env[name]);
    if (token) return { token, source: "prefixed" };
  }
  return null;
}

/** The Blob read-write token to pass as `token` to @vercel/blob, if any. */
export function resolveBlobToken(env: Env = process.env): string | undefined {
  return findBlobToken(env)?.token;
}

/** Whether uploads can be stored, and which naming supplied the token. */
export function describeBlobToken(env: Env = process.env): {
  ready: boolean;
  source: BlobTokenSource;
} {
  const found = findBlobToken(env);
  return found
    ? { ready: true, source: found.source }
    : { ready: false, source: "missing" };
}
