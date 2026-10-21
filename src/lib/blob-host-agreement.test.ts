import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy } from "./security-headers";
import { mediaHostProblem } from "./media-url";

/*
 * Release 3 (D91, D95; spec 10.3, 13.7): one setting, BLOB_PUBLIC_HOST,
 * decides two things in two files: which Blob store the content security
 * policy lets the browser load from (security-headers.ts, Stream F), and
 * which uploads a lesson may save (media-url.ts, Stream E). They must agree
 * for every value the setting can hold: a store the policy admits but the
 * save refuses is harmless, but a store the save accepts and the policy
 * blocks shows learners a broken video, and a store the policy admits that
 * isn't ours lets any Vercel customer's files into our pages. So for each
 * value and environment, an upload on our store and one on another store
 * are admitted by the policy exactly when the save accepts them.
 */

const OURS = "abc123.public.blob.vercel-storage.com";
const OTHER = "other456.public.blob.vercel-storage.com";
const APP = "https://app.example.test";

/** The values BLOB_PUBLIC_HOST can be given: right, unset, and written wrongly. */
const VALUES: (string | undefined)[] = [
  undefined,
  "",
  OURS,
  `  ${OURS.toUpperCase()}  `,
  `https://${OURS}`,
  `https://${OURS}/`,
  `${OURS}/uploads`,
  `${OURS}:443`,
  "*.public.blob.vercel-storage.com",
];

const ENVIRONMENTS: (string | undefined)[] = ["production", "preview", undefined];

/** Does the policy let the browser load an image, a video and a frame from `host`? */
function policyAdmits(env: Record<string, string | undefined>, host: string): boolean {
  const policy = contentSecurityPolicy(env, { warn: () => {} });
  const directive = (name: string) =>
    (policy.split("; ").find((d) => d.startsWith(`${name} `)) ?? "").split(" ").slice(1);
  const admits = (sources: string[]) =>
    sources.some(
      (s) =>
        s === `https://${host}` ||
        (s.startsWith("https://*.") && host.endsWith(s.slice("https://*".length)))
    );
  const media = admits(directive("media-src"));
  // One answer for every place an upload shows.
  expect(admits(directive("img-src")), `img-src and media-src disagree on ${host}`).toBe(media);
  expect(admits(directive("frame-src")), `frame-src and media-src disagree on ${host}`).toBe(media);
  return media;
}

/** Does a lesson accept a video uploaded to `host`? */
const saveAccepts = (env: Record<string, string | undefined>, host: string) =>
  mediaHostProblem(`https://${host}/lesson/clip.mp4`, APP, env) === null;

describe("BLOB_PUBLIC_HOST: the content security policy and the media rule agree", () => {
  beforeAll(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  for (const vercelEnv of ENVIRONMENTS) {
    for (const value of VALUES) {
      const env = { BLOB_PUBLIC_HOST: value, VERCEL_ENV: vercelEnv };
      it(`VERCEL_ENV=${vercelEnv ?? "unset"}, BLOB_PUBLIC_HOST=${JSON.stringify(value ?? null)}`, () => {
        for (const host of [OURS, OTHER]) {
          expect(policyAdmits(env, host), `an upload on ${host}`).toBe(saveAccepts(env, host));
        }
      });
    }
  }

  it("a URL-shaped value admits no store in either: the policy names none, the save refuses every upload", () => {
    for (const vercelEnv of ENVIRONMENTS) {
      for (const value of [`https://${OURS}`, `${OURS}/uploads`, "*.public.blob.vercel-storage.com"]) {
        const env = { BLOB_PUBLIC_HOST: value, VERCEL_ENV: vercelEnv };
        expect(contentSecurityPolicy(env, { warn: () => {} })).not.toContain("blob.vercel-storage.com");
        expect(saveAccepts(env, OURS)).toBe(false);
        expect(saveAccepts(env, OTHER)).toBe(false);
      }
    }
  });

  it("on production with the setting unset, neither admits any store", () => {
    const env = { VERCEL_ENV: "production" };
    expect(contentSecurityPolicy(env, { warn: () => {} })).not.toContain("blob.vercel-storage.com");
    expect(mediaHostProblem(`https://${OURS}/clip.mp4`, APP, env)).toBe("host-unconfigured");
  });

  it("with one host name, both admit that store and no other", () => {
    for (const vercelEnv of ENVIRONMENTS) {
      const env = { BLOB_PUBLIC_HOST: OURS, VERCEL_ENV: vercelEnv };
      expect(policyAdmits(env, OURS)).toBe(true);
      expect(saveAccepts(env, OURS)).toBe(true);
      expect(policyAdmits(env, OTHER)).toBe(false);
      expect(saveAccepts(env, OTHER)).toBe(false);
    }
  });
});
