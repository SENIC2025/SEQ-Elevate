import { describe, it, expect } from "vitest";
import { wasVerificationSent, signInErrorType } from "./signin-result";

const SENT =
  "https://seq-elevate.eu/api/auth/verify-request?provider=invite&type=email";
const FAILED = "https://seq-elevate.eu/api/auth/error?error=Configuration";

describe("wasVerificationSent", () => {
  it("is true only for the 'check your email' step", () => {
    expect(wasVerificationSent(SENT)).toBe(true);
    expect(wasVerificationSent("/api/auth/verify-request?provider=resend")).toBe(
      true
    );
  });

  it("is false for Auth.js's error page — the case that used to read as 'sent'", () => {
    expect(wasVerificationSent(FAILED)).toBe(false);
    expect(
      wasVerificationSent("https://seq-elevate.eu/api/auth/error?error=AccessDenied")
    ).toBe(false);
  });

  it("is false for anything unexpected", () => {
    expect(wasVerificationSent(undefined)).toBe(false);
    expect(wasVerificationSent(null)).toBe(false);
    expect(wasVerificationSent({ redirect: SENT })).toBe(false);
    expect(wasVerificationSent("https://seq-elevate.eu/en")).toBe(false);
    // A look-alike must not pass on a substring match.
    expect(wasVerificationSent("https://x.eu/verify-request-evil/../error")).toBe(
      false
    );
  });
});

describe("signInErrorType", () => {
  it("reads the error type from a failed result", () => {
    expect(signInErrorType(FAILED)).toBe("Configuration");
  });

  it("is null when there is no error", () => {
    expect(signInErrorType(SENT)).toBeNull();
    expect(signInErrorType(undefined)).toBeNull();
  });
});
