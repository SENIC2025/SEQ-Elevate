"use client";

import * as React from "react";
import {
  MULTIPART_FROM_BYTES,
  checkFile,
  type StorageStatus,
  type UploadRules,
} from "@/lib/uploads";
import {
  accessProblem,
  classifyUploadError,
  unexplainedUploadMessage,
  uploadFailureMessage,
} from "@/lib/author-feedback";

/**
 * GET /api/storage/status — can this account upload, and is storage
 * connected? Null when the answer couldn't be fetched.
 */
export async function fetchStorageStatus(): Promise<StorageStatus | null> {
  try {
    const res = await fetch("/api/storage/status", { cache: "no-store" });
    if (res.status === 401) return { signedIn: false };
    if (!res.ok) return null;
    return (await res.json()) as StorageStatus;
  } catch {
    return null;
  }
}

export type UploadState =
  | { phase: "idle" }
  /** The file failed the size/type check; nothing was sent. */
  | { phase: "rejected"; message: string }
  | { phase: "uploading"; loaded: number; total: number; elapsedMs: number }
  | { phase: "stored" }
  | { phase: "failed"; file: File; message: string };

/**
 * Client upload to Vercel Blob for the authoring screens: checks the file
 * first, tracks progress, warns before leaving mid-upload, and turns failures
 * into a message that names the actual cause (asking the status endpoint when
 * the SDK can't say). `storage` is undefined until the first status check
 * returns, and null if it couldn't be fetched; `problem` is what currently
 * stops this account uploading, if anything.
 */
export function useBlobUpload(rules: UploadRules) {
  const [storage, setStorage] = React.useState<
    StorageStatus | null | undefined
  >(undefined);
  const [state, setState] = React.useState<UploadState>({ phase: "idle" });

  React.useEffect(() => {
    let cancelled = false;
    void fetchStorageStatus().then((s) => {
      if (!cancelled) setStorage(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // While something blocks uploads, look again whenever the author comes
  // back to this tab — e.g. after signing in or connecting storage elsewhere.
  const problem = accessProblem(storage);
  React.useEffect(() => {
    if (!problem) return;
    const recheck = () => {
      void fetchStorageStatus().then(setStorage);
    };
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, [problem]);

  // Leaving the page would cancel the upload — ask first.
  const uploading = state.phase === "uploading";
  React.useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // older browsers only prompt when this is set
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  /** Upload `file`; resolves to the stored blob, or null if it wasn't stored. */
  const start = React.useCallback(
    async (
      file: File
    ): Promise<{ url: string; contentType: string } | null> => {
      const check = checkFile(file, rules);
      if (!check.ok) {
        setState({ phase: "rejected", message: check.message });
        return null;
      }
      const startedAt = Date.now();
      // The SDK throttles progress events, so one can land after upload()
      // resolves — ignore anything once this attempt has finished.
      let finished = false;
      setState({ phase: "uploading", loaded: 0, total: file.size, elapsedMs: 0 });
      try {
        const { upload } = await import("@vercel/blob/client");
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: rules.handleUploadUrl,
          contentType: check.contentType,
          // Large files go up in parts: parallel, and each part is retried.
          multipart: file.size > MULTIPART_FROM_BYTES,
          onUploadProgress: (p) => {
            if (finished) return;
            setState({
              phase: "uploading",
              loaded: p.loaded,
              total: p.total || file.size,
              elapsedMs: Date.now() - startedAt,
            });
          },
        });
        finished = true;
        setState({ phase: "stored" });
        return { url: blob.url, contentType: blob.contentType };
      } catch (error) {
        finished = true;
        const failure = classifyUploadError(error);
        let message: string;
        if (failure.kind === "unexplained") {
          // The SDK drops the route's reason, so ask what's wrong right now
          // (and refresh the notice shown by the picker while we're at it).
          const now = await fetchStorageStatus();
          setStorage(now);
          message = unexplainedUploadMessage(now);
        } else {
          message = uploadFailureMessage(failure);
        }
        setState({ phase: "failed", file, message });
        return null;
      }
    },
    [rules]
  );

  return { storage, problem, state, start };
}
