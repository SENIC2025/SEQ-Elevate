/**
 * The exact host of our own file store, for checkLinkHref's `ownFile`
 * (link-url.ts; D103), or null while it isn't known.
 *
 * On the server it is BLOB_PUBLIC_HOST (Release 3's setting: the host our
 * uploads are served from; not a secret), read when it is asked for. In the
 * browser only a NEXT_PUBLIC_ variable exists, which next.config.ts fills
 * from BLOB_PUBLIC_HOST when the site is built. While neither is set,
 * checkLinkHref counts every Vercel Blob store as ours.
 *
 * Every caller that refuses links to our own files passes
 * `{ ownFileHost: ownFileHost() }`.
 */

type Env = Record<string, string | undefined>;

const setting = (value: string | undefined) => value?.trim() || null;

/**
 * NEXT_PUBLIC_BLOB_PUBLIC_HOST, else BLOB_PUBLIC_HOST, else null; a blank
 * value counts as unset. `env` is for tests: without it the variables are
 * named in full, so the build can put the public one into browser code.
 */
export function ownFileHost(env?: Env): string | null {
  if (env) return setting(env.NEXT_PUBLIC_BLOB_PUBLIC_HOST) ?? setting(env.BLOB_PUBLIC_HOST);
  return setting(process.env.NEXT_PUBLIC_BLOB_PUBLIC_HOST) ?? setting(process.env.BLOB_PUBLIC_HOST);
}
