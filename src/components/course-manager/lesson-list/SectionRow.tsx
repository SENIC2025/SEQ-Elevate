"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleDashed,
  Ellipsis,
  Eye,
  EyeOff,
  FilePenLine,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { LessonOutline } from "@/lib/cms/course-admin-types";
import type { Locale } from "@/lib/cms/types";
import type { Control, RowControls } from "./live-controls";
import { DeleteConfirm } from "./DeleteConfirm";
import { RenameForm } from "./RenameForm";

/** "confirm": a change to a course with learners waits for LiveChangeConfirm (spec 7.3). */
export type RowMode = "actions" | "rename" | "delete" | "confirm";
export type RowStatus = "live" | "empty";
/** The row's focusable parts, for the panel to put focus on after a change. */
export type RowPart = "link" | "actions" | "up" | "down" | "rename" | "hide" | "addAfter" | "delete";
/** The row's other elements with an id (the panel, and texts that describe). */
export type RowElement = RowPart | "panel" | "status" | "unnumbered" | "emptyNote";

const STATUS_ICON = { live: CircleCheck, empty: CircleDashed };

/**
 * One lesson of a created course's lesson list: its link ("2. Skill
 * concept", the name marked with the content language, "Hidden" and
 * "Draft" in words inside it), whether learners get it (an icon with a
 * tooltip, and the words as the link's description — never colour alone),
 * and "Actions for 2. Skill concept", which opens the lesson's controls
 * inline (a disclosure, not an ARIA menu): Move up / Move down, Rename,
 * Hide or Show, Add lesson after, Delete. Rename, Delete and, on a course
 * with learners, the confirmation of a change (LiveChangeConfirm, passed
 * in as `confirm`) open in place of the buttons. A lesson of the course's
 * own with nothing in it says that learners get it once it has content.
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
  emptyNote,
  deleteBlocked,
  confirm,
  onToggle,
  onMove,
  onHide,
  onStartRename,
  onAddAfter,
  onStartDelete,
  onRenameSave,
  onRenameCancel,
  onDeleteConfirm,
  onDeleteHide,
  onDeleteKeep,
  announce,
  after,
}: {
  lesson: LessonOutline;
  /** "2. Skill concept" (no number when learners wouldn't see it). */
  label: string;
  name: string;
  /** Whether learners get it; null for a hidden lesson (its "Hidden" says it). */
  status: RowStatus | null;
  idOf: (part: RowElement) => string;
  controls: RowControls;
  open: boolean;
  mode: RowMode;
  busy: boolean;
  error: string | null;
  /** The id of the shared text that says why a control is refused. */
  describe: (c: Control) => string | undefined;
  rename: { lang: Locale; initial: string; placeholder: string };
  /** liveChanges.emptyNote, for a lesson of the course's own that learners don't get yet. */
  emptyNote?: string | null;
  /** Why learners keep it from being deleted (spec 7.2), shown in DeleteConfirm. */
  deleteBlocked?: string | null;
  /** LiveChangeConfirm for the change waiting on this row (mode "confirm"). */
  confirm?: React.ReactNode;
  onToggle(): void;
  onMove(dir: -1 | 1): void;
  onHide(): void;
  onStartRename(): void;
  onAddAfter(): void;
  onStartDelete(): void;
  onRenameSave(label: string): void;
  onRenameCancel(): void;
  onDeleteConfirm(): void;
  /** DeleteConfirm's "Hide it", while learners keep the lesson from being deleted. */
  onDeleteHide?: (() => void) | null;
  onDeleteKeep(): void;
  announce(text: string): void;
  /** Shown under the row (the "Add a lesson" picker opened from it). */
  after?: React.ReactNode;
}) {
  const t = useTranslations("lessonList");
  const tDraft = useTranslations("exerciseEditor.page");
  const section = lesson.section!;
  const lang = rename.lang;
  const StatusIcon = status ? STATUS_ICON[status] : null;
  const statusText = status ? t(`status.${status}`) : null;
  const unnumbered = section.number === null;
  const actionsFor = t("actionsFor", { label });
  const hideText = section.hidden ? t("show") : t("hide");

  /**
   * One control: native disabled at an end, aria-disabled (and why) when
   * refused. A delete that learners keep from happening still opens its
   * confirmation, which says why and offers Hide instead.
   */
  const action = (
    part: RowPart,
    control: Control,
    onClick: () => void,
    icon: React.ReactNode,
    text: string
  ) => {
    const refused = control.kind === "locked";
    return (
      <button
        id={idOf(part)}
        type="button"
        disabled={control.kind === "edge"}
        aria-disabled={refused || undefined}
        aria-describedby={describe(control)}
        onClick={() => {
          if (!refused && !busy) onClick();
        }}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-medium hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
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
          aria-describedby={[
            statusText ? idOf("status") : null,
            unnumbered ? idOf("unnumbered") : null,
            emptyNote ? idOf("emptyNote") : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined}
          className="flex min-h-9 min-w-0 flex-1 flex-wrap items-start gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
        >
          {unnumbered ? (
            <span aria-hidden title={t("notNumbered")} className="text-[var(--muted-foreground)]">
              –
            </span>
          ) : null}
          <span lang={lang} className="min-w-0 break-words font-medium">
            {label}
          </span>
          {section.hidden ? (
            <span className="inline-flex items-center gap-0.5 self-center rounded-full border border-[var(--border)] px-1.5 text-[10px] font-medium">
              <EyeOff className="h-3 w-3" aria-hidden />
              {t("hiddenTag")}
            </span>
          ) : null}
          {lesson.draft ? (
            <span className="inline-flex items-center gap-0.5 self-center rounded-full border border-dashed border-[var(--warning)] px-1.5 text-[10px] font-medium">
              <FilePenLine className="h-3 w-3" aria-hidden />
              {tDraft("navDraft")}
            </span>
          ) : null}
        </a>
        {unnumbered ? (
          <span id={idOf("unnumbered")} hidden>
            {t("notNumbered")}
          </span>
        ) : null}
        {StatusIcon && statusText ? (
          <span
            id={idOf("status")}
            role="img"
            aria-label={statusText}
            title={statusText}
            className="mt-2 inline-flex flex-shrink-0 items-center gap-1"
          >
            <StatusIcon
              className={`h-3.5 w-3.5 ${status === "live" ? "text-[var(--success)]" : "text-[var(--muted-foreground)]"}`}
              aria-hidden
            />
          </span>
        ) : null}
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
      {emptyNote ? (
        <p id={idOf("emptyNote")} className="mb-1 pl-2 text-xs text-[var(--muted-foreground)]">
          {emptyNote}
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
            busy={busy}
            error={error}
            onSave={onRenameSave}
            onCancel={onRenameCancel}
            announce={announce}
          />
        ) : open && mode === "delete" ? (
          <DeleteConfirm
            name={name}
            nameLang={lang}
            summary={section.deleteSummary}
            busy={busy}
            error={error}
            blocked={deleteBlocked}
            onConfirm={onDeleteConfirm}
            onHide={onDeleteHide}
            onKeep={onDeleteKeep}
          />
        ) : open && mode === "confirm" ? (
          confirm
        ) : open ? (
          <div role="group" aria-label={actionsFor} className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {action("up", controls.moveUp, () => onMove(-1), <ArrowUp className="h-3.5 w-3.5" aria-hidden />, t("moveUp"))}
              {action("down", controls.moveDown, () => onMove(1), <ArrowDown className="h-3.5 w-3.5" aria-hidden />, t("moveDown"))}
              {action("rename", controls.rename, onStartRename, <Pencil className="h-3.5 w-3.5" aria-hidden />, t("rename.action"))}
              {action(
                "hide",
                controls.hide,
                onHide,
                section.hidden ? (
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden />
                ),
                hideText
              )}
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
