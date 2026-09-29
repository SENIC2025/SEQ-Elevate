import { describe, it, expect } from "vitest";
import {
  ACCESS_MESSAGES,
  accessProblem,
  attachFailureMessage,
  classifyUploadError,
  formatTimeLeft,
  formatUploadProgress,
  isNetworkError,
  saveFailureMessage,
  secondsLeft,
  unexplainedUploadMessage,
  uploadFailureMessage,
} from "./author-feedback";
import type { StorageStatus } from "./uploads";

const MB = 1024 * 1024;

const READY: StorageStatus = {
  signedIn: true,
  canUpload: true,
  storage: "ready",
};

describe("upload progress", () => {
  it("shows sizes to one decimal", () => {
    expect(
      formatUploadProgress({ loaded: 48.2 * MB, total: 126.3 * MB, elapsedMs: 1000 })
    ).toBe("Uploading… 48.2 of 126.3 MB");
  });

  it("counts a small file in KB (or bytes), not as 0.0 MB", () => {
    expect(
      formatUploadProgress({ loaded: 12 * 1024, total: 38 * 1024, elapsedMs: 500 })
    ).toBe("Uploading… 12 of 38 KB");
    expect(
      formatUploadProgress({ loaded: 200, total: 700, elapsedMs: 100 })
    ).toBe("Uploading… 200 of 700 B");
  });

  it("adds a time estimate once there are ~3 seconds of data", () => {
    // 48.2 MB in 72 s → 78.1 MB to go at the same speed ≈ 117 s ≈ 2 min.
    expect(
      formatUploadProgress({
        loaded: 48.2 * MB,
        total: 126.3 * MB,
        elapsedMs: 72_000,
      })
    ).toBe("Uploading… 48.2 of 126.3 MB · about 2 min left");
  });

  it("does not estimate too early, before any bytes, or when done", () => {
    expect(secondsLeft(10, 100, 2999)).toBeNull();
    expect(secondsLeft(0, 100, 10_000)).toBeNull();
    expect(secondsLeft(100, 100, 10_000)).toBeNull();
    expect(secondsLeft(50, 100, 10_000)).toBe(10);
  });

  it("phrases the time left plainly", () => {
    expect(formatTimeLeft(20)).toBe("less than a minute left");
    expect(formatTimeLeft(89)).toBe("about 1 min left");
    expect(formatTimeLeft(150)).toBe("about 3 min left");
    expect(formatTimeLeft(3600)).toBe("about 1 h left");
    expect(formatTimeLeft(3900)).toBe("about 1 h 5 min left");
  });
});

describe("accessProblem", () => {
  it("is nothing when storage is ready for an editor (or unknown)", () => {
    expect(accessProblem(READY)).toBeNull();
    expect(accessProblem(null)).toBeNull();
    expect(accessProblem(undefined)).toBeNull();
  });

  it("puts signed-out first, then permission, then storage", () => {
    expect(accessProblem({ signedIn: false })).toBe("signed-out");
    expect(
      accessProblem({ signedIn: true, canUpload: false, storage: "missing" })
    ).toBe("not-editor");
    expect(accessProblem({ ...READY, storage: "missing" })).toBe(
      "storage-missing"
    );
  });

  it("never tells anyone to sign in as a content editor", () => {
    for (const text of Object.values(ACCESS_MESSAGES)) {
      expect(text).not.toMatch(/content editor/i);
    }
  });
});

describe("classifyUploadError", () => {
  const blob = (m: string) => new Error(`Vercel Blob: ${m}`);

  it("recognises the token request failing (both SDK spellings)", () => {
    expect(
      classifyUploadError(blob("Failed to retrieve the client token"))
    ).toEqual({ kind: "unexplained" });
    expect(
      classifyUploadError(blob("Failed to  retrieve the client token"))
    ).toEqual({ kind: "unexplained" });
  });

  it("treats a dropped connection as an interruption", () => {
    expect(classifyUploadError(new TypeError("Failed to fetch"))).toEqual({
      kind: "interrupted",
    });
    expect(classifyUploadError(new TypeError("Load failed"))).toEqual({
      kind: "interrupted",
    });
    expect(
      classifyUploadError(
        blob("The blob service is currently not available. Please try again.")
      )
    ).toEqual({ kind: "interrupted" });
  });

  it("explains known storage errors", () => {
    expect(classifyUploadError(blob("Client token has expired."))).toEqual({
      kind: "failed",
      reason: "it took longer than the one-hour upload window",
    });
    expect(classifyUploadError(blob("This store has been suspended."))).toEqual(
      {
        kind: "failed",
        reason: "the file storage is suspended — please tell an administrator",
      }
    );
  });

  it("passes on an unrecognised reason, shortened", () => {
    expect(classifyUploadError(blob("Something odd happened."))).toEqual({
      kind: "failed",
      reason: "something odd happened",
    });
    const long = classifyUploadError(new Error("x".repeat(300)));
    expect(long.kind === "failed" && long.reason.length).toBe(140);
  });

  it("copes with a non-Error being thrown", () => {
    expect(classifyUploadError("nope")).toEqual({
      kind: "failed",
      reason: "something unexpected happened",
    });
  });

  it("does not treat an ordinary TypeError as a network failure", () => {
    expect(isNetworkError(new TypeError("x is not a function"))).toBe(false);
  });
});

describe("upload failure messages", () => {
  it("words interruptions and failures", () => {
    expect(uploadFailureMessage({ kind: "interrupted" })).toBe(
      "The upload was interrupted. Check your connection and try again."
    );
    expect(
      uploadFailureMessage({ kind: "failed", reason: "the file storage is suspended" })
    ).toBe("The upload didn't finish: the file storage is suspended.");
  });

  it("explains a refused upload from the status checked afterwards", () => {
    expect(unexplainedUploadMessage({ ...READY, storage: "missing" })).toBe(
      ACCESS_MESSAGES["storage-missing"]
    );
    expect(unexplainedUploadMessage({ signedIn: false })).toBe(
      ACCESS_MESSAGES["signed-out"]
    );
    expect(
      unexplainedUploadMessage({ ...READY, canUpload: false })
    ).toBe(ACCESS_MESSAGES["not-editor"]);
  });

  it("admits when it can't tell why", () => {
    expect(unexplainedUploadMessage(READY)).toMatch(/didn't accept the upload/);
    expect(unexplainedUploadMessage(null)).toMatch(/couldn't be checked/);
  });
});

describe("saveFailureMessage", () => {
  it("tells a signed-out author how to keep their work", () => {
    expect(
      saveFailureMessage({ kind: "refused", access: { signedIn: false } })
    ).toMatch(/not signed in any more.*new tab/);
  });

  it("tells someone without the role who can grant it", () => {
    expect(
      saveFailureMessage({
        kind: "refused",
        access: { ...READY, canUpload: false },
      })
    ).toBe(
      "You don't have permission to edit courses. Ask an administrator for the Editor role."
    );
  });

  it("does not guess when the account looks fine or can't be checked", () => {
    const expected =
      "Couldn't save: the server refused the change. Your changes are still here — try again.";
    expect(saveFailureMessage({ kind: "refused", access: READY })).toBe(expected);
    expect(saveFailureMessage({ kind: "refused", access: null })).toBe(expected);
  });

  it("distinguishes a lost connection from a server error", () => {
    expect(
      saveFailureMessage({ kind: "thrown", error: new TypeError("Failed to fetch") })
    ).toBe(
      "Couldn't save: the connection was interrupted. Your changes are still here — try again."
    );
    expect(
      saveFailureMessage({ kind: "thrown", error: new Error("boom") })
    ).toBe(
      "Couldn't save: the server ran into a problem. Your changes are still here — try again."
    );
  });
});

describe("attachFailureMessage", () => {
  it("says the file itself was uploaded", () => {
    expect(
      attachFailureMessage({ kind: "thrown", error: new TypeError("Failed to fetch") })
    ).toMatch(/^The file was uploaded, but adding it to the lesson was interrupted/);
    expect(attachFailureMessage({ kind: "refused", access: READY })).toBe(
      "The file was uploaded, but the server refused to add it to the lesson. Try again."
    );
  });

  it("explains a refusal from the account's access", () => {
    expect(
      attachFailureMessage({ kind: "refused", access: { signedIn: false } })
    ).toMatch(/not signed in any more/);
    expect(
      attachFailureMessage({
        kind: "refused",
        access: { ...READY, canUpload: false },
      })
    ).toMatch(/don't have permission to edit courses/);
  });
});
