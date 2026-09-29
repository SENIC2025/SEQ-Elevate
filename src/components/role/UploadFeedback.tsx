"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  ACCESS_MESSAGES,
  accessProblem,
  formatUploadProgress,
} from "@/lib/author-feedback";
import type { StorageStatus } from "@/lib/uploads";
import type { UploadState } from "@/components/role/useBlobUpload";
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Loader2,
  RotateCcw,
} from "lucide-react";

/**
 * The line under an upload picker: "File storage connected" when uploads can
 * work, otherwise a panel saying what stops them and who can fix it. Give the
 * picker `aria-describedby={id}` so the reason is read with it. `whenMissing`
 * adds to the panel only when storage itself isn't connected (e.g. "paste a
 * link instead"). Renders nothing until the status is known.
 */
export function StorageNotice({
  storage,
  id,
  whenMissing,
}: {
  storage: StorageStatus | null | undefined;
  id: string;
  whenMissing?: React.ReactNode;
}) {
  if (!storage) return null;
  const problem = accessProblem(storage);
  if (!problem) {
    return (
      <p
        id={id}
        className="mt-2 text-xs text-[var(--success)] flex items-center gap-1.5"
      >
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        File storage connected
      </p>
    );
  }
  return (
    <div
      id={id}
      className="mt-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--foreground)] flex items-start gap-2"
    >
      <AlertTriangle
        className="h-4 w-4 flex-shrink-0 mt-0.5 text-[var(--warning)]"
        aria-hidden
      />
      <div className="space-y-1.5">
        <p>{ACCESS_MESSAGES[problem]}</p>
        {problem === "storage-missing" ? whenMissing : null}
      </div>
    </div>
  );
}

/**
 * Progress while uploading, then the outcome. The outcome sits in a polite
 * live region (progress ticks deliberately don't, so screen readers aren't
 * flooded); `onRetry` adds a "Try again" button after it.
 */
export function UploadStatus({
  state,
  message,
  onRetry,
}: {
  state: UploadState;
  message: { tone: "success" | "error"; text: string } | null;
  onRetry?: () => void;
}) {
  const progress = state.phase === "uploading" ? state : null;
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.floor((progress.loaded / progress.total) * 100))
      : 0;
  const progressText = progress ? formatUploadProgress(progress) : "";

  return (
    <>
      {progress ? (
        <div className="mt-2">
          <div
            className="h-1.5 rounded-full bg-[var(--surface-muted)] overflow-hidden"
            role="progressbar"
            aria-label="Upload progress"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={progressText}
          >
            <div
              className="h-full bg-[var(--accent)] transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-[var(--muted-foreground)] flex items-center gap-1.5 tabular-nums">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {progressText}
          </p>
        </div>
      ) : null}
      <div role="status" aria-live="polite">
        {progress ? <span className="sr-only">Upload started.</span> : null}
        {message ? (
          <p
            className={`mt-2 text-xs flex items-start gap-1.5 ${
              message.tone === "success"
                ? "text-[var(--success)]"
                : "text-[var(--danger)]"
            }`}
          >
            {message.tone === "success" ? (
              <CloudUpload className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" aria-hidden />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" aria-hidden />
            )}
            {message.text}
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          Try again
        </Button>
      ) : null}
    </>
  );
}
