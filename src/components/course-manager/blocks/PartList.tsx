"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Info, Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { addPart, movePart, removePart, savePartText } from "@/app/actions/parts";
import { LessonNarrativeEditor, type NarrativeTarget } from "@/components/role/LessonNarrativeEditor";
import { StructureAuthor } from "@/components/role/StructureAuthor";
import { partTarget } from "@/components/role/exercise/exercise-target";
import { writeErrorMessage, type WriteRefusal } from "@/components/role/exercise/write-errors";
import type { CourseKind, CourseOutline, LessonOutline } from "@/lib/cms/course-admin-types";
import type { CourseStatus } from "@/lib/cms/course-status";
import {
  MAIN_PART_ID,
  SECTION_LIMITS,
  type NewOnlyReason,
  type OutlineResult,
  type PartId,
  type PartType,
  type PartView,
  type SectionId,
} from "@/lib/cms/sections/contract";
import type { Locale } from "@/lib/cms/types";
import { DirtyScope } from "../dirty-registry";
import { PartCard } from "./PartCard";
import { PartTypePicker } from "./PartTypePicker";
import {
  extraCount,
  focusAfterPartMove,
  focusAfterRemove,
  partOpAllowed,
  partStatus,
  partTypeOf,
  settleRereads,
  textInitial,
  textPair,
  type PartFocus,
} from "./part-list";

/** The first box an author types in, once a new content's editor has loaded. */
const FIELD = 'input:not([type="hidden"]), textarea, select, [contenteditable="true"]';

/**
 * A lesson's content on the course page, in learner order (spec 11.2): the
 * main content in exactly today's editor (`main`), and the extra content
 * around it — text, practice question, branching scenario, quick check,
 * reflection questions, self-assessment — each in its own editor, with
 * "Add content" after each one (one choice of types open at a time).
 *
 * Adding, moving and removing content changes the lesson: each returns the
 * whole course outline, which the page takes in (onOutline); a colleague's
 * change found that way shows at once. Saving a content's own text or
 * questions doesn't, and re-reads the page instead.
 *
 * Focus is kept predictable (WCAG 2.4.3): on the button pressed after a
 * move, on the next content after a removal, in the new content's first
 * box after an add; and one polite status line says what happened.
 */
export function PartList({
  lesson,
  label,
  slug,
  kind,
  status,
  lang,
  reasons,
  main,
  onOutline,
}: {
  lesson: LessonOutline;
  /** The lesson's heading ("2. Skill concept"), for unsaved-changes prompts. */
  label: string;
  slug: string;
  kind: CourseKind;
  status: CourseStatus;
  lang: Locale;
  reasons: readonly NewOnlyReason[];
  /** The main content's editor, as today. */
  main: React.ReactNode;
  onOutline: (outline: CourseOutline) => void;
}) {
  const t = useTranslations("lessonBlocks");
  const tEditor = useTranslations("exerciseEditor");
  const tLanguage = useTranslations("courseManager.languageName");
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const ids = React.useId();
  const sectionId = lesson.key as SectionId;
  const parts = lesson.parts;

  const [picker, setPicker] = React.useState<PartId | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ at: string; message: string } | null>(null);
  const [announce, setAnnounce] = React.useState("");
  const [focus, setFocus] = React.useState<PartFocus | null>(null);
  // Texts whose "Load the saved version" waits for a refreshed page.
  const [pending, setPending] = React.useState<Record<string, string | null>>({});
  const [revs, setRevs] = React.useState<Record<string, number>>({});
  const [seenParts, setSeenParts] = React.useState(parts);
  if (parts !== seenParts) {
    setSeenParts(parts);
    if (parts && Object.keys(pending).length) {
      const settled = settleRereads(pending, revs, parts.items);
      setPending(settled.pending);
      setRevs(settled.revs);
    }
  }

  const labelId = (id: PartId) => `${ids}-label-${id}`;
  const upId = (id: PartId) => `${ids}-up-${id}`;
  const downId = (id: PartId) => `${ids}-down-${id}`;
  const addId = (id: PartId) => `${ids}-add-${id}`;
  const bodyId = (id: PartId) => `${ids}-body-${id}`;
  const pickerId = (id: PartId) => `${ids}-picker-${id}`;
  const lockedNoteId = `${ids}-locked`;
  const maxNoteId = `${ids}-max`;

  React.useEffect(() => {
    if (!focus) return;
    const byId = (id: string) => document.getElementById(id);
    if (focus.target === "up" || focus.target === "down") {
      const pressed = byId(focus.target === "up" ? upId(focus.id) : downId(focus.id));
      const other = byId(focus.target === "up" ? downId(focus.id) : upId(focus.id));
      const usable = (el: HTMLElement | null) => el && !(el as HTMLButtonElement).disabled;
      (usable(pressed) ? pressed : other)?.focus();
      return;
    }
    if (focus.target === "add") {
      byId(addId(focus.id))?.focus();
      return;
    }
    const name = byId(labelId(focus.id));
    name?.focus();
    if (focus.target !== "field") return;
    // A new content's editor may still be loading: move on to its first
    // box once it is there, unless the author has gone elsewhere meanwhile.
    let tries = 0;
    const timer = window.setInterval(() => {
      const box = byId(bodyId(focus.id))?.querySelector<HTMLElement>(FIELD);
      const stayed = document.activeElement === name || document.activeElement === document.body;
      if (box || !stayed || ++tries > 40) window.clearInterval(timer);
      if (box && stayed) box.focus();
    }, 75);
    return () => window.clearInterval(timer);
    // The ids are stable (useId); focus is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const refresh = React.useCallback(
    () => startTransition(() => router.refresh()),
    [router]
  );

  const say = (text: string) =>
    // A repeat of the same words is still announced.
    setAnnounce((prev) => (prev === text ? `${text} ` : text));

  /** Words for a refused change, in the menu language. */
  const refusalText = (r: WriteRefusal) => {
    if (r.error === "too-many-parts") {
      return t("tooMany", { max: SECTION_LIMITS.maxPartsPerSection });
    }
    if (r.error === "changed-elsewhere") return t("changedElsewhere");
    const message = writeErrorMessage(r);
    return tEditor(message.key, message.values);
  };

  /** One change to the lesson's content list; the outline it returns is taken in. */
  async function change(
    at: string,
    call: () => Promise<OutlineResult>,
    done: (id: string | undefined) => void
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await call();
      if (res.ok) {
        onOutline(res.outline);
        done(res.id);
        return;
      }
      if (res.error === "changed-elsewhere" && res.outline) onOutline(res.outline);
      setError({
        at,
        message: refusalText({
          error: res.error,
          ...("count" in res ? { count: res.count } : {}),
        }),
      });
    } catch {
      setError({ at, message: tEditor("errors.generic") });
    } finally {
      setBusy(false);
    }
  }

  if (!parts) {
    // Lesson.parts can't be read: the main content is still edited as
    // today; nothing else can change until an admin repairs it (G8).
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-1.5 rounded-md bg-[var(--surface-muted)] px-3 py-2 text-sm">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          {t("unreadable")}
        </p>
        {main}
      </div>
    );
  }

  const items = parts.items;
  const extras = extraCount(items);
  const allowed = (op: "add" | "move" | "remove") =>
    partOpAllowed({ status, reasons, sectionId, op, extras });
  const addLocked = !allowed("add");
  const moveLocked = !allowed("move");
  const removeLocked = !allowed("remove");
  const full = items.length >= SECTION_LIMITS.maxPartsPerSection;
  const typeName = (item: PartView) => t(`types.${partTypeOf(item, lesson.mainKind)}`);
  const language = tLanguage(lang);

  function add(after: PartId, type: PartType) {
    setPicker(null);
    void change(
      `add:${after}`,
      () => addPart(slug, sectionId, type, after, parts!.order),
      (id) => {
        if (!id) return;
        setFocus((f) => ({ id: id as PartId, target: "field", n: (f?.n ?? 0) + 1 }));
        say(t("added", { type: t(`types.${type}`) }));
      }
    );
  }

  function move(item: PartView, dir: -1 | 1) {
    const to = items.findIndex((i) => i.id === item.id) + dir;
    void change(
      `card:${item.id}`,
      () => movePart(slug, sectionId, item.id, dir, parts!.order),
      () => {
        setFocus((f) => ({
          id: item.id,
          target: focusAfterPartMove(items, item.id, dir),
          n: (f?.n ?? 0) + 1,
        }));
        say(t("moved", { n: to + 1, total: items.length }));
      }
    );
  }

  function remove(item: PartView) {
    if (item.type === "main") return;
    if (!window.confirm(t("removeConfirm"))) return;
    void change(
      `card:${item.id}`,
      () => removePart(slug, sectionId, item.id, parts!.order, item.itemVersion),
      () => {
        const next = focusAfterRemove(items, item.id);
        setFocus((f) => ({ ...next, n: (f?.n ?? 0) + 1 }));
        say(t("removed"));
      }
    );
  }

  function closePicker() {
    const at = picker;
    setPicker(null);
    if (at) setFocus((f) => ({ id: at, target: "add", n: (f?.n ?? 0) + 1 }));
  }

  function editorFor(item: PartView, position: string) {
    const dirtyLabel = `${label} · ${position}`;
    if (item.type === "main") return main;
    if (item.type === "text") {
      const target: NarrativeTarget = {
        save: (blocks, base) => savePartText(slug, sectionId, item.id, lang, blocks, base),
        refusal: refusalText,
      };
      const pairId = textPair(item.id, lang);
      return (
        <DirtyScope
          key={lang}
          id={`lesson:${lesson.key}:part:${item.id}:text`}
          label={dirtyLabel}
          langBound
        >
          {(report) => (
            <LessonNarrativeEditor
              courseSlug={slug}
              stageKey={lesson.key}
              locale={lang}
              initial={textInitial(item, lang)}
              initialRev={revs[pairId] ?? 0}
              courseKind={kind}
              target={target}
              fields="blocks"
              heading={position}
              embedded
              onSaved={refresh}
              onDirtyChange={report}
              onReread={(stale) => {
                setPending((p) => ({ ...p, [pairId]: stale }));
                refresh();
              }}
            />
          )}
        </DirtyScope>
      );
    }
    return (
      <DirtyScope id={`lesson:${lesson.key}:part:${item.id}`} label={dirtyLabel}>
        {(report) => (
          <StructureAuthor
            courseSlug={slug}
            target={partTarget(slug, sectionId, item.id, item.type)}
            locale={lang}
            courseStatus={status}
            regionLabel={position}
            embedded
            onSaved={refresh}
            onDraftChange={refresh}
            onDirtyChange={report}
          />
        )}
      </DirtyScope>
    );
  }

  const lockedAny = addLocked || moveLocked || removeLocked;
  // Locked because something in the course can't be read (G8), not because it is live.
  const unreadableCourse = reasons.some((r) => r.code === "unreadable");

  return (
    <div className="space-y-4">
      {extras > 0 ? (
        <p className="flex items-start gap-1.5 rounded-md bg-[var(--surface-muted)] px-3 py-2 text-sm">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--accent)]" aria-hidden />
          {t("notInLearnerView")}
        </p>
      ) : null}
      {lockedAny ? (
        <p id={lockedNoteId} className="text-sm text-[var(--muted-foreground)]">
          {unreadableCourse ? t("courseUnreadable") : t("liveLocked")}
        </p>
      ) : null}
      {full ? (
        <p id={maxNoteId} className="text-sm text-[var(--muted-foreground)]">
          {t("tooMany", { max: SECTION_LIMITS.maxPartsPerSection })}
        </p>
      ) : null}

      <ol className="space-y-4">
        {items.map((item, i) => {
          const type = typeName(item);
          const position = t("position", { type, n: i + 1, total: items.length });
          const open = picker === item.id;
          const addError = error?.at === `add:${item.id}` ? error.message : null;
          const addBlocked = addLocked || full;
          return (
            <li key={item.id}>
              <PartCard
                ids={{
                  label: labelId(item.id),
                  up: upId(item.id),
                  down: downId(item.id),
                  body: bodyId(item.id),
                }}
                groupLabel={t("groupLabel", { n: i + 1, total: items.length, type })}
                status={partStatus(item, lang)}
                language={language}
                header={extras > 0}
                index={i}
                total={items.length}
                removable={item.id !== MAIN_PART_ID}
                locked={{ move: moveLocked, remove: removeLocked }}
                lockedNoteId={lockedNoteId}
                error={error?.at === `card:${item.id}` ? error.message : undefined}
                onMove={(dir) => move(item, dir)}
                onRemove={() => remove(item)}
              >
                {editorFor(item, position)}
              </PartCard>

              <div className="mt-3 space-y-2">
                <Button
                  id={addId(item.id)}
                  size="sm"
                  variant="outline"
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  aria-label={t("addContentAfter", { n: i + 1, type })}
                  aria-expanded={open}
                  aria-controls={open ? pickerId(item.id) : undefined}
                  {...(addBlocked
                    ? {
                        "aria-disabled": true as const,
                        "aria-describedby": addLocked ? lockedNoteId : maxNoteId,
                      }
                    : {})}
                  onClick={() => {
                    if (addBlocked) return;
                    setError(null);
                    setPicker(open ? null : item.id);
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  {t("addContent")}
                </Button>
                {open ? (
                  <PartTypePicker
                    id={pickerId(item.id)}
                    onPick={(type) => add(item.id, type)}
                    onClose={closePicker}
                  />
                ) : null}
                {addError ? (
                  <p role="alert" className="text-sm text-[var(--danger)]">
                    {addError}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
