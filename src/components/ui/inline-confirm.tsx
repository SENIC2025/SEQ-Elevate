"use client";

import * as React from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Delete …?" asked in place, before anything is deleted, for the admin
 * screens: the course page's pattern (a lesson's DeleteConfirm, the same
 * markup, and PublishControls' unpublish). Its heading takes focus when it
 * opens, so the question is read first; what happens (`children`) is the
 * description of the group and of the action, so it is read on the way in
 * and again on the action, one Tab away. "Keep" is one more. Escape keeps
 * too.
 *
 * Once the action is running it can't be called back: Keep and Escape do
 * nothing until it has finished or failed (`busy`), rather than close the
 * question as if they had kept the thing.
 *
 * The caller decides where focus goes next: back on the button that opened
 * it after Keep, and on something nearby once the thing is gone.
 */
export function InlineConfirm({
  title,
  heading: Heading = "h3",
  children,
  confirmLabel,
  keepLabel,
  busy,
  error,
  onConfirm,
  onKeep,
}: {
  /** The question, e.g. "Delete “Wrap-up” in all languages?". */
  title: React.ReactNode;
  /** The question's heading level, to fit the page's outline. */
  heading?: "h2" | "h3";
  /** What happens, under the question: the action's description. */
  children?: React.ReactNode;
  confirmLabel: string;
  keepLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const ids = React.useId();
  const groupRef = React.useRef<HTMLDivElement>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const describedBy = children ? `${ids}-d` : undefined;

  React.useEffect(() => {
    headingRef.current?.focus();
    // On a phone it can open below the fold: all of it comes into view, so
    // its buttons are on screen too.
    groupRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <div
      ref={groupRef}
      role="group"
      aria-labelledby={`${ids}-h`}
      aria-describedby={describedBy}
      className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          if (!busy) onKeep();
        }
      }}
    >
      <Heading id={`${ids}-h`} ref={headingRef} tabIndex={-1} className="text-sm font-semibold">
        {title}
      </Heading>
      {children ? <div id={describedBy}>{children}</div> : null}
      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {/* aria-disabled, not disabled, while it runs: focus stays on it. */}
        <Button
          type="button"
          size="sm"
          variant="danger"
          aria-disabled={busy || undefined}
          aria-describedby={describedBy}
          onClick={() => {
            if (!busy) onConfirm();
          }}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="h-4 w-4" aria-hidden />
          )}
          {confirmLabel}
        </Button>
        {/* It can't stop what is already running. */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-disabled={busy || undefined}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          onClick={() => {
            if (!busy) onKeep();
          }}
        >
          {keepLabel}
        </Button>
      </div>
    </div>
  );
}
