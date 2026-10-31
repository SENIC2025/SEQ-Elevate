import { describe, it, expect, afterEach, vi } from "vitest";
import { ownFileHost } from "./own-file-host";

/*
 * Release 4 spec 3.2 (U1): which setting names our own file store's host.
 * The public one (filled from BLOB_PUBLIC_HOST when the site is built, so
 * the browser has it) wins; then the server's own; blank counts as unset.
 */

describe("ownFileHost", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("takes the public variable first, then the server's, else none", () => {
    expect(ownFileHost({ NEXT_PUBLIC_BLOB_PUBLIC_HOST: "a.public.blob.vercel-storage.com", BLOB_PUBLIC_HOST: "b.example" })).toBe(
      "a.public.blob.vercel-storage.com"
    );
    expect(ownFileHost({ BLOB_PUBLIC_HOST: "b.public.blob.vercel-storage.com" })).toBe("b.public.blob.vercel-storage.com");
    expect(ownFileHost({})).toBeNull();
  });

  it("counts a blank value as unset (the build writes an empty public variable when the host isn't set)", () => {
    expect(ownFileHost({ NEXT_PUBLIC_BLOB_PUBLIC_HOST: "", BLOB_PUBLIC_HOST: "b.example" })).toBe("b.example");
    expect(ownFileHost({ NEXT_PUBLIC_BLOB_PUBLIC_HOST: "  ", BLOB_PUBLIC_HOST: " " })).toBeNull();
    expect(ownFileHost({ BLOB_PUBLIC_HOST: " b.example " })).toBe("b.example");
  });

  it("reads the process's environment when given none, at the time it is asked", () => {
    vi.stubEnv("NEXT_PUBLIC_BLOB_PUBLIC_HOST", "");
    vi.stubEnv("BLOB_PUBLIC_HOST", "c.public.blob.vercel-storage.com");
    expect(ownFileHost()).toBe("c.public.blob.vercel-storage.com");
    vi.stubEnv("NEXT_PUBLIC_BLOB_PUBLIC_HOST", "d.public.blob.vercel-storage.com");
    expect(ownFileHost()).toBe("d.public.blob.vercel-storage.com");
    vi.stubEnv("NEXT_PUBLIC_BLOB_PUBLIC_HOST", "");
    vi.stubEnv("BLOB_PUBLIC_HOST", "");
    expect(ownFileHost()).toBeNull();
  });
});

describe("next.config.ts (spec 3.2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** next.config.ts as the build reads it, with the environment as it is now. */
  const built = async () => {
    vi.resetModules();
    return (await import("../../../next.config")).default;
  };

  it("gives the browser the server's BLOB_PUBLIC_HOST as NEXT_PUBLIC_BLOB_PUBLIC_HOST when the site is built, blank while it isn't set", async () => {
    vi.stubEnv("BLOB_PUBLIC_HOST", "e.public.blob.vercel-storage.com");
    const config = await built();
    expect(config.env).toEqual({ NEXT_PUBLIC_BLOB_PUBLIC_HOST: "e.public.blob.vercel-storage.com" });
    expect(ownFileHost(config.env)).toBe("e.public.blob.vercel-storage.com");

    vi.stubEnv("BLOB_PUBLIC_HOST", undefined);
    const unset = await built();
    expect(unset.env).toEqual({ NEXT_PUBLIC_BLOB_PUBLIC_HOST: "" });
    expect(ownFileHost(unset.env)).toBeNull();
  });
});
