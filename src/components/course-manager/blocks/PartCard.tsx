"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowDown, ArrowUp, Check, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DraftBadge } from "@/components/role/StructureAuthor";
import type { PartStatus } from "./part-list";

const lockedCls = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/**
 * One piece of a lesson's content on the course page: a header — a group
 * named "Content 2 of 3: Quick check" with what to know about it (Draft,
 * Not ready, written in the language on screen) and Move up, Move down and
 * Remove — then its editor. The main content has no Remove, and no header
 * at all while it is the lesson's only content.
 *
 * A change a live course would refuse is `aria-disabled` (still focusable,
 * so the reason is read with it) rather than missing: `lockedNoteId` names
 * the note that says why.
 */
export function PartCard({
  ids,
  groupLabel,
  status,
  language,
  header,
  index,
  total,
  removable,
  locked,
  lockedNoteId,
  error,
  onMove,
  onRemove,
  children,
}: {
  /** Element ids of the header's name and move buttons, for the list to move focus to. */
  ids: { label: string; up: string; down: string; body: string };
  groupLabel: string;
  status: PartStatus | null;
  /** The language on screen, by name ("English"). */
  language: string;
  /** Show the header (any content besides the main content). */
  header: boolean;
  index: number;
  total: number;
  removable: boolean;
  locked: { move: boolean; remove: boolean };
  lockedNoteId: string;
  /** Why the last change to this content was refused. */
  error?: string;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("lessonBlocks");
  const lockedProps = (isLocked: boolean) =>
    isLocked ? { "aria-disabled": true as const, "aria-describedby": lockedNoteId } : {};
  const guard = (isLocked: boolean, action: () => void) => () => {
    if (!isLocked) action();
  };

  return (
    <div className="scroll-mt-24 space-y-2">
      {header ? (
        <div
          role="group"
          aria-labelledby={ids.label}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2"
        >
          <span
            id={ids.label}
            tabIndex={-1}
            className="min-w-0 flex-1 basis-40 scroll-mt-24 text-sm font-semibold"
          >
            {groupLabel}
          </span>
          <PartStatusBadges status={status} language={language} />
          <span className="flex flex-wrap items-center gap-1.5">
            <Button
              id={ids.up}
              size="sm"
              variant="ghost"
              className={lockedCls}
              disabled={index === 0}
              {...lockedProps(locked.move)}
              onClick={guard(locked.move, () => onMove(-1))}
            >
              <ArrowUp className="h-4 w-4" aria-hidden />
              {t("moveUp")}
            </Button>
            <Button
              id={ids.down}
              size="sm"
              variant="ghost"
              className={lockedCls}
              disabled={index === total - 1}
              {...lockedProps(locked.move)}
              onClick={guard(locked.move, () => onMove(1))}
            >
              <ArrowDown className="h-4 w-4" aria-hidden />
              {t("moveDown")}
            </Button>
            {removable ? (
              <Button
                size="sm"
                variant="ghost"
                className={`${lockedCls} hover:text-[var(--danger)]`}
                {...lockedProps(locked.remove)}
                onClick={guard(locked.remove, onRemove)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                {t("remove")}
              </Button>
            ) : null}
          </span>
          {error ? (
            <p
              role="alert"
              className="flex w-full items-start gap-1 text-sm text-[var(--danger)]"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      <div id={ids.body}>{children}</div>
    </div>
  );
}

/** Status in words and icons, never colour alone (WCAG 1.4.1). */
export function PartStatusBadges({
  status,
  language,
}: {
  status: PartStatus | null;
  language: string;
}) {
  const t = useTranslations("lessonBlocks");
  if (!status) return null;
  if (status.kind === "text") {
    return status.written ? (
      <Badge variant="success" className="text-[10px]">
        <Check className="h-3 w-3" aria-hidden />
        {t("langState.written", { language })}
      </Badge>
    ) : (
      <Badge variant="muted" className="text-[10px]">
        {t("langState.missing", { language })}
      </Badge>
    );
  }
  return (
    <>
      {status.draft ? <DraftBadge label={t("draft")} /> : null}
      {status.notReady > 0 ? (
        <Badge variant="muted" className="border-dashed text-[10px]">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {t("notReady", { count: status.notReady })}
        </Badge>
      ) : null}
    </>
  );
}
