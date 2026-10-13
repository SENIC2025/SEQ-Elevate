"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleDashed,
  Clock,
  Ellipsis,
  EyeOff,
  FilePenLine,
  Info,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { LessonOutline } from "@/lib/cms/course-admin-types";
import type { Locale } from "@/lib/cms/types";
import type { Control, RowControls } from "./live-controls";
import { DeleteConfirm } from "./DeleteConfirm";
import { RenameForm } from "./RenameForm";

export type RowMode = "actions" | "rename" | "delete";
export type RowStatus = "live" | "later" | "empty";
/** The row's focusable parts, for the panel to put focus on after a change. */
export type RowPart = "link" | "actions" | "up" | "down" | "rename" | "hide" | "addAfter" | "delete";

const STATUS_ICON = { live: CircleCheck, later: Clock, empty: CircleDashed };

/**
 * One lesson of a created course's lesson list: its link ("2. Skill
 * concept"), whether learners get it (an icon with words for screen
 * readers, never colour alone), "Hidden" and "Draft" in words, and
 * "Actions for 2. Skill concept", which opens the lesson's controls inline
 * (a disclosure, not an ARIA menu): Move up / Move down, Rename, Hide, Add
 * lesson after, Delete. Rename and Delete open in place of the buttons.
 */
export function SectionRow({
  lesson,
  label,
  name,
  status,
  idOf,
  controls,
  open,
  mode,
  busy,
  error,
  describe,
  rename,
  onToggle,
  onMove,
  onHide,
  onStartRename,
  onAddAfter,
  onStartDelete,
  onRenameSave,
  onRenameCancel,
  onDeleteConfirm,
  onDeleteKeep,
  announce,
  after,
}: {
  lesson: LessonOutline;
  /** "2. Skill concept" (no number when learners wouldn't see it). */
  label: string;
  name: string;
  status: RowStatus;
  idOf: (part: RowPart | "panel") => string;
  controls: RowControls;
  open: boolean;
  mode: RowMode;
  busy: boolean;
  error: string | null;
  /** The id of the shared text that says why a control is refused. */
  describe: (c: Control) => string | undefined;
  rename: { lang: Locale; initial: string; placeholder: string; laterNote: string | null };
  onToggle(): void;
  onMove(dir: -1 | 1): void;
  onHide(): void;
  onStartRename(): void;
  onAddAfter(): void;
  onStartDelete(): void;
  onRenameSave(label: string): void;
  onRenameCancel(): void;
  onDeleteConfirm(): void;
  onDeleteKeep(): void;
  announce(text: string): void;
  /** Shown under the row (the "Add a lesson" picker opened from it). */
  after?: React.ReactNode;
}) {
  const t = useTranslations("lessonList");
  const tDraft = useTranslations("exerciseEditor.page");
  const section = lesson.section!;
  const StatusIcon = STATUS_ICON[status];
  const actionsFor = t("actionsFor", { label });
  const anyLive = Object.values(controls).some((c) => c.kind === "locked" && c.why === "live");

  /** One control: native disabled at an end, aria-disabled (and why) when refused. */
  const action = (
    part: RowPart,
    control: Control,
    onClick: () => void,
    icon: React.ReactNode,
    text: string,
    extra: { pressed?: boolean; expanded?: boolean } = {}
  ) => {
    const refused = control.kind === "locked" || control.kind === "learners";
    return (
      <button
        id={idOf(part)}
        type="button"
        disabled={control.kind === "edge"}
        aria-disabled={refused || undefined}
        aria-describedby={refused ? describe(control) : undefined}
        aria-pressed={extra.pressed}
        onClick={() => {
          if (!refused && !busy) onClick();
        }}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-medium hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent)]/10`}
      >
        {icon}
        {text}
      </button>
    );
  };

  return (
    <li>
      <div className="flex items-start gap-1">
        <a
          id={idOf("link")}
          href={`#lesson-${lesson.key}`}
          className="flex min-h-9 min-w-0 flex-1 items-start gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
        >
          {section.number === null ? (
            <span aria-hidden className="text-[var(--muted-foreground)]">
              –
            </span>
          ) : null}
          <span className="min-w-0 break-words font-medium">{label}</span>
        </a>
        <span className="mt-2 inline-flex flex-shrink-0 items-center gap-1">
          <StatusIcon
            className={`h-3.5 w-3.5 ${status === "live" ? "text-[var(--success)]" : "text-[var(--muted-foreground)]"}`}
            aria-hidden
          />
          <span className="sr-only">{t(`status.${status}`)}</span>
        </span>
        <button
          id={idOf("actions")}
          type="button"
          aria-expanded={open}
          aria-controls={idOf("panel")}
          aria-label={actionsFor}
          title={actionsFor}
          onClick={onToggle}
          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md hover:bg-[var(--surface-muted)] aria-expanded:bg-[var(--surface-muted)]"
        >
          <Ellipsis className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {section.hidden || lesson.draft ? (
        <p className="flex flex-wrap gap-1 pl-2">
          {section.hidden ? (
            <span className="inline-flex items-center gap-0.5 rounded-full border border-[var(--border)] px-1.5 text-[10px] font-medium">
              <EyeOff className="h-3 w-3" aria-hidden />
              {t("hiddenTag")}
            </span>
          ) : null}
          {lesson.draft ? (
            <span className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-[var(--warning)] px-1.5 text-[10px] font-medium">
              <FilePenLine className="h-3 w-3" aria-hidden />
              {tDraft("navDraft")}
            </span>
          ) : null}
        </p>
      ) : null}

      <div id={idOf("panel")} hidden={!open} className="mt-1 pl-2">
        {open && mode === "rename" ? (
          <RenameForm
            // One language at a time: another language starts from its own name.
            key={rename.lang}
            dirtyId={`section:${lesson.key}:label`}
            dirtyLabel={label}
            lang={rename.lang}
            initial={rename.initial}
            placeholder={rename.placeholder}
            laterNote={rename.laterNote}
            busy={busy}
            error={error}
            onSave={onRenameSave}
            onCancel={onRenameCancel}
            announce={announce}
          />
        ) : open && mode === "delete" ? (
          <DeleteConfirm
            name={name}
            summary={section.deleteSummary}
            busy={busy}
            error={error}
            onConfirm={onDeleteConfirm}
            onKeep={onDeleteKeep}
          />
        ) : open ? (
          <div role="group" aria-label={actionsFor} className="space-y-2">
            {anyLive ? (
              <p className="flex items-start gap-1.5 text-xs text-[var(--muted-foreground)]">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)]" aria-hidden />
                {t("liveLocked")}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {action("up", controls.moveUp, () => onMove(-1), <ArrowUp className="h-3.5 w-3.5" aria-hidden />, t("moveUp"))}
              {action("down", controls.moveDown, () => onMove(1), <ArrowDown className="h-3.5 w-3.5" aria-hidden />, t("moveDown"))}
              {action("rename", controls.rename, onStartRename, <Pencil className="h-3.5 w-3.5" aria-hidden />, t("rename.action"))}
              {action("hide", controls.hide, onHide, <EyeOff className="h-3.5 w-3.5" aria-hidden />, t("hide"), {
                pressed: section.hidden,
              })}
              {action("addAfter", controls.addAfter, onAddAfter, <Plus className="h-3.5 w-3.5" aria-hidden />, t("picker.addAfter"))}
              {action("delete", controls.delete, onStartDelete, <Trash2 className="h-3.5 w-3.5" aria-hidden />, t("delete.action"))}
            </div>
            {error ? (
              <p role="alert" className="flex items-start gap-1.5 text-xs text-[var(--danger)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {after}
    </li>
  );
}
