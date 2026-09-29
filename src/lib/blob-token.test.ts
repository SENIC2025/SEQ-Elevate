import { describe, it, expect } from "vitest";
import { resolveBlobToken, describeBlobToken } from "./blob-token";

// Obviously fake values — shaped like Blob tokens, never real ones.
const STANDARD = "vercel_blob_rw_TESTSTORE_fake";
const PREFIXED = "vercel_blob_rw_OTHERSTORE_fake";

describe("resolveBlobToken", () => {
  it("uses BLOB_READ_WRITE_TOKEN when it is set", () => {
    expect(resolveBlobToken({ BLOB_READ_WRITE_TOKEN: STANDARD })).toBe(
      STANDARD
    );
  });

  it("prefers the standard name over a prefixed one", () => {
    expect(
      resolveBlobToken({
        FILES_READ_WRITE_TOKEN: PREFIXED,
        BLOB_READ_WRITE_TOKEN: STANDARD,
      })
    ).toBe(STANDARD);
  });

  it("finds a token connected with a custom prefix", () => {
    expect(resolveBlobToken({ FILES_READ_WRITE_TOKEN: PREFIXED })).toBe(
      PREFIXED
    );
    expect(resolveBlobToken({ FILES_BLOB_READ_WRITE_TOKEN: PREFIXED })).toBe(
      PREFIXED
    );
  });

  it("falls back to a prefixed token when the standard one is malformed", () => {
    expect(
      resolveBlobToken({
        BLOB_READ_WRITE_TOKEN: "not-a-blob-token",
        STORE_READ_WRITE_TOKEN: PREFIXED,
      })
    ).toBe(PREFIXED);
  });

  it("picks the first matching name in sorted order", () => {
    expect(
      resolveBlobToken({
        ZED_READ_WRITE_TOKEN: "vercel_blob_rw_ZED_fake",
        ALPHA_READ_WRITE_TOKEN: "vercel_blob_rw_ALPHA_fake",
      })
    ).toBe("vercel_blob_rw_ALPHA_fake");
  });

  it("ignores read-write tokens for other services", () => {
    expect(
      resolveBlobToken({ GITHUB_READ_WRITE_TOKEN: "ghp_fake" })
    ).toBeUndefined();
  });

  it("ignores names that merely contain the suffix elsewhere", () => {
    expect(
      resolveBlobToken({ READ_WRITE_TOKEN_BACKUP: PREFIXED })
    ).toBeUndefined();
  });

  it("never uses a NEXT_PUBLIC_ variable", () => {
    expect(
      resolveBlobToken({ NEXT_PUBLIC_BLOB_READ_WRITE_TOKEN: PREFIXED })
    ).toBeUndefined();
  });

  it("trims stray whitespace from a pasted value", () => {
    expect(resolveBlobToken({ BLOB_READ_WRITE_TOKEN: ` ${STANDARD}\n` })).toBe(
      STANDARD
    );
  });

  it("rejects an empty value or the bare prefix", () => {
    expect(resolveBlobToken({ BLOB_READ_WRITE_TOKEN: "" })).toBeUndefined();
    expect(
      resolveBlobToken({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_" })
    ).toBeUndefined();
  });

  it("is undefined when nothing is configured", () => {
    expect(resolveBlobToken({})).toBeUndefined();
  });
});

describe("describeBlobToken", () => {
  it("reports the standard variable", () => {
    expect(describeBlobToken({ BLOB_READ_WRITE_TOKEN: STANDARD })).toEqual({
      ready: true,
      source: "standard",
    });
  });

  it("reports a custom-prefixed variable", () => {
    expect(describeBlobToken({ FILES_READ_WRITE_TOKEN: PREFIXED })).toEqual({
      ready: true,
      source: "prefixed",
    });
  });

  it("reports a missing token", () => {
    expect(describeBlobToken({ UNRELATED: "x" })).toEqual({
      ready: false,
      source: "missing",
    });
  });

  it("never reveals the token value or the variable name", () => {
    const text = JSON.stringify(
      describeBlobToken({ SECRET_NAME_READ_WRITE_TOKEN: PREFIXED })
    );
    expect(text).not.toContain(PREFIXED);
    expect(text).not.toContain("SECRET_NAME");
  });
});
